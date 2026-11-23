// StreamClip AI — bring-your-own Gemini key.
// Keys live only in this browser (localStorage). Every AI call goes from this
// browser straight to Google with the visitor's own key. The site has no key.
const KEY_STORE = 'sc_gemini_keys_v1';
const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

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
    if (!r.ok) { const e = new Error(d?.error?.message || `HTTP ${r.status}`); e.status = r.status; throw e; }
    return d;
  } finally { clearTimeout(t); }
}

/** Text (and optional inline parts) call with key + model rotation. Returns text. */
export async function geminiText(prompt, { json = false, parts = [], temperature = 0.6 } = {}) {
  const keys = getKeys();
  if (!keys.length) throw new Error('Add your Gemini key first (Settings).');
  let last;
  for (const model of MODELS) {
    for (const key of keys) {
      try {
        const body = { contents: [{ role: 'user', parts: [{ text: prompt }, ...parts] }], generationConfig: { temperature } };
        if (json) body.generationConfig.responseMimeType = 'application/json';
        const d = await callOnce(model, key, body);
        const text = (d?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
        if (text) return text;
      } catch (e) { last = e; if (e.status === 400 && /API key not valid/i.test(e.message)) throw new Error('Google did not accept your Gemini key. Check it in Settings.'); }
    }
  }
  if (last?.status === 429) throw new Error('Your free Gemini limit is used up for now. Wait a little, or add another key in Settings.');
  throw new Error(last ? `Gemini said: ${last.message}` : 'Gemini did not answer. Try again.');
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
  for (const model of MODELS) {
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
export async function geminiImage(prompt, imagePart = null, aspectRatio = null) {
  const keys = getKeys();
  if (!keys.length) throw new Error('Add your Gemini key first (Settings).');
  const parts = [{ text: prompt }];
  if (imagePart) parts.push(imagePart);
  let last;
  for (const key of keys) {
    try {
      const gc = { responseModalities: ['IMAGE'] };
      if (aspectRatio) gc.imageConfig = { aspectRatio };
      const d = await callOnce('gemini-2.5-flash-image', key, { contents: [{ role: 'user', parts }], generationConfig: gc }, 120000);
      const img = (d?.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
      if (img) return `data:${img.inlineData.mimeType || 'image/png'};base64,${img.inlineData.data}`;
    } catch (e) { last = e; }
  }
  throw new Error(last ? `Image model: ${last.message}` : 'The image model did not answer.');
}

/** Gemini's built-in voices for text-to-speech (prebuilt voice names). */
export const GEMINI_VOICES = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'];

/**
 * General call with arbitrary content parts (text, inlineData, fileData…)
 * and key + model rotation. Returns the model's text.
 */
export async function geminiParts(parts, { json = false, temperature = 0.5, models = MODELS, timeoutMs = 120000 } = {}) {
  const keys = getKeys();
  if (!keys.length) throw new Error('Add your Gemini key first (Settings).');
  let last;
  for (const model of models) {
    for (const key of keys) {
      try {
        const body = { contents: [{ role: 'user', parts }], generationConfig: { temperature } };
        if (json) body.generationConfig.responseMimeType = 'application/json';
        const d = await callOnce(model, key, body, timeoutMs);
        const text = (d?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
        if (text) return text;
      } catch (e) { last = e; if (e.status === 400 && /API key not valid/i.test(e.message)) throw new Error('Google did not accept your Gemini key. Check it in Settings.'); }
    }
  }
  if (last?.status === 429) throw new Error('Your free Gemini limit is used up for now. Wait a little, or add another key in Settings.');
  throw new Error(last ? `Gemini said: ${last.message}` : 'Gemini did not answer. Try again.');
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
export async function geminiYouTubeJson(url, prompt, { startSec = null, endSec = null, timeoutMs = 240000 } = {}) {
  const part = { fileData: { fileUri: url, mimeType: 'video/*' } };
  if (startSec !== null || endSec !== null) {
    part.videoMetadata = {};
    if (startSec !== null) part.videoMetadata.startOffset = `${Math.max(0, Math.round(startSec))}s`;
    if (endSec !== null) part.videoMetadata.endOffset = `${Math.max(1, Math.round(endSec))}s`;
  }
  return geminiPartsJson([part, { text: prompt }], { temperature: 0.4, timeoutMs });
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
export async function geminiTTS(text, voice = 'Kore') {
  const keys = getKeys();
  if (!keys.length) throw new Error('Add your Gemini key first (Settings).');
  let last;
  for (const key of keys) {
    try {
      const body = {
        contents: [{ role: 'user', parts: [{ text: String(text).slice(0, 4000) }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      };
      const d = await callOnce('gemini-2.5-flash-preview-tts', key, body, 120000);
      const part = (d?.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
      if (!part) throw new Error('The voice model returned no audio.');
      const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1] || 24000);
      return new Blob([pcmToWav(part.inlineData.data, rate)], { type: 'audio/wav' });
    } catch (e) { last = e; }
  }
  throw new Error(last ? `Voice model: ${last.message}` : 'The voice model did not answer.');
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
