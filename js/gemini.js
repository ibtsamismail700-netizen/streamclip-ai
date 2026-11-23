// StreamClip AI — bring-your-own Gemini key.
// Keys live only in this browser (localStorage). Every AI call goes from this
// browser straight to Google with the visitor's own key. The site has no key.
const KEY_STORE = 'sc_gemini_keys_v1';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

// Google retires model names for new keys without warning (the 2.x names
// below stopped working for fresh keys in Nov 2026), so model names are
// resolved DYNAMICALLY from the key's own model list — see resolveModelSets.
// These static lists are only the fallback for when the list can't be
// fetched (offline, blocked) or a kind classifies empty.
const FALLBACK_MODELS = {
  text: ['gemini-3.8-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash-lite'],
  parts: ['gemini-3.8-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash-lite'],
  image: ['gemini-2.5-flash-image'],
  tts: ['gemini-2.5-flash-preview-tts'],
};

/* ---------------- Dynamic model resolution ----------------
 * On first need we ask Google which models THIS key can actually use
 * (fetchModelList), keep the ones that support generateContent, classify
 * them into text / parts / image / tts sets, and cache the result per key
 * in localStorage for 24h so a tool run costs no extra list call.
 */
const MODEL_CACHE_STORE = 'sc_models_v1';
const MODEL_CACHE_TTL = 24 * 60 * 60 * 1000;
const modelCacheMem = new Map();   // keyTag -> classified sets
const modelInflight = new Map();   // keyTag -> Promise<sets>

function keyTag(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = ((h * 31) + key.charCodeAt(i)) >>> 0;
  return h.toString(36) + '_' + key.slice(-4);
}

function readModelCache(tag) {
  try {
    const all = JSON.parse(localStorage.getItem(MODEL_CACHE_STORE) || '{}');
    const e = all[tag];
    if (e && e.sets && Date.now() - e.at < MODEL_CACHE_TTL) return e.sets;
  } catch { /* cache is best-effort */ }
  return null;
}
function writeModelCache(tag, sets) {
  try {
    const all = JSON.parse(localStorage.getItem(MODEL_CACHE_STORE) || '{}');
    all[tag] = { at: Date.now(), sets };
    localStorage.setItem(MODEL_CACHE_STORE, JSON.stringify(all));
  } catch { /* cache is best-effort */ }
}
/** Drop a key's cached model sets (e.g. after Google says a model is gone). */
function invalidateModelCache(key) {
  const tag = keyTag(key);
  modelCacheMem.delete(tag);
  try {
    const all = JSON.parse(localStorage.getItem(MODEL_CACHE_STORE) || '{}');
    if (all[tag]) { delete all[tag]; localStorage.setItem(MODEL_CACHE_STORE, JSON.stringify(all)); }
  } catch { /* cache is best-effort */ }
}

/** Classify a raw model list (from fetchModelList) into per-kind name sets. */
function classifyModels(list) {
  const names = (list || [])
    .filter(m => m && Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map(m => String(m.name || '').replace(/^models\//, ''))
    .filter(Boolean);
  // Text / parts / video: flash models that are not image or TTS variants.
  // Preference: the exact current flash name, then any gemini-3 flash,
  // then the high-quota lite, then whatever flash remains. Cap at 3.
  const flash = names.filter(n => n.includes('flash') && !n.includes('image') && !n.includes('tts'));
  const picked = [];
  const tiers = [
    flash.filter(n => n === 'gemini-3.8-flash'),
    flash.filter(n => n.startsWith('gemini-3')),
    flash.filter(n => n === 'gemini-2.5-flash-lite'),
    flash,
  ];
  for (const tier of tiers) for (const n of tier) if (!picked.includes(n)) picked.push(n);
  const text = picked.slice(0, 3);
  // Image: anything with "image" in the name (Nano Banana family); the
  // everyday (non-Pro) model first when both exist.
  const imageAll = names.filter(n => n.includes('image'));
  const image = [...imageAll.filter(n => !n.includes('pro')), ...imageAll.filter(n => n.includes('pro'))].slice(0, 2);
  // TTS: anything with "tts" in the name.
  const tts = names.filter(n => n.includes('tts')).slice(0, 2);
  return { text, parts: text, image, tts };
}

async function resolveModelSets(key) {
  const tag = keyTag(key);
  if (modelCacheMem.has(tag)) return modelCacheMem.get(tag);
  const cached = readModelCache(tag);
  if (cached) { modelCacheMem.set(tag, cached); return cached; }
  if (modelInflight.has(tag)) return modelInflight.get(tag);
  const p = (async () => {
    try {
      const list = await Promise.race([
        fetchModelList(key),
        new Promise((_, rej) => setTimeout(() => rej(new Error('model list timeout')), 10000)),
      ]);
      const sets = classifyModels(list);
      for (const kind of ['text', 'parts', 'image', 'tts']) {
        if (!sets[kind] || !sets[kind].length) sets[kind] = FALLBACK_MODELS[kind];
      }
      writeModelCache(tag, sets);
      modelCacheMem.set(tag, sets);
      return sets;
    } catch {
      return FALLBACK_MODELS; // list unreachable — static names; don't cache failures
    } finally { modelInflight.delete(tag); }
  })();
  modelInflight.set(tag, p);
  return p;
}

/** Model names of one kind ('text' | 'parts' | 'image' | 'tts') for these keys. */
async function modelsFor(keys, kind) {
  const sets = await resolveModelSets(keys[0]);
  return sets[kind] && sets[kind].length ? sets[kind] : FALLBACK_MODELS[kind];
}

export const getKeys = () => {
  try { return JSON.parse(localStorage.getItem(KEY_STORE) || '[]').filter(k => typeof k === 'string' && k.length > 10); }
  catch { return []; }
};
export const hasKey = () => getKeys().length > 0;
export const saveKeys = (keys) => localStorage.setItem(KEY_STORE, JSON.stringify(keys.slice(0, 10)));
export const addKey = (k) => { const ks = getKeys(); if (!ks.includes(k)) ks.push(k); saveKeys(ks); };
export const removeKey = (i) => { const ks = getKeys(); ks.splice(i, 1); saveKeys(ks); };

export function requireKey() {
  if (hasKey()) return true;
  const host = document.getElementById('keyprompt');
  if (host) {
    host.innerHTML = `<div class="note">${'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L20 3M17 6l3 3M14 9l2 2"/></svg>'}
      <div><b>Add your Gemini key first</b><div class="small dim">This tool runs on your own free Gemini key. Add it once in Settings — it stays in your browser and goes only to Google.</div>
      <a class="btn sm mt" href="${rootPath()}settings.html">Add your Gemini key</a></div></div>`;
    host.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return false;
}
export function rootPath() {
  return location.pathname.includes('/tools/') ? '../' : '';
}

async function callOnce(model, key, body, timeoutMs = 60000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body), signal: ctl.signal,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d?.error?.message || `HTTP ${r.status}`); e.status = r.status; e.body = d; throw e; }
    return d;
  } finally { clearTimeout(t); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRateLimit = (e) => !!e && (e.status === 429 || e.status === 503);
// Google retiring / renaming a model answers 400/404 with wording like
// "This model … is no longer available to new users" or "not found / not
// supported". Such a model is dead for this key: never retry it, just move
// on to the next model in the rotation.
const isRetiredModel = (e) => !!e && (e.status === 400 || e.status === 404) && /no longer available|not found|not supported/i.test(e.message || '');
// Hard ceilings so no single user action can spin forever: each fetch
// attempt is aborted after ~25s, and rotation + retries together get
// ~75s before the honest error is shown.
const ATTEMPT_TIMEOUT_MS = 25000;
const TOTAL_BUDGET_MS = 75000;
// Waits between full rotation rounds when everything is rate-limited.
const BACKOFF_MS = [4000, 12000, 30000];

/** Google's own suggested wait after a 429, in ms (0 when it gives none). */
function googleRetryMs(e) {
  const details = e?.body?.error?.details || [];
  for (const d of details) {
    if (d && /RetryInfo/.test(d['@type'] || '') && d.retryDelay != null) {
      const s = parseFloat(d.retryDelay);
      if (Number.isFinite(s)) return Math.min(30000, Math.ceil(s * 1000));
    }
  }
  const m = /retry in ([\d.]+)\s*s/i.exec(e?.message || '');
  if (m) return Math.min(30000, Math.ceil(parseFloat(m[1]) * 1000));
  return 0;
}

/**
 * Run one Gemini request across model × key rotation with rate-limit
 * absorption. extract(d) returns the useful value from a response, or a
 * falsy value for a soft failure (HTTP 200 but nothing usable).
 *
 * Strategy: rotate through every model/key first — a 429/503 on one combo
 * moves straight to the next. Only when a whole round was rate-limited do
 * we wait (Google's own retryDelay when it gives one, capped at 30s,
 * otherwise ~4s, then ~12s, then ~30s) and retry just the rate-limited
 * combos, up to 3 waits. The "free limit" error is thrown only after all
 * of that is exhausted.
 *
 * Two hard ceilings keep the wait honest: every attempt is aborted after
 * ~25s (a stalled request moves on instead of hanging), and the whole
 * call — rotation plus retries — gives up after ~75s. While a backoff
 * wait runs, opts.onRetry({ attempt, total, waitMs }) fires so the UI can
 * say "Google is busy — retrying…" instead of spinning in silence.
 */
async function callWithRotation({ models, keys, timeoutMs = ATTEMPT_TIMEOUT_MS, makeBody, extract, failPrefix, emptyMessage, stopOnInvalidKey = true, onRetry = null }) {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let last = null, rateError = null, retiredError = null;
  let pending = [];
  for (const model of models) for (const key of keys) pending.push([model, key]);
  for (let round = 0; round <= BACKOFF_MS.length && pending.length; round++) {
    if (round > 0) {
      const wait = Math.min(Math.max(BACKOFF_MS[round - 1], googleRetryMs(rateError)), deadline - Date.now());
      if (wait <= 0) break;
      if (onRetry) { try { onRetry({ attempt: round, total: BACKOFF_MS.length, waitMs: wait }); } catch { /* UI only */ } }
      await sleep(wait);
    }
    const retry = [];
    for (const [model, key] of pending) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        const d = await callOnce(model, key, makeBody(model, key), Math.min(timeoutMs, ATTEMPT_TIMEOUT_MS, remaining));
        const value = extract(d);
        if (value) return value;
        // Soft failure: keep rotating, but don't retry this combo later.
      } catch (e) {
        if (stopOnInvalidKey && e.status === 400 && /API key not valid/i.test(e.message)) {
          throw new Error('Google did not accept your Gemini key. Check it in Settings.');
        }
        if (isRetiredModel(e)) {
          // Dead model name: skip it for the rest of this call (it is not
          // added to the backoff retry list) and drop the cached model
          // list so the next call re-resolves what the key can really use.
          retiredError = e;
          invalidateModelCache(key);
          continue;
        }
        last = e;
        if (isRateLimit(e)) { retry.push([model, key]); rateError = e; }
      }
    }
    pending = retry;
    if (Date.now() >= deadline) break;
  }
  if (last) {
    if (isRateLimit(last)) throw new Error('Your free Gemini limit is used up for now. Wait a little, or add another key in Settings.');
    if (last.name === 'AbortError') throw new Error('Google took too long to answer. Check your connection and try again.');
    throw new Error(`${failPrefix}: ${last.message}`);
  }
  if (retiredError) {
    // Every model we tried was retired/unavailable for this key.
    throw new Error('The models on your Gemini key are not available right now. Open Settings and refresh the model list, or add another key.');
  }
  throw new Error(emptyMessage);
}

/** Text (and optional inline parts) call with key + model rotation. Returns text. */
export async function geminiText(prompt, { json = false, parts = [], temperature = 0.6, onRetry = null } = {}) {
  const keys = getKeys();
  if (!keys.length) throw new Error('Add your Gemini key first (Settings).');
  const models = await modelsFor(keys, 'text');
  return callWithRotation({
    models, keys, timeoutMs: 60000, onRetry,
    makeBody: () => {
      const body = { contents: [{ role: 'user', parts: [{ text: prompt }, ...parts] }], generationConfig: { temperature } };
      if (json) body.generationConfig.responseMimeType = 'application/json';
      return body;
    },
    extract: (d) => (d?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim() || null,
    failPrefix: 'Gemini said',
    emptyMessage: 'Gemini did not answer. Try again.',
  });
}

export async function geminiJson(prompt, opts = {}) {
  const text = await geminiText(prompt, { ...opts, json: true });
  let s = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), b = s.indexOf('[');
  const start = a < 0 ? b : b < 0 ? a : Math.min(a, b);
  if (start < 0) throw new Error('The AI reply could not be read. Try again.');
  const end = s.lastIndexOf(s[start] === '{' ? '}' : ']');
  try { return JSON.parse(s.slice(start, end + 1)); } catch { throw new Error('The AI reply could not be read. Try again.'); }
}

/**
 * Check a key WITHOUT blocking on the result. The key belongs to the visitor
 * and is always saved by the caller first; this only reports its status:
 * 'verified' (Google accepted it), 'rejected' (Google said the key itself is
 * not valid), or 'unchecked' (Google could not be reached / no clear answer).
 */
export async function checkKey(key) {
  // Lightest check first: list models (no generation quota used).
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models', { headers: { 'x-goog-api-key': key } });
    if (r.ok) return { state: 'verified' };
    const d = await r.json().catch(() => ({}));
    const msg = d?.error?.message || '';
    if ((r.status === 400 || r.status === 403) && /API key not valid|API_KEY_INVALID/i.test(msg)) return { state: 'rejected', message: msg };
  } catch { /* network failure — fall through to the generation check */ }
  for (const model of FALLBACK_MODELS.text) {
    try {
      const d = await callOnce(model, key, { contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }] }, 20000);
      const text = (d?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
      if (/ok/i.test(text)) return { state: 'verified' };
    } catch (e) {
      if ((e.status === 400 || e.status === 403) && /API key not valid|API_KEY_INVALID/i.test(e.message)) return { state: 'rejected', message: e.message };
    }
  }
  return { state: 'unchecked' };
}

/** Backwards-compatible wrapper: true when Google verified the key. */
export async function testKey(key) {
  const r = await checkKey(key);
  if (r.state === 'rejected') throw new Error('Google did not accept this key. Make sure you copied the full key.');
  return r.state === 'verified';
}

/** Image generation attempt (Gemini image model). Returns a data URL or throws. */
export async function geminiImage(prompt, imagePart = null, aspectRatio = null, { onRetry = null } = {}) {
  const keys = getKeys();
  if (!keys.length) throw new Error('Add your Gemini key first (Settings).');
  const parts = [{ text: prompt }];
  if (imagePart) parts.push(imagePart);
  const models = await modelsFor(keys, 'image');
  return callWithRotation({
    models, keys, timeoutMs: 120000, onRetry,
    makeBody: () => {
      const gc = { responseModalities: ['IMAGE'] };
      if (aspectRatio) gc.imageConfig = { aspectRatio };
      return { contents: [{ role: 'user', parts }], generationConfig: gc };
    },
    extract: (d) => {
      const img = (d?.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
      return img ? `data:${img.inlineData.mimeType || 'image/png'};base64,${img.inlineData.data}` : null;
    },
    failPrefix: 'Image model',
    emptyMessage: 'The image model did not answer.',
    stopOnInvalidKey: false,
  });
}

/** Gemini's built-in voices for text-to-speech (prebuilt voice names). */
export const GEMINI_VOICES = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'];

/**
 * General call with arbitrary content parts (text, inlineData, fileData…)
 * and key + model rotation. Returns the model's text.
 */
export async function geminiParts(parts, { json = false, temperature = 0.5, models = null, timeoutMs = 120000, onRetry = null } = {}) {
  const keys = getKeys();
  if (!keys.length) throw new Error('Add your Gemini key first (Settings).');
  const useModels = models && models.length ? models : await modelsFor(keys, 'parts');
  return callWithRotation({
    models: useModels, keys, timeoutMs, onRetry,
    makeBody: () => {
      const body = { contents: [{ role: 'user', parts }], generationConfig: { temperature } };
      if (json) body.generationConfig.responseMimeType = 'application/json';
      return body;
    },
    extract: (d) => (d?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim() || null,
    failPrefix: 'Gemini said',
    emptyMessage: 'Gemini did not answer. Try again.',
  });
}

/** JSON variant of geminiParts. */
export async function geminiPartsJson(parts, opts = {}) {
  const text = await geminiParts(parts, { ...opts, json: true });
  let s = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), b = s.indexOf('[');
  const start = a < 0 ? b : b < 0 ? a : Math.min(a, b);
  if (start < 0) throw new Error('The AI reply could not be read. Try again.');
  const end = s.lastIndexOf(s[start] === '{' ? '}' : ']');
  try { return JSON.parse(s.slice(start, end + 1)); } catch { throw new Error('The AI reply could not be read. Try again.'); }
}

/**
 * Ask Gemini about a YouTube video directly from its URL (native video
 * understanding). Optionally restrict attention to a time window in seconds
 * via videoMetadata offsets. Returns parsed JSON.
 */
export async function geminiYouTubeJson(url, prompt, { startSec = null, endSec = null, timeoutMs = 240000, onRetry = null } = {}) {
  const part = { fileData: { fileUri: url, mimeType: 'video/*' } };
  if (startSec !== null || endSec !== null) {
    part.videoMetadata = {};
    if (startSec !== null) part.videoMetadata.startOffset = `${Math.max(0, Math.round(startSec))}s`;
    if (endSec !== null) part.videoMetadata.endOffset = `${Math.max(1, Math.round(endSec))}s`;
  }
  return geminiPartsJson([part, { text: prompt }], { temperature: 0.4, timeoutMs, onRetry });
}

/** List the models a key can use (for the Settings "what your key unlocks" panel). */
export async function fetchModelList(key) {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': key } });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d?.error?.message || `HTTP ${r.status}`); }
  const d = await r.json();
  return d.models || [];
}

/**
 * Gemini text-to-speech. Returns a playable WAV Blob.
 * Gemini TTS answers with raw 16-bit PCM; we wrap it in a WAV header.
 */
export async function geminiTTS(text, voice = 'Kore', { onRetry = null } = {}) {
  const keys = getKeys();
  if (!keys.length) throw new Error('Add your Gemini key first (Settings).');
  const models = await modelsFor(keys, 'tts');
  return callWithRotation({
    models, keys, timeoutMs: 120000, onRetry,
    makeBody: () => ({
      contents: [{ role: 'user', parts: [{ text: String(text).slice(0, 4000) }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
    extract: (d) => {
      const part = (d?.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
      if (!part) return null;
      const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1] || 24000);
      return new Blob([pcmToWav(part.inlineData.data, rate)], { type: 'audio/wav' });
    },
    failPrefix: 'Voice model',
    emptyMessage: 'The voice model did not answer.',
    stopOnInvalidKey: false,
  });
}

function pcmToWav(b64, rate) {
  const bin = atob(b64);
  const pcm = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) pcm[i] = bin.charCodeAt(i);
  const head = new DataView(new ArrayBuffer(44));
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) head.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF'); head.setUint32(4, 36 + pcm.length, true); wstr(8, 'WAVE'); wstr(12, 'fmt ');
  head.setUint32(16, 16, true); head.setUint16(20, 1, true); head.setUint16(22, 1, true);
  head.setUint32(24, rate, true); head.setUint32(28, rate * 2, true); head.setUint16(32, 2, true);
  head.setUint16(34, 16, true); wstr(36, 'data'); head.setUint32(40, pcm.length, true);
  return new Uint8Array([...new Uint8Array(head.buffer), ...pcm]);
}

export const fileToInline = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve({ inlineData: { mimeType: file.type || 'image/jpeg', data: String(r.result).split(',')[1] } });
  r.onerror = reject;
  r.readAsDataURL(file);
});
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
