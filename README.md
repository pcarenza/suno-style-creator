# SunoPrompt AI

Generates Suno.ai style tags, song structure, rhyme scheme and Suno-ready lyrics from an artist, an optional song, and an optional topic.

## MCP grounding (v4)

Before calling Gemini, the app can connect to a remote **MCP server** and pull real audio analysis. By default it uses [MusicAtlas](https://musicatlas.ai/connectors/), which is free and needs no account: `https://mcp.musicatlas.ai/mcp`.

| Tool | When | Used for |
|---|---|---|
| `describe_track` | song given | instrumentation, tempo, energy, production → style tags |
| `find_similar_tracks` | song given | stylistic neighbours |
| `find_similar_artists` | always | stylistic neighbours |

- The results go into the Gemini prompt as reference data. Artist names are kept out of the style tags.
- You can see the raw data in the **MusicAtlas Reference Data** panel.
- If the MCP server can't be reached, the app shows a warning and generates without it.
- You can switch it off, or point it at any anonymous Streamable-HTTP MCP server, in the form. Use **Test** to list the server's tools.

### If the browser is blocked by CORS

Deploy the small proxy in `mcp-proxy/` (a Cloudflare Worker). Then set the app's MCP URL to `https://<worker>.workers.dev/mcp`:

```bash
cd mcp-proxy && npx wrangler deploy
```

## Dev

```bash
npm install
npm run dev
```

Paste a Gemini API key into the form to run locally. Pushes to `main` deploy to GitHub Pages.
