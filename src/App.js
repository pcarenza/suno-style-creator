import React, { useState, useEffect } from 'react';
import { Music, Mic2, Disc, Copy, Check, Sparkles, AlertCircle, Loader2, Play, FileText, MessageSquare, Key } from 'lucide-react';

const apiKey = "AIzaSyCaa4sMe70AgrUiBos84s1bNNeorvN0gs0"; // API Key injected at runtime

export default function App() {
  const [artist, setArtist] = useState('');
  const [song, setSong] = useState('');
  const [topic, setTopic] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copiedSection, setCopiedSection] = useState(null);

  const delay = (ms) => new Promise(res => setTimeout(res, ms));

  const generatePrompt = async () => {
    if (!artist.trim()) {
      setError('Please enter an artist name.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    const effectiveKey = customKey.trim() || apiKey;
    const modelToUse = 'gemini-2.5-flash';

    const userQuery = `Analyze the musical style of artist "${artist}"${song ? ` and specifically the song "${song}"` : ''}. 
    
    Provide the following details in plain text, with absolutely no markdown code blocks or JSON formatting inside the values:
    1. "genre_tags": A comma-separated string of musical style descriptors, instruments, vibe, and production techniques suitable for a Suno.ai prompt. Keep it under 1000 characters. Example format: "upbeat, 80s synthpop, female vocals, reverberated drums, nostalgic".
    2. "structure": A description of the song structure (e.g., Intro, Verse, Chorus...).
    3. "rhyme_scheme": A description of the rhyme scheme used.
     4. "sample_lyrics": A complete set of original sample lyrics that matches the identified genre, structure, and rhyme scheme.${topic ? ` The lyrics MUST be specifically about this topic: "${topic}".` : ' Write the lyrics about a typical theme for this artist.'} MUST include proper Suno.ai style metatags in brackets (e.g., [Intro], [Verse 1], [Chorus], [Drop], [Guitar Solo], [Outro]). Consider this will be between 3 and 5 minute song. FORMATTING RULE: You MUST use newline characters (\\n) to separate each line of the lyrics, and use double newlines (\\n\\n) to separate different song sections.
   
    Focus on high-fidelity audio descriptors.`;

    const requestBody = {
      contents: [{ parts: [{ text: userQuery }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            genre_tags: { type: "STRING" },
            structure: { type: "STRING" },
            rhyme_scheme: { type: "STRING" },
            sample_lyrics: { type: "STRING" }
          },
          required: ["genre_tags", "structure", "rhyme_scheme", "sample_lyrics"]
        }
      }
    };

    let attempts = 0;
    const maxRetries = 5;
    const delays = [1000, 2000, 4000, 8000, 16000];
    let lastErrorMsg = "";

    while (attempts < maxRetries) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${effectiveKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          }
        );

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const status = response.status;
          const msg = errData.error?.message || 'Unknown network error';
          
          if (status === 401) {
            throw new Error(`HTTP 401 Unauthorized: Your Canvas session has likely expired. Please REFRESH THE PAGE to renew it. (Or enter a custom API key below).`);
          } else if (status === 404) {
            throw new Error(`HTTP 404 Not Found: Model unavailable. If using a custom key, check your API access limits.`);
          }
          throw new Error(`HTTP ${status}: ${msg}`);
        }

        const data = await response.json();
        let textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (textResponse) {
          // Strip markdown backticks using character codes to prevent parser break
          textResponse = textResponse.replace(/^[\s\x60]*(?:json)?\s*/i, '').replace(/[\s\x60]*$/i, '');
          
          const parsed = JSON.parse(textResponse);
          
          setResult(parsed);
          setLoading(false);
          return; 
        } else {
          throw new Error("No data returned from AI");
        }

      } catch (err) {
        console.warn(`Attempt ${attempts + 1} failed:`, err);
        lastErrorMsg = err.message;
        
        // Instantly fail without retrying for auth/model errors
        if (err.message.includes('401') || err.message.includes('404')) {
          setError(err.message);
          setLoading(false);
          return;
        }

        attempts++;
        if (attempts >= maxRetries) {
          setError(`Failed after 5 attempts. Last error: ${lastErrorMsg}`);
          setLoading(false);
          return;
        }
        await delay(delays[attempts - 1]);
      }
    }
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
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="bg-gradient-to-br from-purple-500 to-indigo-600 p-2 rounded-lg">
              <Music className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-indigo-400">
              SunoPrompt AI
            </h1>
          </div>
          <span className="text-xs font-medium px-2 py-1 rounded bg-slate-800 text-slate-400 border border-slate-700">
            v3.2
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        
        <section className="text-center space-y-3">
          <h2 className="text-3xl font-bold text-white">Generate Suno.ai Styles & Lyrics</h2>
          <p className="text-slate-400 max-w-lg mx-auto">
            Enter an artist, song, and a custom topic to generate optimized style tags, structure analysis, and Suno-ready lyrics.
          </p>
        </section>

        <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 shadow-xl backdrop-blur-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
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

          <div className="mb-6 space-y-2 border-t border-slate-800 pt-6">
            <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
              <Key className="w-4 h-4 text-yellow-400" /> Custom API Key <span className="text-xs text-slate-500">(Optional Fallback)</span>
            </label>
            <input
              type="password"
              value={customKey}
              onChange={(e) => setCustomKey(e.target.value)}
              placeholder="Disregard this for now..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent transition-all"
            />
          </div>

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
                <Loader2 className="w-5 h-5 animate-spin" /> Analyzing Music & Writing Lyrics...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" /> Generate Prompt & Lyrics
              </>
            )}
          </button>
        </div>

        {/* Results Section */}
        {result && (
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
          </div>
        )}
      </main>
    </div>
  );
}