# SunoPrompt AI

Generates Suno.ai style tags, song structure, rhyme scheme and Suno-ready lyrics from an artist, an optional song, and an optional topic, using Claude (`claude-sonnet-5-5`).

## Claude

- **Your key:** paste your own Anthropic API key (from console.anthropic.com) into the form. Your browser sends it directly to `api.anthropic.com`; the app has no backend and never stores it.
- **Request settings:** adaptive thinking at `medium` effort, streamed, with structured JSON output for the four fields.
- **Refusals:** if Claude declines a request, server-side fallback (`fallbacks: "default"`) retries it on Anthropic's recommended model. If that also declines, the app shows the reason.
- **Where to change things:** the model (`CLAUDE_MODEL`), prompts and tool list live in `src/claude.js`. Switch to `claude-opus-5-5` for higher quality at roughly twice the price.

## MCP grounding with MusicAtlas

With **Ground with MCP audio analysis** on, Claude calls [MusicAtlas](https://musicatlas.ai/connectors/) itself through Anthropic's [MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector). MusicAtlas is free and needs no account: `https://mcp.musicatlas.ai/mcp`.

Anthropic's servers connect to MusicAtlas, not your browser, so there are no CORS issues and no proxy is needed.

Only these three read-only tools are enabled:

| Tool | When Claude calls it | Used for |
|---|---|---|
| `describe_track` | a song is given | instrumentation, tempo, energy, production → style tags |
| `find_similar_tracks` | a song is given | stylistic neighbours |
| `find_similar_artists` | always | stylistic neighbours |

- **See what Claude used:** every tool call and its result appears in the **MusicAtlas Data Claude Used** panel.
- **If a tool fails:** Claude falls back to its own knowledge.
- **Other servers:** the server URL can point at any public MCP server that doesn't need sign-in and has tools with these names.

## Dev

```bash
npm install
npm run dev
```

Paste an Anthropic API key into the form to run locally. Pushes to `main` deploy to GitHub Pages.
