// Gemini API client (REST, called from the browser with the user's own key).
const API = 'https://generativelanguage.googleapis.com/v1beta';

const SUNO_SCHEMA = {
  type: 'OBJECT',
  properties: {
    genre_tags: { type: 'STRING' },
    structure: { type: 'STRING' },
    rhyme_scheme: { type: 'STRING' },
    sample_lyrics: { type: 'STRING' },
  },
  required: ['genre_tags', 'structure', 'rhyme_scheme', 'sample_lyrics'],
};

export class GeminiError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.retryable = retryable;
  }
}

async function readError(response) {
  const data = await response.json().catch(() => ({}));
  const msg = data.error?.message || response.statusText || 'Unknown error';
  const s = response.status;
  if (s === 400 && /api key/i.test(msg)) return new GeminiError('Invalid Gemini API key. Check the key you pasted.');
  if (s === 401 || s === 403) return new GeminiError(`This Gemini API key isn't allowed to do that (HTTP ${s}): ${msg}`);
  if (s === 404) return new GeminiError(`Model not found (HTTP 404). Pick another model from the list. ${msg}`);
  if (s === 429) return new GeminiError(`Gemini rate limit or quota reached (HTTP 429): ${msg}`, { retryable: true });
  if (s >= 500) return new GeminiError(`Gemini server error (HTTP ${s}): ${msg}`, { retryable: true });
  return new GeminiError(`Gemini API error (HTTP ${s}): ${msg}`);
}

/** Models this key can call generateContent on, as plain ids like "gemini-x-flash". */
export async function listModels(apiKey) {
  const ids = [];
  let pageToken = '';
  do {
    const url = `${API}/models?pageSize=1000&key=${encodeURIComponent(apiKey)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const response = await fetch(url);
    if (!response.ok) throw await readError(response);
    const data = await response.json();
    for (const m of data.models || []) {
      if (m.supportedGenerationMethods?.includes('generateContent') && m.name?.startsWith('models/gemini')) {
        ids.push(m.name.slice('models/'.length));
      }
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return ids;
}

const SPECIALIZED = /lite|image|tts|live|audio|embedding|native|robotics|computer|learnlm/i;
const UNSTABLE = /preview|exp|latest|\d{2}-\d{4}$/i;
const version = (id) => parseFloat(id.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1] || '0');

/** Newest general-purpose Flash model, preferring stable over preview. */
export function pickDefaultModel(ids) {
  const flash = ids.filter((id) => /^gemini-[\d.]+-flash/.test(id) && !SPECIALIZED.test(id));
  const byNewest = (a, b) => version(b) - version(a) || a.length - b.length;
  const stable = flash.filter((id) => !UNSTABLE.test(id)).sort(byNewest);
  if (stable.length) return stable[0];
  return flash.sort(byNewest)[0] || ids[0] || '';
}

export function buildPrompt({ artist, song, topic, reference }) {
  return `Analyze the musical style of artist "${artist}"${song ? ` and specifically the song "${song}"` : ''}.

Provide the following details in plain text, with absolutely no markdown code blocks or JSON formatting inside the values:
1. "genre_tags": A comma-separated string of musical style descriptors, instruments, vibe, and production techniques suitable for a Suno.ai prompt. Keep it under 1000 characters. Never include artist names or song titles (Suno rejects them). Example format: "upbeat, 80s synthpop, female vocals, reverberated drums, nostalgic".
2. "structure": A description of the song structure (e.g., Intro, Verse, Chorus...).
3. "rhyme_scheme": A description of the rhyme scheme used, and the pattern of syllables per line (e.g., AABB with 8 syllables per line).
4. "sample_lyrics": A complete set of original sample lyrics that matches the identified genre, structure, and rhyme scheme.${topic ? ` The lyrics MUST be specifically about this topic: "${topic}".` : ' Write the lyrics about a typical theme for this artist.'} MUST include proper Suno.ai style metatags in brackets (e.g., [Intro], [Verse 1], [Chorus], [Drop], [Guitar Solo], [Outro]). Consider this will be between a 3 and 5 minute song. Put each lyric line on its own line and leave a blank line between song sections.

Focus on high-fidelity audio descriptors.${reference ? `\n\n${reference}` : ''}`;
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

export async function generateSunoPrompt({ apiKey, model, prompt }) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SUNO_SCHEMA },
  });
  const delays = [1000, 2000, 4000, 8000];

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!response.ok) throw await readError(response);

      const data = await response.json();
      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.map((p) => p.text || '').join('');
      if (!text) {
        const reason = data.promptFeedback?.blockReason || candidate?.finishReason || 'no content';
        throw new GeminiError(`Gemini returned no result (${reason}). Try a different artist, song or topic.`);
      }
      try {
        return JSON.parse(text.replace(/^[\s`]*(?:json)?\s*/i, '').replace(/[\s`]*$/, ''));
      } catch {
        throw new GeminiError('Gemini returned a response that could not be read. Please try again.', { retryable: true });
      }
    } catch (err) {
      const retryable = err instanceof GeminiError ? err.retryable : true; // network errors retry
      if (!retryable || attempt >= delays.length) {
        throw err instanceof GeminiError ? err : new GeminiError(`Could not reach the Gemini API: ${err.message}`);
      }
      await delay(delays[attempt]);
    }
  }
}
