// Claude (Anthropic Messages API) client for generating Suno prompts.
// Runs entirely in the browser with the user's own API key. When an MCP
// server URL is given, Claude calls its tools itself through Anthropic's MCP
// connector (Anthropic connects to the server, so the browser never does).
import Anthropic from '@anthropic-ai/sdk';

export const CLAUDE_MODEL = 'claude-sonnet-5-5';

const MCP_SERVER_NAME = 'musicatlas';
// Only the read-only analysis tools; everything else on the server stays off.
const MCP_TOOLS = ['describe_track', 'find_similar_tracks', 'find_similar_artists'];
const MAX_CONTINUATIONS = 3; // resumes after pause_turn

const SUNO_SCHEMA = {
  type: 'object',
  properties: {
    genre_tags: {
      type: 'string',
      description: 'Comma-separated Suno "Style of Music" descriptors, under 1000 characters, no artist or song names.',
    },
    structure: { type: 'string', description: 'Song structure, e.g. Intro, Verse 1, Chorus...' },
    rhyme_scheme: { type: 'string', description: 'Rhyme scheme and syllables-per-line pattern.' },
    sample_lyrics: { type: 'string', description: 'Full original lyrics with Suno metatags in brackets.' },
  },
  required: ['genre_tags', 'structure', 'rhyme_scheme', 'sample_lyrics'],
  additionalProperties: false,
};

const SUNO_RULES = `You are an expert music producer and lyricist who writes prompts for Suno.ai.

Return four fields:
- genre_tags: a comma-separated list of style descriptors for Suno's "Style of Music" box: genre and era, tempo/BPM, instruments, vocal type and delivery, mood, and production techniques. Use concrete, high-fidelity audio descriptors. Keep it under 1000 characters. Never include artist names or song titles; Suno rejects them.
- structure: the song's section layout (e.g. Intro, Verse 1, Pre-Chorus, Chorus, ...).
- rhyme_scheme: the rhyme scheme and the syllables-per-line pattern (e.g. AABB, about 8 syllables per line).
- sample_lyrics: complete, original lyrics for a 3 to 5 minute song that match the genre, structure and rhyme scheme. Mark every section with Suno metatags in square brackets ([Intro], [Verse 1], [Chorus], [Bridge], [Guitar Solo], [Drop], [Outro], ...). Put each lyric line on its own line and leave a blank line between sections. The lyrics must be original; do not quote or closely paraphrase existing songs.`;

const MCP_GUIDANCE = `

You have MusicAtlas tools, which analyze the actual audio of released recordings. Before writing, ground the style in real data:
- If a song is named, call describe_track and find_similar_tracks for it.
- Call find_similar_artists for the artist.
Treat the analysis as the source of truth for instrumentation, tempo, energy, rhythm and production, and let it drive genre_tags; use similar artists and tracks only as stylistic context. If a tool fails, or says the track is still being analyzed, continue from your own knowledge.`;

export function buildUserPrompt({ artist, song, topic }) {
  return [
    `Analyze the musical style of the artist "${artist}"${song ? `, specifically the song "${song}"` : ''}, and write a Suno prompt in that style.`,
    topic
      ? `The lyrics must be about this topic: "${topic}".`
      : 'Write the lyrics about a theme typical for this artist.',
  ].join('\n\n');
}

export class ClaudeError extends Error {}

/**
 * @returns {Promise<{ result: object, toolCalls: Array<{name, input, output, isError}> }>}
 */
export async function generateSunoPrompt({ apiKey, artist, song, topic, mcpServerUrl, onProgress }) {
  const client = new Anthropic({
    apiKey,
    // The key is pasted by the user and only ever sent to api.anthropic.com
    // from their own browser; this app has no backend to hold it.
    dangerouslyAllowBrowser: true,
    maxRetries: 3,
  });

  const useMcp = Boolean(mcpServerUrl);
  const betas = ['server-side-fallback-2026-07-01'];
  const mcpParams = {};
  if (useMcp) {
    betas.push('mcp-client-2025-11-20');
    mcpParams.mcp_servers = [{ type: 'url', url: mcpServerUrl, name: MCP_SERVER_NAME }];
    mcpParams.tools = [{
      type: 'mcp_toolset',
      mcp_server_name: MCP_SERVER_NAME,
      default_config: { enabled: false },
      configs: Object.fromEntries(MCP_TOOLS.map((t) => [t, { enabled: true }])),
    }];
  }

  const messages = [{ role: 'user', content: buildUserPrompt({ artist, song, topic }) }];
  const allBlocks = [];
  let message;

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    try {
      // Stream so a long thinking + tool calls + lyrics response can't time out.
      const stream = client.beta.messages.stream({
        model: CLAUDE_MODEL,
        max_tokens: 32000,
        betas,
        fallbacks: 'default', // retry on Anthropic's recommended model if this one declines
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: SUNO_SCHEMA },
        },
        system: SUNO_RULES + (useMcp ? MCP_GUIDANCE : ''),
        messages,
        ...mcpParams,
      });
      stream.on('contentBlock', (block) => {
        if (block.type === 'mcp_tool_use') onProgress?.(`Claude is calling ${block.name}...`);
        else if (block.type === 'mcp_tool_result') onProgress?.('Claude is reading the MusicAtlas analysis...');
      });
      message = await stream.finalMessage();
    } catch (err) {
      throw new ClaudeError(describeApiError(err, useMcp));
    }

    allBlocks.push(...message.content);
    // Server-side tool loop hit its iteration limit: send the turn back to resume.
    if (message.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: message.content });
  }

  if (message.stop_reason === 'refusal') {
    const why = message.stop_details?.explanation || message.stop_details?.category || 'no reason given';
    throw new ClaudeError(`Claude declined this request (${why}). Try a different artist, song or topic.`);
  }
  if (message.stop_reason === 'max_tokens') {
    throw new ClaudeError('The response was cut off before it finished. Please try again.');
  }
  if (message.stop_reason === 'pause_turn') {
    throw new ClaudeError('Claude was still working after several rounds of tool calls. Please try again.');
  }

  // The structured JSON is the final text block of the final message.
  const finalText = [...message.content].reverse().find((b) => b.type === 'text')?.text;
  let result;
  try {
    result = JSON.parse(finalText);
  } catch {
    throw new ClaudeError('Claude returned a response that could not be read. Please try again.');
  }

  return { result, toolCalls: collectToolCalls(allBlocks) };
}

function collectToolCalls(blocks) {
  const results = new Map(
    blocks.filter((b) => b.type === 'mcp_tool_result').map((b) => [b.tool_use_id, b]),
  );
  return blocks
    .filter((b) => b.type === 'mcp_tool_use')
    .map((b) => {
      const r = results.get(b.id);
      const output = !r ? '' : typeof r.content === 'string'
        ? r.content
        : r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n\n');
      return { name: b.name, input: b.input, output, isError: Boolean(r?.is_error) };
    });
}

function describeApiError(err, useMcp) {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'Invalid Anthropic API key. Check the key you pasted (it starts with "sk-ant-").';
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return `This API key can't use ${CLAUDE_MODEL}. Check your Anthropic Console workspace and model access.`;
  }
  if (err instanceof Anthropic.NotFoundError) {
    return `Model ${CLAUDE_MODEL} was not found for this API key.`;
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Rate limited by the Anthropic API. Wait a moment and try again.';
  }
  if (err instanceof Anthropic.BadRequestError) {
    const hint = useMcp ? ' If this mentions the MCP server, check its URL or turn MCP grounding off.' : '';
    return `The Anthropic API rejected the request: ${err.message}${hint}`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the Anthropic API. Check your internet connection.';
  }
  if (err instanceof Anthropic.APIError) {
    return `Anthropic API error ${err.status ?? ''}: ${err.message}`;
  }
  return err?.message || String(err);
}
