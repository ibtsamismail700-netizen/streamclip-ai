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
  // Bulk text work (briefs, hooks batches, caption chunks, transcript
  // scoring) runs LITE-first: lite models carry much higher free quotas,
  // and this work is quality-tolerant. Quality-critical single calls keep
  // the flagship-first 'text' order.
  bulk: ['gemini-2.5-flash-lite', 'gemini-3.8-flash', 'gemini-3-flash-preview'],
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
  // Bulk set: the same flash pool, but LITE models first (newest lite,
  // then the known high-quota lite, then any lite), with the flagship
  // order as backfill when the key has few or no lite models.
  const lite = flash.filter(n => n.includes('lite'));
  const bulkPicked = [];
  const bulkTiers = [
    lite.filter(n => n.startsWith('gemini-3')),
    lite.filter(n => n === 'gemini-2.5-flash-lite'),
    lite,
    ...tiers,
  ];
  for (const tier of bulkTiers) for (const n of tier) if (!bulkPicked.includes(n)) bulkPicked.push(n);
  const bulk = bulkPicked.slice(0, 3);
  // Image: anything with "image" in the name (Nano Banana family); the
  // everyday (non-Pro) model first when both exist.
  const imageAll = names.filter(n => n.includes('image'));
  const image = [...imageAll.filter(n => !n.includes('pro')), ...imageAll.filter(n => n.includes('pro'))].slice(0, 4);
  // TTS: anything with "tts" in the name.
  const tts = names.filter(n => n.includes('tts')).slice(0, 2);
  return { text, parts: text, bulk, image, tts };
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
      for (const kind of ['text', 'parts', 'bulk', 'image', 'tts']) {
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

/** Model names of one kind ('text' | 'parts' | 'bulk' | 'image' | 'tts') for these keys. */
async function modelsFor(keys, kind) {
  const sets = await resolveModelSets(keys[0]);
  if (sets[kind] && sets[kind].length) return sets[kind];
  // Model sets cached before the bulk set existed have no 'bulk': derive
  // it from the cached text set, lite models first.
  if (kind === 'bulk' && sets.text && sets.text.length) {
    const lite = sets.text.filter(n => n.includes('lite'));
    if (lite.length) return [...lite, ...sets.text.filter(n => !n.includes('lite'))];
  }
  return FALLBACK_MODELS[kind];
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

/** Google's own suggested wait after a 429, in SECONDS, uncapped (0 when it gives none). */
function rawRetrySec(e) {
  const details = e?.body?.error?.details || [];
  for (const d of details) {
    if (d && /RetryInfo/.test(d['@type'] || '') && d.retryDelay != null) {
      const s = parseFloat(d.retryDelay);
      if (Number.isFinite(s)) return s;
    }
  }
  const m = /retry in ([\d.]+)\s*s/i.exec(e?.message || '');
  return m ? parseFloat(m[1]) : 0;
}
/** Google's own suggested wait after a 429, in ms (0 when it gives none). */
function googleRetryMs(e, capMs = 30000) {
  const s = rawRetrySec(e);
  return s > 0 ? Math.min(capMs, Math.ceil(s * 1000)) : 0;
}

/* ---------------- Quota cooldown map ----------------
 * A free Gemini key has a small PER-MINUTE quota, per model. When Google
 * answers 429 (quota / rate), that (key, model) pair is exhausted until
 * its quota window resets — retrying it inside the same window only earns
 * another 429 and another "Google is busy" flash. So a rate-limited pair
 * is recorded here as COOLING until its reset moment (Google's own
 * RetryInfo delay when it gives one, else 60s for a 429 / 30s for a 503),
 * and rotation SKIPS cooling pairs entirely, moving straight to a pair
 * that can actually answer. The map lives in memory and is mirrored to
 * sessionStorage, so a page switch inside the same tab keeps cooldowns.
 */
const COOLDOWN_STORE = 'sc_cooldowns_v1';
const cooldowns = new Map(); // `${keyTag}|${model}` -> reset timestamp (ms)
let cooldownsLoaded = false;

function loadCooldowns() {
  if (cooldownsLoaded) return;
  cooldownsLoaded = true;
  try {
    const raw = JSON.parse(sessionStorage.getItem(COOLDOWN_STORE) || '{}');
    const now = Date.now();
    for (const [k, v] of Object.entries(raw)) if (Number(v) > now) cooldowns.set(k, Number(v));
  } catch { /* storage is best-effort */ }
}
function persistCooldowns() {
  try {
    const now = Date.now();
    const out = {};
    for (const [k, v] of cooldowns) if (v > now) out[k] = v;
    sessionStorage.setItem(COOLDOWN_STORE, JSON.stringify(out));
  } catch { /* storage is best-effort */ }
}
const pairId = (key, model) => `${keyTag(key)}|${model}`;

/** Record a (key, model) pair as cooling for durationMs from now. */
export function markCooldown(key, model, durationMs) {
  loadCooldowns();
  const ms = Math.max(0, Number(durationMs) || 0);
  if (!ms) return;
  cooldowns.set(pairId(key, model), Date.now() + ms);
  persistCooldowns();
}
/** Is this (key, model) pair still resting after a rate-limit hit? */
export function isCooling(key, model) {
  loadCooldowns();
  const until = cooldowns.get(pairId(key, model));
  return !!until && until > Date.now();
}
/** Ms until this pair can answer again (0 when it can). */
function cooldownLeft(key, model) {
  loadCooldowns();
  const until = cooldowns.get(pairId(key, model));
  return until ? Math.max(0, until - Date.now()) : 0;
}
/** Drop every recorded cooldown. */
export function clearCooldowns() {
  loadCooldowns();
  cooldowns.clear();
  persistCooldowns();
}
/**
 * Per-key rest status for the Settings list, parallel to getKeys():
 * { until } is the moment the key's FIRST resting model can answer again,
 * or null when no model on that key is resting.
 */
export function getKeyRestInfo() {
  loadCooldowns();
  const now = Date.now();
  return getKeys().map((key) => {
    const tag = keyTag(key) + '|';
    let until = null;
    for (const [id, v] of cooldowns) {
      if (id.startsWith(tag) && v > now && (until === null || v < until)) until = v;
    }
    return { until };
  });
}

/** A quota / rate-limit failure, however Google phrases it. */
const isQuotaError = (e) => !!e && (e.status === 429 || e.body?.error?.status === 'RESOURCE_EXHAUSTED' || /quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(e.message || ''));
/* A DAILY quota is a different beast from a per-minute one: the key is
 * done until tomorrow, so retrying the pair is pointless and the user
 * deserves a truthful message. Google signals it three ways: the
 * QuotaFailure detail names a per-day quota (quotaId "…PerDay…"), the
 * wording mentions a day/daily limit, or the RetryInfo delay runs to
 * many hours (the quota resets at midnight Pacific). */
const DAILY_COOLDOWN_CAP_MS = 6 * 60 * 60 * 1000; // stored rest for a daily hit, capped at 6h
function isDailyQuota(e) {
  if (!isQuotaError(e)) return false;
  let hay = String(e.message || '');
  try { hay += ' ' + JSON.stringify(e.body || {}); } catch { /* body is best-effort */ }
  if (/per.?day|daily/i.test(hay)) return true;
  return rawRetrySec(e) > 3 * 3600;
}
/** How long a rate-limited pair rests: Google's own delay when given. */
function cooldownMsFor(e) {
  if (isDailyQuota(e)) {
    // Rest until tomorrow-ish (Google's own delay when it gave one),
    // capped at 6 hours so the stored cooldown stays sane.
    const raw = rawRetrySec(e) * 1000;
    return raw > 0 ? Math.min(raw, DAILY_COOLDOWN_CAP_MS) : DAILY_COOLDOWN_CAP_MS;
  }
  const g = googleRetryMs(e, 120000);
  if (g > 0) return g;
  return e && e.status === 503 ? 30000 : 60000;
}

/* The final limit error tells the TRUTH about which limit was hit: a
 * finished daily quota (resets tomorrow) is not the same as a per-minute
 * one (a short wait fixes it). Google's real message rides along on the
 * error (googleMessage) for any card that wants to show it. */
const DAILY_LIMIT_MESSAGE = "Today's free limit on this key is finished — it resets tomorrow. Add another key in Settings to keep working now.";
const MINUTE_LIMIT_MESSAGE = 'Free limit reached — wait a minute, or add another key in Settings.';
function limitErrorFor(e, dailyHint = false) {
  const daily = e ? isDailyQuota(e) : dailyHint;
  const err = new Error(daily ? DAILY_LIMIT_MESSAGE : MINUTE_LIMIT_MESSAGE);
  err.dailyQuota = daily;
  if (e) { err.googleMessage = e.message || ''; err.status = e.status || 429; }
  return err;
}
const REST_CAP_MS = 65000;
/**
 * When EVERY pair in `pairs` is cooling, wait ONCE for the earliest reset
 * and say so once — "All free limits are resting — continuing in Ns…" —
 * instead of flashing "busy" over and over. Returns the ms waited (>= 0),
 * or -1 when the earliest reset is beyond the honest cap (the caller then
 * throws the limit error rather than parking the user).
 */
/** Ms until the soonest pair in `pairs` can answer again (0 when none is resting). */
function earliestRestMs(pairs) {
  let earliest = Infinity;
  for (const [model, key] of pairs) {
    const left = cooldownLeft(key, model);
    if (left > 0 && left < earliest) earliest = left;
  }
  return Number.isFinite(earliest) ? earliest : 0;
}
async function restForEarliestReset(pairs, onRetry, info = {}) {
  const earliest = earliestRestMs(pairs);
  if (!earliest) return 0;
  if (earliest > REST_CAP_MS) return -1;
  if (onRetry) {
    const waitSec = Math.max(1, Math.ceil(earliest / 1000));
    try { onRetry({ attempt: 1, total: 1, ...info, waitMs: earliest, resting: true, waitSec, message: `All free limits are resting — continuing in ${waitSec}s…` }); } catch { /* UI only */ } }
  await sleep(earliest);
  return earliest;
}

/**
 * Run one Gemini request across model × key rotation with quota-aware
 * rate-limit absorption. extract(d) returns the useful value from a
 * response, or a falsy value for a soft failure (HTTP 200 but nothing
 * usable).
 *
 * Strategy: rotate through every model × key pair — but pairs that are
 * COOLING after a 429 (see the cooldown map above) are skipped entirely:
 * retrying an exhausted pair inside its quota window only earns another
 * 429. A pair that answers 429/503 is marked cooling on the spot and the
 * rotation moves straight to the next pair. Pairs that fail any other way
 * (soft failure, hard error, retired model) are not retried in this call.
 *
 * If EVERY pair ends up cooling, the call waits ONCE for the earliest
 * quota reset — showing a single "All free limits are resting —
 * continuing in Ns…" progress line via opts.onRetry — and then tries the
 * freed pairs. If that earliest reset is more than ~65s away, the honest
 * limit error is thrown instead of parking the user. That single resting
 * wait is the only visible wait notice left: with cooldowns doing the
 * work, the old repeated "Google is busy — retrying" rounds are gone.
 *
 * Two hard ceilings keep the call honest: every attempt is aborted after
 * ~25s (a stalled request moves on instead of hanging), and the whole
 * call gives up after ~75s of attempts (the one resting wait, when it
 * happens, does not eat into that attempt budget).
 */
async function callWithRotation({ models, keys, timeoutMs = ATTEMPT_TIMEOUT_MS, makeBody, extract, failPrefix, emptyMessage, stopOnInvalidKey = true, onRetry = null }) {
  let deadline = Date.now() + TOTAL_BUDGET_MS;
  let last = null, rateError = null, retiredError = null;
  const combos = [];
  for (const model of models) for (const key of keys) combos.push([model, key]);
  const tried = new Set(); // pairIds attempted in this call that failed without rate-limiting
  let rested = false;      // the single all-cooling wait may happen once per call
  while (combos.length) {
    const pending = combos.filter(([model, key]) => !tried.has(pairId(key, model)) && !isCooling(key, model));
    if (!pending.length) {
      // Nothing attemptable: either everything left is cooling (one honest
      // wait for the earliest reset), or everything was already tried.
      const resting = combos.filter(([model, key]) => !tried.has(pairId(key, model)) && isCooling(key, model));
      if (resting.length && !rested) {
        rested = true;
        const waited = await restForEarliestReset(resting, onRetry);
        if (waited < 0) {
          // The soonest reset is beyond the honest wait cap. Say which
          // limit it really is: this call's own quota error when there is
          // one, else a pair resting for many hours means today's quota.
          throw limitErrorFor(rateError || last, earliestRestMs(resting) > 10 * 60 * 1000);
        }
        deadline += waited; // the wait is not part of the attempt budget
        continue;
      }
      break;
    }
    for (const [model, key] of pending) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        const d = await callOnce(model, key, makeBody(model, key), Math.min(timeoutMs, ATTEMPT_TIMEOUT_MS, remaining));
        const value = extract(d);
        if (value) return value;
        // Soft failure: keep rotating, but don't retry this combo later.
        tried.add(pairId(key, model));
      } catch (e) {
        if (stopOnInvalidKey && e.status === 400 && /API key not valid/i.test(e.message)) {
          throw new Error('Google did not accept your Gemini key. Check it in Settings.');
        }
        if (isRetiredModel(e)) {
          // Dead model name: skip it for the rest of this call and drop
          // the cached model list so the next call re-resolves what the
          // key can really use.
          retiredError = e;
          invalidateModelCache(key);
          tried.add(pairId(key, model));
          continue;
        }
        last = e;
        if (isRateLimit(e) || isQuotaError(e)) {
          // Mark the pair cooling and move on — it is NOT retried inside
          // its quota window. Other models/keys take over immediately,
          // and if none are left the loop above takes the one resting
          // wait for the earliest reset.
          markCooldown(key, model, cooldownMsFor(e));
          rateError = e;
        } else {
          tried.add(pairId(key, model));
        }
      }
    }
    // Loop again only when something may have become attemptable: pairs
    // still cooling (handled at the top via the resting wait). Anything
    // else means every pair was tried or is cooling after a rest — stop.
    const coolingLeft = combos.some(([model, key]) => !tried.has(pairId(key, model)) && isCooling(key, model));
    if (!coolingLeft) break;
    if (rested && Date.now() >= deadline) break;
  }
  if (last) {
    if (isRateLimit(last) || isQuotaError(last)) throw limitErrorFor(last);
    if (last.name === 'AbortError') throw new Error('Google took too long to answer. Check your connection and try again.');
    throw new Error(`${failPrefix}: ${last.message}`);
  }
  if (retiredError) {
    // Every model we tried was retired/unavailable for this key.
    throw new Error('The models on your Gemini key are not available right now. Open Settings and refresh the model list, or add another key.');
  }
  throw new Error(emptyMessage);
}

/**
 * Text (and optional inline parts) call with key + model rotation. Returns text.
 * `bulk: true` marks high-volume, quality-tolerant work (briefs, hooks
 * batches, caption chunks, transcript scoring): it resolves LITE models
 * first, whose free quotas are far higher. Leave it off for
 * quality-critical single calls (notes, exam answers, analysis).
 */
export async function geminiText(prompt, { json = false, parts = [], temperature = 0.6, onRetry = null, bulk = false } = {}) {
  const keys = getKeys();
  if (!keys.length) throw new Error('Add your Gemini key first (Settings).');
  const models = await modelsFor(keys, bulk ? 'bulk' : 'text');
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

/** Why an HTTP-200 image response carried no image — the real reason,
 * surfaced to the user instead of a generic "did not answer". */
function noImageReason(d) {
  const blocked = d?.promptFeedback?.blockReason;
  if (blocked) return `Google blocked the prompt (${blocked})`;
  const cand = d?.candidates?.[0];
  const txt = (cand?.content?.parts || []).map(p => p.text || '').join(' ').trim();
  if (txt) return `the model replied with text instead of an image: "${txt.slice(0, 140)}"`;
  if (cand?.finishReason && cand.finishReason !== 'STOP') return `the model stopped without an image (finishReason: ${cand.finishReason})`;
  return 'the model returned no image data';
}

/**
 * Image generation (Gemini image models). Returns a data URL or throws an
 * Error carrying Google's REAL message ("Image model error: …").
 *
 * This deliberately does NOT use callWithRotation: that helper caps every
 * attempt at ~25s (image generation routinely takes longer, so attempts
 * were aborted and the failure collapsed into a generic "did not
 * answer"), and it discards soft-failure detail. Here EVERY image-capable
 * model from the key's resolved list is tried in turn, each with its own
 * attempt budget: one pass over the keys at a 60s per-attempt timeout,
 * plus one retry pass when Google rate-limited (429/503) the first pass.
 * The quota cooldown map applies here too: a pair that answers 429 is
 * marked cooling and skipped (never retried inside its quota window),
 * and if every pair for a model is resting, the call takes the single
 * all-cooling wait for the earliest reset before retrying.
 * Retired model names are skipped for the rest of the call and the cached
 * model list is dropped, exactly as in callWithRotation.
 */
export async function geminiImage(prompt, imagePart = null, aspectRatio = null, { onRetry = null } = {}) {
  const keys = getKeys();
  if (!keys.length) throw new Error('Add your Gemini key first (Settings).');
  const parts = [{ text: prompt }];
  if (imagePart) parts.push(imagePart);
  const gc = { responseModalities: ['IMAGE'] };
  if (aspectRatio) gc.imageConfig = { aspectRatio };
  const body = { contents: [{ role: 'user', parts }], generationConfig: gc };
  const models = [...await modelsFor(keys, 'image')];
  for (const f of FALLBACK_MODELS.image) if (!models.includes(f)) models.push(f);
  const failures = [];
  let rested = false; // the whole call takes at most ONE all-cooling wait
  for (const model of models) {
    let lastErr = null, soft = null;
    const pairs = keys.map(k => [model, k]);
    for (let pass = 0; pass < 2; pass++) {
      if (!pairs.some(([m, k]) => !isCooling(k, m))) {
        // Every key for this model is resting after a 429: wait ONCE for
        // the earliest reset (shared across the whole call), then retry
        // the freed pairs. Beyond the cap, record and move on.
        if (rested) break;
        rested = true;
        const waited = await restForEarliestReset(pairs, onRetry);
        if (waited < 0) { lastErr = lastErr || Object.assign(new Error('rate limited'), { status: 429 }); break; }
      }
      let rateLimited = false;
      for (const key of keys) {
        if (isCooling(key, model)) continue; // resting pair — skip entirely
        try {
          const d = await callOnce(model, key, body, 60000);
          const img = (d?.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
          if (img) return `data:${img.inlineData.mimeType || 'image/png'};base64,${img.inlineData.data}`;
          soft = noImageReason(d); // HTTP 200 but no image — record why, try the next combo
        } catch (e) {
          if (e.status === 400 && /API key not valid/i.test(e.message)) {
            throw new Error('Google did not accept your Gemini key. Check it in Settings.');
          }
          lastErr = e;
          if (isRetiredModel(e)) { invalidateModelCache(key); break; }
          if (isRateLimit(e) || isQuotaError(e)) { markCooldown(key, model, cooldownMsFor(e)); rateLimited = true; continue; }
          break; // hard error for this model — recorded below; move to the next model
        }
      }
      if (!rateLimited) break;
    }
    failures.push({ model, err: lastErr, soft });
  }
  // Surface the REAL failure: a concrete Google error first, then a soft
  // (no-image) reason, then a rate-limit message — never a generic shrug.
  const hard = failures.find(f => f.err && !isRateLimit(f.err));
  if (hard) throw new Error(`Image model error: ${hard.err.status ? `HTTP ${hard.err.status} — ` : ''}${hard.err.message} (model: ${hard.model})`);
  const softF = failures.find(f => f.soft);
  if (softF) throw new Error(`Image model error: ${softF.soft} (model: ${softF.model})`);
  // A daily-quota failure gets the truthful daily message, not a raw 429:
  // the pair was marked cooling for hours on the spot, so it was never
  // retried inside this call either.
  const dailyF = failures.find(f => f.err && isDailyQuota(f.err));
  if (dailyF) {
    const err = new Error(`Image model error: ${DAILY_LIMIT_MESSAGE} (model: ${dailyF.model})`);
    err.googleMessage = dailyF.err.message || '';
    err.dailyQuota = true;
    throw err;
  }
  const rate = failures.find(f => f.err);
  if (rate) throw new Error(`Image model error: HTTP ${rate.err.status || 429} — ${rate.err.message} (model: ${rate.model})`);
  throw new Error('Image model error: no image model on your key answered. Open Settings and refresh the model list, or add another key.');
}

/** Gemini's built-in voices for text-to-speech (prebuilt voice names). */
export const GEMINI_VOICES = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'];

/**
 * General call with arbitrary content parts (text, inlineData, fileData…)
 * and key + model rotation. Returns the model's text.
 */
export async function geminiParts(parts, { json = false, temperature = 0.5, models = null, timeoutMs = 120000, onRetry = null, bulk = false } = {}) {
  const keys = getKeys();
  if (!keys.length) throw new Error('Add your Gemini key first (Settings).');
  const useModels = models && models.length ? models : await modelsFor(keys, bulk ? 'bulk' : 'parts');
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
