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

/** Validate a key with one tiny call. Returns true/false, throws with message. */
export async function testKey(key) {
  for (const model of MODELS) {
    try {
      const d = await callOnce(model, key, { contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }] }, 20000);
      const text = (d?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
      if (/ok/i.test(text)) return true;
    } catch (e) { if (e.status === 400 || e.status === 403) throw new Error('Google did not accept this key. Make sure you copied the full key.'); }
  }
  throw new Error('The key could not be checked. Try again in a moment.');
}

/** Image generation attempt (Gemini image model). Returns a data URL or throws. */
export async function geminiImage(prompt, imagePart = null) {
  const keys = getKeys();
  if (!keys.length) throw new Error('Add your Gemini key first (Settings).');
  const parts = [{ text: prompt }];
  if (imagePart) parts.push(imagePart);
  let last;
  for (const key of keys) {
    try {
      const d = await callOnce('gemini-2.5-flash-image', key, { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'] } }, 90000);
      const img = (d?.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
      if (img) return `data:${img.inlineData.mimeType || 'image/png'};base64,${img.inlineData.data}`;
    } catch (e) { last = e; }
  }
  throw new Error(last ? `Image model: ${last.message}` : 'The image model did not answer.');
}

export const fileToInline = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve({ inlineData: { mimeType: file.type || 'image/jpeg', data: String(r.result).split(',')[1] } });
  r.onerror = reject;
  r.readAsDataURL(file);
});
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
