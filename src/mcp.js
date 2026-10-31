// Minimal browser MCP client used to ground Suno prompts in real music data.
// Talks to any remote MCP server over Streamable HTTP (default: MusicAtlas).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { DEFAULT_MCP_URL } from './mcpConfig';

export { DEFAULT_MCP_URL };

const TIMEOUT_MS = 45000;

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function connectMcp(url) {
  const client = new Client({ name: 'suno-style-creator', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  try {
    await withTimeout(client.connect(transport), 20000, 'MCP connect');
  } catch (err) {
    throw new Error(explainError(err, url));
  }
  const { tools } = await client.listTools();
  return { client, tools };
}

// Find a tool by exact name, falling back to a suffix match
// (some servers namespace tool names, e.g. "musicatlas_describe_track").
export function findTool(tools, name) {
  return tools.find((t) => t.name === name) || tools.find((t) => t.name.endsWith(name));
}

// Flatten an MCP tool result into plain text for use in an LLM prompt.
export function resultToText(result) {
  if (!result?.content) return '';
  const parts = result.content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text.trim());
  if (parts.length === 0 && result.structuredContent) {
    return JSON.stringify(result.structuredContent, null, 2);
  }
  return parts.join('\n\n');
}

const TRANSIENT = /\b5\d\d\b|non-JSON|timed out|rate limit|too many/i;

// Retry once after a short pause when the server reports a temporary failure.
async function callWithRetry(fn, pauseMs = 1500) {
  try {
    return await fn();
  } catch (err) {
    if (!TRANSIENT.test(err?.message || '')) throw err;
    await new Promise((res) => setTimeout(res, pauseMs));
    return fn();
  }
}

export async function callTool(client, tools, name, args) {
  const tool = findTool(tools, name);
  if (!tool) return null;
  const result = await withTimeout(
    client.callTool({ name: tool.name, arguments: args }),
    TIMEOUT_MS,
    `${tool.name}`,
  );
  const text = resultToText(result);
  if (result.isError) throw new Error(text || `${tool.name} returned an error`);
  return text;
}

/**
 * Pull reference data for an artist (and optional song) from the MCP server.
 * Each tool call is independent; one failing doesn't sink the others.
 */
export async function gatherMusicContext(url, { artist, song }) {
  const { client, tools } = await connectMcp(url);
  const calls = [];
  if (song) {
    calls.push(['trackAnalysis', 'describe_track', { artist, track: song }]);
    calls.push(['similarTracks', 'find_similar_tracks', { artist, track: song }]);
  }
  calls.push(['similarArtists', 'find_similar_artists', { artist }]);

  // One call at a time: when the calls ran in parallel, MusicAtlas answered
  // all but the first with server errors (likely a concurrency limit).
  const context = { toolsUsed: [], warnings: [] };
  for (const [key, tool, args] of calls) {
    try {
      const text = await callWithRetry(() => callTool(client, tools, tool, args));
      if (text) {
        context[key] = text;
        context.toolsUsed.push(tool);
      }
    } catch (err) {
      context.warnings.push(`${tool}: ${err?.message || err}`);
    }
  }

  client.close().catch(() => {});
  return context;
}

function explainError(err, url) {
  const msg = err?.message || String(err);
  if (/Failed to fetch|NetworkError|CORS|Load failed/i.test(msg)) {
    return `Couldn't reach ${url} from the browser (network or CORS blocked). ` +
      `Deploy the proxy in mcp-proxy/ and use its URL instead.`;
  }
  if (/401|unauthori[sz]ed/i.test(msg)) {
    return `${url} requires sign-in (OAuth). This app only supports MCP servers that allow anonymous access.`;
  }
  return `MCP connection failed: ${msg}`;
}
