// MusicAtlas through the CORS proxy in mcp-proxy/ (a Cloudflare Worker).
// Browsers can't call MusicAtlas directly because it sends no CORS headers.
export const DEFAULT_MCP_URL = 'https://suno-mcp-proxy.pcarenza.workers.dev/mcp';

// The direct MusicAtlas address. It was the default before the proxy, so it
// may still be saved in browsers; it is replaced with DEFAULT_MCP_URL on load.
export const DIRECT_MUSICATLAS_URL = 'https://mcp.musicatlas.ai/mcp';
