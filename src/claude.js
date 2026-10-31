// Claude (Anthropic Messages API) client for generating Suno prompts.
// Runs entirely in the browser with the user's own API key.
import Anthropic from '@anthropic-ai/sdk';

export const CLAUDE_MODEL = 'claude-opus-5-5';

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

const SYSTEM_PROMPT = `You are an expert music producer and lyricist who writes prompts for Suno.ai.

Return four fields:
- genre_tags: a comma-separated list of style descriptors for Suno's "Style of Music" box: genre and era, tempo/BPM, instruments, vocal type and delivery, mood, and production techniques. Use concrete, high-fidelity audio descriptors. Keep it under 1000 characters. Never include artist names or song titles; Suno rejects them.
- structure: the song's section layout (e.g. Intro, Verse 1, Pre-Chorus, Chorus, ...).
- rhyme_scheme: the rhyme scheme and the syllables-per-line pattern (e.g. AABB, about 8 syllables per line).
- sample_lyrics: complete, original lyrics for a 3 to 5 minute song that match the genre, structure and rhyme scheme. Mark every section with Suno metatags in square brackets ([Intro], [Verse 1], [Chorus], [Bridge], [Guitar Solo], [Drop], [Outro], ...). Put each lyric line on its own line and leave a blank line between sections. The lyrics must be original; do not quote or closely paraphrase existing songs.`;

export function buildUserPrompt({ artist, song, topic, reference }) {
  const lines = [
    `Analyze the musical style of the artist "${artist}"${song ? `, specifically the song "${song}"` : ''}, and write a Suno prompt in that style.`,
    topic
      ? `The lyrics must be about this topic: "${topic}".`
      : 'Write the lyrics about a theme typical for this artist.',
  ];
  if (reference) lines.push(reference);
  return lines.join('\n\n');
}

export class ClaudeError extends Error {}

export async function generateSunoPrompt({ apiKey, artist, song, topic, reference }) {
  const client = new Anthropic({
    apiKey,
    // The key is pasted by the user and only ever sent to api.anthropic.com
    // from their own browser; this app has no backend to hold it.
    dangerouslyAllowBrowser: true,
    maxRetries: 3,
  });

  let message;
  try {
    // Stream so a long thinking + lyrics response can't hit an HTTP timeout.
    const stream = client.beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // retry on Anthropic's recommended model if this one declines
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SUNO_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt({ artist, song, topic, reference }) }],
    });
    message = await stream.finalMessage();
  } catch (err) {
    throw new ClaudeError(describeApiError(err));
  }

  if (message.stop_reason === 'refusal') {
    const why = message.stop_details?.explanation || message.stop_details?.category || 'no reason given';
    throw new ClaudeError(`Claude declined this request (${why}). Try a different artist, song or topic.`);
  }
  if (message.stop_reason === 'max_tokens') {
    throw new ClaudeError('The response was cut off before it finished. Please try again.');
  }

  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new ClaudeError('Claude returned a response that could not be read. Please try again.');
  }
}

function describeApiError(err) {
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
    return `The Anthropic API rejected the request: ${err.message}`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the Anthropic API. Check your internet connection.';
  }
  if (err instanceof Anthropic.APIError) {
    return `Anthropic API error ${err.status ?? ''}: ${err.message}`;
  }
  return err?.message || String(err);
}
