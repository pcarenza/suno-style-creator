// Gemini API client (REST, called from the browser with the user's own key).
const API = 'https://generativelanguage.googleapis.com/v1beta';

const SUNO_SCHEMA = {
  type: 'OBJECT',
  properties: {
    genre_tags: { type: 'STRING' },
    tempo_bpm: { type: 'INTEGER' },
    key: { type: 'STRING' },
    stems: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { group: { type: 'STRING' }, prompt: { type: 'STRING' } },
        required: ['group', 'prompt'],
      },
    },
    sections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          bars: { type: 'INTEGER' },
          seconds: { type: 'INTEGER' },
          lines: { type: 'INTEGER' },
          rhyme: { type: 'STRING' },
          meter: { type: 'STRING' },
          description: { type: 'STRING' },
          suno_tags: { type: 'STRING' },
        },
        required: ['name', 'bars', 'seconds', 'lines', 'rhyme', 'meter', 'description', 'suno_tags'],
      },
    },
    sample_lyrics: { type: 'STRING' },
  },
  required: ['genre_tags', 'tempo_bpm', 'key', 'stems', 'sections', 'sample_lyrics'],
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

export function buildPrompt({ artist, song, topic, lyrics, reference }) {
  const subject = `the artist "${artist}"${song ? ` and specifically the song "${song}"` : ''}`;

  const structureSource = lyrics
    ? `Measure the structure from the PASTED LYRICS at the end of this message. Count the actual lines in each section and the actual syllables in each line. Never quote or reproduce any of the pasted lyrics in your answer.`
    : song
      ? `Describe the structure of "${song}" by ${artist} from your knowledge of the song. Only include sections that actually exist in it. If you are unsure of a value, give your best estimate.`
      : `Describe a typical song structure for this artist's style (for example Intro, Verse, Pre-Chorus, Chorus, Bridge, Outro), using values typical of the genre.`;

  return `Analyze the musical style of ${subject}.

Respond in plain text inside each field, with no markdown or code blocks. Never include artist names, band names or song titles in genre_tags, stems, suno_tags or sample_lyrics (Suno rejects them).

1. "genre_tags": A rich, descriptive Suno.ai "Style of Music" prompt. Aim for roughly 750 to 950 characters and NEVER exceed ${STYLE_PROMPT_MAX} characters. Start with one line of comma-separated core style tags: genre and subgenre, era, tempo in BPM, musical key, vocal type, and mood (e.g. "upbeat, 80s synthpop, 118 BPM, A minor, breathy female vocals, nostalgic"). Then describe the sound in complete sentences: the instruments and how each is played, the vocal delivery, the rhythm and groove, how the arrangement builds and drops across the song, and the mix and production techniques. Finish every sentence.

2. "tempo_bpm" and "key": the tempo in BPM and the musical key (e.g. "A minor").${song ? ` Use the actual values of "${song}" if you know them, otherwise your best estimate.` : ' Infer values typical of the artist.'}

3. "stems": One entry per instrument group actually present in this ${song ? 'song' : "artist's style"}, choosing only from groups that apply: Drums & Percussion, Bass, Rhythm Guitar, Lead Guitar, Piano / Keys, Synthesizers, Strings / Orchestral, Brass / Horns, Vocals, Backing Vocals / Choir, Pads & Atmosphere, FX & Transitions. For each, "group" is the group name and "prompt" is a focused Suno stem prompt describing ONLY that group in isolation, as if generating just that stem: the specific instruments, playing style, tone, role in the mix, and the tempo and key where relevant (e.g. "Isolated drum stem: tight punchy kick at 98 BPM..."). 200 to 350 characters each, complete sentences.

4. "sections": The song structure, one entry per section in order. ${structureSource} For each section:
   - "name": the section name, e.g. "Verse 1", "Chorus", "Bridge".
   - "bars": number of bars. "seconds": its length in seconds at the song's tempo (in 4/4, seconds = bars x 4 x 60 / BPM, rounded). "lines": number of lyric lines (0 for instrumental sections).
   - "rhyme": the end-rhyme scheme as letters, e.g. "ABAB" or "AABB" ("none" if instrumental).
   - "meter": REQUIRED. Syllables per line as a dot-separated pattern, e.g. "8.7.8.7". If it varies, give the most common pattern. Use "-" only for instrumental sections.
   - "description": 1 to 2 plain-English sentences on what the section does emotionally or structurally; note variations (e.g. "Chorus 2 adds a second vocal layer").
   - "suno_tags": the Suno section header with style hints, e.g. "[Verse 1 - sparse, intimate, fingerpicked guitar]" or "[Chorus - full band, soaring vocals, anthemic]": energy, instrumentation, vocal style and mood.

5. "sample_lyrics": Complete, ORIGINAL lyrics${topic ? ` about this topic: "${topic}"` : ' on a theme typical of this artist'}, written to fit the "sections" above exactly: the same sections in the same order, the same number of lines per section, the same rhyme scheme and the same syllables-per-line meter. Start each section with its "suno_tags" header on its own line, put each lyric line on its own line, and leave a blank line between sections. Instrumental sections get just their header. Do not reuse or paraphrase lines from any existing song${lyrics ? ', including the pasted lyrics' : ''}.${reference ? `\n\n${reference}` : ''}${lyrics ? `\n\nPASTED LYRICS (for structure analysis only; never reproduce them):\n<<<\n${lyrics}\n>>>` : ''}`;
}

/** The structure as plain text, for copying. */
export function formatSections(sections = []) {
  return sections.map((s) => [
    `[${(s.name || '').toUpperCase()}]`,
    s.lines > 0
      ? `${s.bars} bars (${s.seconds} secs / ${s.lines} lines). ${s.rhyme} ${s.meter} - ${s.description}`
      : `${s.bars} bars (${s.seconds} secs, instrumental) - ${s.description}`,
    `Suno tags: ${s.suno_tags}`,
  ].join('\n')).join('\n\n');
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
