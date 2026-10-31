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
  constructor(message, { retryable = false, busy = false } = {}) {
    super(message);
    this.retryable = retryable;
    this.busy = busy; // the model is overloaded or not answering: another model may work
  }
}

async function readError(response) {
  const data = await response.json().catch(() => ({}));
  const msg = data.error?.message || response.statusText || 'Unknown error';
  const s = response.status;
  if (s === 400 && /api key/i.test(msg)) return new GeminiError('Invalid Gemini API key. Check the key you pasted.');
  if (s === 401 || s === 403) return new GeminiError(`This Gemini API key isn't allowed to do that (HTTP ${s}): ${msg}`);
  if (s === 404) return new GeminiError(`Model not found (HTTP 404). Pick another model from the list. ${msg}`);
  if (s === 429) return new GeminiError(`Gemini rate limit or quota reached (HTTP 429): ${msg}`, { retryable: true, busy: true });
  if (s === 503) return new GeminiError(`Gemini is overloaded (HTTP 503): ${msg}`, { retryable: true, busy: true });
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

/** General-purpose Flash models, best first: stable newest-first, then preview newest-first. */
export function rankFlashModels(ids) {
  const flash = ids.filter((id) => /^gemini-[\d.]+-flash/.test(id) && !SPECIALIZED.test(id));
  const byNewest = (a, b) => version(b) - version(a) || a.length - b.length;
  return [
    ...flash.filter((id) => !UNSTABLE.test(id)).sort(byNewest),
    ...flash.filter((id) => UNSTABLE.test(id)).sort(byNewest),
  ];
}

/** Newest general-purpose Flash model, preferring stable over preview. */
export function pickDefaultModel(ids) {
  return rankFlashModels(ids)[0] || ids[0] || '';
}

/** Models to fall back to when `model` is busy: the next best Flash models. */
export function fallbackModels(ids, model, count = 2) {
  return rankFlashModels(ids).filter((id) => id !== model).slice(0, count);
}

export const STYLE_PROMPT_MAX = 1000;

/**
 * Keep the style prompt within STYLE_PROMPT_MAX characters, cutting at the
 * last sentence end (or comma) that fits so it never ends mid-phrase.
 */
export function fitStylePrompt(text, max = STYLE_PROMPT_MAX) {
  const clean = (text || '').trim();
  if (clean.length <= max) return { text: clean, trimmed: false };
  const head = clean.slice(0, max);
  const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'), head.endsWith('.') ? max - 1 : -1);
  const cut = sentenceEnd > max * 0.5 ? sentenceEnd + 1 : head.lastIndexOf(',');
  return { text: (cut > 0 ? head.slice(0, cut) : head).trim(), trimmed: true };
}

export function buildPrompt({ artist, song, topic, reference }) {
  return `Analyze the musical style of artist "${artist}"${song ? ` and specifically the song "${song}"` : ''}.

Provide the following details in plain text, with absolutely no markdown code blocks or JSON formatting inside the values:
1. "genre_tags": A rich, descriptive Suno.ai "Style of Music" prompt. Aim for roughly 750 to 950 characters and NEVER exceed ${STYLE_PROMPT_MAX} characters. Start with one line of comma-separated core style tags: genre and subgenre, era, tempo in BPM, musical key, vocal type, and mood (e.g. "upbeat, 80s synthpop, 118 BPM, A minor, breathy female vocals, nostalgic"). Then describe the sound in complete sentences: the instruments and how each is played, the vocal delivery, the rhythm and groove, how the arrangement builds and drops across the song, and the mix and production techniques. Finish every sentence. Never include artist names, band names or song titles (Suno rejects them).
2. "structure": A description of the song structure (e.g., Intro, Verse, Chorus...).
3. "rhyme_scheme": A description of the rhyme scheme used, and the pattern of syllables per line (e.g., AABB with 8 syllables per line).
4. "sample_lyrics": A complete set of original sample lyrics that matches the identified genre, structure, and rhyme scheme.${topic ? ` The lyrics MUST be specifically about this topic: "${topic}".` : ' Write the lyrics about a typical theme for this artist.'} MUST include proper Suno.ai style metatags in brackets (e.g., [Intro], [Verse 1], [Chorus], [Drop], [Guitar Solo], [Outro]). Consider this will be between a 3 and 5 minute song. Put each lyric line on its own line and leave a blank line between song sections.

Focus on high-fidelity audio descriptors.${reference ? `\n\n${reference}` : ''}`;
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

const REQUEST_TIMEOUT_MS = 120000;
const BUSY_DELAYS = [2000]; // retries on the same model before moving on when it is busy
const OTHER_DELAYS = [1000, 3000]; // retries for network errors, other 5xx, unreadable output

async function requestOnce({ apiKey, model, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let data;
  try {
    const response = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw await readError(response);
    data = await response.json();
  } catch (err) {
    if (err instanceof GeminiError) throw err;
    if (err?.name === 'AbortError') {
      throw new GeminiError(`${model} did not answer within ${REQUEST_TIMEOUT_MS / 1000}s.`, { retryable: true, busy: true });
    }
    throw new GeminiError(`Could not reach the Gemini API: ${err.message}`, { retryable: true });
  } finally {
    clearTimeout(timer);
  }

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
}

/**
 * Generate with `model`; if it stays overloaded (503/429) or doesn't answer,
 * move on to each of `fallbacks` in turn.
 * @returns {Promise<{ result: object, modelUsed: string }>}
 */
export async function generateSunoPrompt({ apiKey, model, fallbacks = [], prompt, onStatus }) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SUNO_SCHEMA },
  });
  const candidates = [model, ...fallbacks.filter((m) => m && m !== model)];
  let lastError;

  for (let i = 0; i < candidates.length; i++) {
    const current = candidates[i];
    if (i > 0) onStatus?.(`${candidates[i - 1]} is busy. Trying ${current}...`);
    let busyTries = 0;
    let otherTries = 0;
    for (;;) {
      try {
        return { result: await requestOnce({ apiKey, model: current, body }), modelUsed: current };
      } catch (err) {
        lastError = err;
        if (!err.retryable) throw err;
        if (err.busy) {
          if (busyTries >= BUSY_DELAYS.length) break; // give up on this model
          onStatus?.(`${current} is busy. Retrying...`);
          await delay(BUSY_DELAYS[busyTries++]);
        } else {
          if (otherTries >= OTHER_DELAYS.length) throw err;
          onStatus?.('Gemini request failed. Retrying...');
          await delay(OTHER_DELAYS[otherTries++]);
        }
      }
    }
  }
  throw new GeminiError(
    `${lastError.message} Tried: ${candidates.join(', ')}. Wait a few minutes or pick another model.`,
  );
}
