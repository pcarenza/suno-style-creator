import React, { useState, useEffect } from 'react';
import { Music, Mic2, Disc, Copy, Check, Sparkles, AlertCircle, Loader2, Play, FileText, MessageSquare, Key, Plug, Radio, Users, ChevronDown } from 'lucide-react';
import { DEFAULT_MCP_URL } from './mcpConfig';

// The MCP SDK is loaded on demand so it doesn't weigh down the first page load.
const loadMcp = () => import('./mcp');
import { listModels, pickDefaultModel, buildPrompt, generateSunoPrompt } from './gemini';

const readPref = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch { return fallback; }
};
const writePref = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
};

// Turn MCP tool output into a reference block for the Gemini prompt.
const buildReferenceBlock = (ctx) => {
  if (!ctx) return '';
  const sections = [];
  if (ctx.trackAnalysis) sections.push(`AUDIO ANALYSIS OF THE REFERENCE TRACK:\n${ctx.trackAnalysis}`);
  if (ctx.similarTracks) sections.push(`SONICALLY SIMILAR TRACKS:\n${ctx.similarTracks}`);
  if (ctx.similarArtists) sections.push(`SONICALLY SIMILAR ARTISTS:\n${ctx.similarArtists}`);
  if (!sections.length) return '';
  return `

    REFERENCE DATA (from MusicAtlas audio analysis via MCP). Treat it as ground truth about the sound: use its instrumentation, tempo, energy, rhythm and production details to drive "genre_tags", and use similar artists only as stylistic context. NEVER put any artist or song names in "genre_tags" (Suno rejects them).
    ---
    ${sections.join('\n\n')}
    ---`;
};


export default function App() {
  const [artist, setArtist] = useState('');
  const [song, setSong] = useState('');
  const [topic, setTopic] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copiedSection, setCopiedSection] = useState(null);

  // Gemini model: discovered from the API so retired model names can't break the app.
  const [models, setModels] = useState([]);
  const [model, setModel] = useState(() => readPref('gemini.model', ''));
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState(null);

  useEffect(() => { if (model) writePref('gemini.model', model); }, [model]);

  const loadModels = async (key) => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const ids = await listModels(key);
      setModels(ids);
      const chosen = ids.includes(model) ? model : pickDefaultModel(ids);
      setModel(chosen);
      return chosen;
    } catch (err) {
      setModelsError(err.message);
      return '';
    } finally {
      setModelsLoading(false);
    }
  };

  // Look up available models shortly after a key is pasted.
  useEffect(() => {
    const key = customKey.trim();
    if (key.length < 30) return;
    const t = setTimeout(() => loadModels(key), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customKey]);

  // MCP enrichment
  const [useMcp, setUseMcp] = useState(() => readPref('mcp.enabled', true));
  const [mcpUrl, setMcpUrl] = useState(() => readPref('mcp.url', DEFAULT_MCP_URL));
  const [mcpStage, setMcpStage] = useState(null); // null | 'mcp' | 'llm'
  const [mcpContext, setMcpContext] = useState(null);
  const [mcpWarning, setMcpWarning] = useState(null);
  const [mcpTest, setMcpTest] = useState(null); // { ok, text }
  const [testing, setTesting] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => writePref('mcp.enabled', useMcp), [useMcp]);
  useEffect(() => writePref('mcp.url', mcpUrl), [mcpUrl]);

  const testMcp = async () => {
    setTesting(true);
    setMcpTest(null);
    try {
      const { connectMcp } = await loadMcp();
      const { client, tools } = await connectMcp(mcpUrl.trim());
      client.close().catch(() => {});
      setMcpTest({ ok: true, text: `Connected. ${tools.length} tools: ${tools.map(t => t.name).join(', ')}` });
    } catch (err) {
      setMcpTest({ ok: false, text: err.message });
    }
    setTesting(false);
  };


  const generatePrompt = async () => {
    if (!artist.trim()) {
      setError('Please enter an artist name.');
      return;
    }
    if (!customKey.trim()) {
      setError('Please paste your Gemini API key.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setMcpContext(null);
    setMcpWarning(null);
    setShowRaw(false);

    // Step 1: ground the request in real audio data via MCP (best effort).
    let ctx = null;
    if (useMcp && mcpUrl.trim()) {
      setMcpStage('mcp');
      try {
        const { gatherMusicContext } = await loadMcp();
        ctx = await gatherMusicContext(mcpUrl.trim(), { artist: artist.trim(), song: song.trim() });
        setMcpContext(ctx);
        if (ctx.warnings.length) setMcpWarning(ctx.warnings.join(' | '));
      } catch (err) {
        setMcpWarning(`${err.message} Continuing without MusicAtlas data.`);
      }
    }
    setMcpStage('llm');

    try {
      const chosenModel = (models.includes(model) && model) || await loadModels(customKey.trim());
      if (!chosenModel) throw new Error('Could not find a Gemini model for this API key. Check the key.');
      const parsed = await generateSunoPrompt({
        apiKey: customKey.trim(),
        model: chosenModel,
        prompt: buildPrompt({
          artist: artist.trim(),
          song: song.trim(),
          topic: topic.trim(),
          reference: buildReferenceBlock(ctx),
        }),
      });
      setResult(parsed);
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
    setLoading(false); setMcpStage(null);
  };

  const copyToClipboard = (text, section) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
    document.body.removeChild(textArea);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-purple-500 selection:text-white pb-12">
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="bg-gradient-to-br from-purple-500 to-indigo-600 p-2 rounded-lg">
              <Music className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-indigo-400">
              SunoPrompt AI
            </h1>
          </div>
          <span className="text-xs font-medium px-2 py-1 rounded bg-slate-800 text-slate-400 border border-slate-700">
            v4.1 Gemini + MCP
          </span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        
        <section className="text-center space-y-3 mb-4">
          <h2 className="text-3xl font-bold text-white">Generate Suno.ai Styles & Lyrics</h2>
          <p className="text-slate-400 max-w-lg mx-auto">
            Enter an artist, song, and a custom topic to generate optimized style tags, structure analysis, and Suno-ready lyrics.
          </p>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Panel: Form */}
          <div className="lg:col-span-5 sticky top-24">
            <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 shadow-xl backdrop-blur-sm">
              <div className="space-y-4 mb-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                    <Mic2 className="w-4 h-4 text-purple-400" /> Artist Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={artist}
                    onChange={(e) => setArtist(e.target.value)}
                    placeholder="e.g. Daft Punk"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    onKeyDown={(e) => e.key === 'Enter' && generatePrompt()}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                    <Disc className="w-4 h-4 text-indigo-400" /> Song Title <span className="text-xs text-slate-500">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={song}
                    onChange={(e) => setSong(e.target.value)}
                    placeholder="e.g. Harder, Better, Faster, Stronger"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    onKeyDown={(e) => e.key === 'Enter' && generatePrompt()}
                  />
                </div>
              </div>
              
              <div className="mb-6 space-y-2">
                <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-pink-400" /> Lyrical Topic <span className="text-xs text-slate-500">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="What should the song be about? (e.g. A robot learning to love)"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                  onKeyDown={(e) => e.key === 'Enter' && generatePrompt()}
                />
              </div>

              <div className="mb-6 space-y-3 border-t border-slate-800 pt-6">
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="text-sm font-medium text-slate-300 flex items-center gap-2">
                    <Plug className="w-4 h-4 text-emerald-400" /> Ground with MCP audio analysis
                  </span>
                  <input
                    type="checkbox"
                    checked={useMcp}
                    onChange={(e) => setUseMcp(e.target.checked)}
                    className="w-5 h-5 accent-emerald-500"
                  />
                </label>
                {useMcp && (
                  <>
                    <p className="text-xs text-slate-500">
                      Calls MusicAtlas tools (describe_track, find_similar_tracks, find_similar_artists) before writing the prompt, so the tags describe how the music really sounds.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={mcpUrl}
                        onChange={(e) => setMcpUrl(e.target.value)}
                        placeholder={DEFAULT_MCP_URL}
                        className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono"
                      />
                      <button
                        type="button"
                        onClick={testMcp}
                        disabled={testing}
                        className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 flex items-center gap-1 disabled:opacity-50"
                      >
                        {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Radio className="w-3 h-3" />} Test
                      </button>
                    </div>
                    {mcpUrl.trim() !== DEFAULT_MCP_URL && (
                      <button type="button" onClick={() => setMcpUrl(DEFAULT_MCP_URL)} className="text-xs text-slate-500 hover:text-slate-300 underline">
                        Reset to MusicAtlas default
                      </button>
                    )}
                    {mcpTest && (
                      <p className={`text-xs break-words ${mcpTest.ok ? 'text-emerald-400' : 'text-amber-400'}`}>{mcpTest.text}</p>
                    )}
                  </>
                )}
              </div>

              <div className="mb-6 space-y-2 border-t border-slate-800 pt-6">
                <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                  <Key className="w-4 h-4 text-yellow-400" /> Gemini API Key <span className="text-red-400">*</span>
                </label>
                <input
                  type="password"
                  value={customKey}
                  onChange={(e) => setCustomKey(e.target.value)}
                  placeholder="Paste your Google Gemini API key here..."
                  autoComplete="off"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent transition-all"
                />
                <div className="flex items-center gap-2 pt-1">
                  <label className="text-xs text-slate-400 shrink-0" htmlFor="gemini-model">Model</label>
                  <select
                    id="gemini-model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={!models.length}
                    className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono disabled:opacity-50"
                  >
                    {!models.length && <option value={model}>{modelsLoading ? 'Loading models...' : (model || 'Paste your key to load models')}</option>}
                    {models.map((id) => <option key={id} value={id}>{id}</option>)}
                  </select>
                  {modelsLoading && <Loader2 className="w-4 h-4 animate-spin text-slate-500" />}
                </div>
                {modelsError && <p className="text-xs text-amber-400 break-words">{modelsError}</p>}
              </div>

              {mcpWarning && (
                <div className="mb-6 p-3 bg-amber-900/20 border border-amber-800/60 rounded-lg flex items-start gap-3 text-amber-200">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p className="text-xs break-words">{mcpWarning}</p>
                </div>
              )}

              {error && (
                <div className="mb-6 p-4 bg-red-900/20 border border-red-800 rounded-lg flex items-center gap-3 text-red-200">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <p className="text-sm">{error}</p>
                </div>
              )}

              <button
                onClick={generatePrompt}
                disabled={loading}
                className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all transform hover:scale-[1.01] active:scale-[0.99]
                  ${loading 
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed' 
                    : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-purple-900/20'
                  }`}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" /> {mcpStage === 'mcp' ? 'Listening via MusicAtlas...' : 'Analyzing & Writing...'}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" /> Generate Prompt
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Panel: Output */}
          <div className="lg:col-span-7">
            {result ? (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="bg-slate-900 rounded-2xl border border-purple-500/30 overflow-hidden shadow-2xl shadow-purple-900/10">
                  <div className="bg-slate-800/50 px-6 py-4 border-b border-slate-800 flex justify-between items-center">
                    <h3 className="font-semibold text-purple-300 flex items-center gap-2">
                      <Play className="w-4 h-4 fill-current" /> Suno Style Tags
                    </h3>
                    <button
                      onClick={() => copyToClipboard(result.genre_tags, 'tags')}
                      className="text-xs font-medium px-3 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors flex items-center gap-2 border border-slate-700"
                    >
                      {copiedSection === 'tags' ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                      {copiedSection === 'tags' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="p-6">
                    <p className="text-lg leading-relaxed text-slate-200 font-mono">
                      {result.genre_tags}
                    </p>
                    <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                      <span>{result.genre_tags.length} chars</span>
                      <span className="w-1 h-1 rounded-full bg-slate-600"></span>
                      <span>Ready for Suno.ai "Style of Music" box</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-slate-900 rounded-2xl border border-slate-800 p-6 shadow-lg hover:border-slate-700 transition-colors">
                    <div className="flex justify-between items-start mb-4">
                      <h4 className="font-medium text-slate-400 uppercase tracking-wider text-xs">Song Structure</h4>
                      <button
                        onClick={() => copyToClipboard(result.structure, 'struct')}
                        className="text-slate-500 hover:text-white transition-colors"
                      >
                        {copiedSection === 'struct' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-slate-200 whitespace-pre-wrap">{result.structure}</p>
                  </div>

                  <div className="bg-slate-900 rounded-2xl border border-slate-800 p-6 shadow-lg hover:border-slate-700 transition-colors">
                    <div className="flex justify-between items-start mb-4">
                      <h4 className="font-medium text-slate-400 uppercase tracking-wider text-xs">Rhyme Scheme</h4>
                      <button
                        onClick={() => copyToClipboard(result.rhyme_scheme, 'rhyme')}
                        className="text-slate-500 hover:text-white transition-colors"
                      >
                        {copiedSection === 'rhyme' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-slate-200 whitespace-pre-wrap">{result.rhyme_scheme}</p>
                  </div>

                  <div className="bg-slate-900 rounded-2xl border border-slate-800 p-6 shadow-lg hover:border-slate-700 transition-colors md:col-span-2">
                    <div className="flex justify-between items-start mb-4">
                      <h4 className="font-medium text-indigo-400 uppercase tracking-wider text-xs flex items-center gap-2">
                        <FileText className="w-4 h-4" /> Sample Lyrics (Suno Ready)
                      </h4>
                      <button
                        onClick={() => copyToClipboard(result.sample_lyrics, 'lyrics')}
                        className="text-xs font-medium px-3 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors flex items-center gap-2 border border-slate-700"
                      >
                        {copiedSection === 'lyrics' ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                        {copiedSection === 'lyrics' ? 'Copied' : 'Copy Lyrics'}
                      </button>
                    </div>
                    <div className="bg-slate-950 p-6 rounded-xl border border-slate-800/50">
                      <p className="text-slate-300 whitespace-pre-wrap font-mono text-sm leading-relaxed">
                        {result.sample_lyrics}
                      </p>
                    </div>
                  </div>
                </div>

                {mcpContext && mcpContext.toolsUsed.length > 0 && (
                  <div className="bg-slate-900 rounded-2xl border border-emerald-500/20 p-6 shadow-lg">
                    <button
                      type="button"
                      onClick={() => setShowRaw(!showRaw)}
                      className="w-full flex justify-between items-center text-left"
                    >
                      <h4 className="font-medium text-emerald-400 uppercase tracking-wider text-xs flex items-center gap-2">
                        <Users className="w-4 h-4" /> MusicAtlas Reference Data (via MCP)
                      </h4>
                      <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${showRaw ? 'rotate-180' : ''}`} />
                    </button>
                    <p className="text-xs text-slate-500 mt-2">Grounded with: {mcpContext.toolsUsed.join(', ')}</p>
                    {showRaw && (
                      <div className="mt-4 space-y-4">
                        {[['Track analysis', mcpContext.trackAnalysis], ['Similar tracks', mcpContext.similarTracks], ['Similar artists', mcpContext.similarArtists]]
                          .filter(([, v]) => v)
                          .map(([label, v]) => (
                            <div key={label}>
                              <p className="text-xs text-slate-400 mb-1">{label}</p>
                              <p className="text-sm text-slate-300 whitespace-pre-wrap bg-slate-950 p-4 rounded-xl border border-slate-800/50 max-h-72 overflow-auto">{v}</p>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full min-h-[500px] flex flex-col items-center justify-center border-2 border-dashed border-slate-800/60 rounded-2xl p-12 text-slate-500 text-center bg-slate-900/20">
                {loading ? (
                  <div className="flex flex-col items-center animate-in fade-in duration-300">
                    <Loader2 className="w-12 h-12 animate-spin text-purple-500 mb-6" />
                    <p className="text-lg text-slate-300 font-medium">{mcpStage === 'mcp' ? 'Fetching audio analysis over MCP...' : 'Analyzing Musical Style...'}</p>
                    <p className="text-sm mt-2 max-w-sm">Generating Suno.ai tags, song structure, and writing original lyrics.</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center animate-in fade-in zoom-in-95 duration-500">
                    <Sparkles className="w-12 h-12 text-slate-700 mb-6" />
                    <p className="text-lg text-slate-400 font-medium">No results generated yet.</p>
                    <p className="text-sm mt-2 max-w-sm">Fill out the form on the left to create a highly optimized Suno.ai prompt based on any artist or theme.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
