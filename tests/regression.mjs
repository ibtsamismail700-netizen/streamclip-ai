// StreamClip AI — regression suite (run before every push).
//
//   node tests/regression.mjs
//
// Covers the failure modes that actually bit users in production:
//   1. Model resolution — flagship-first for quality calls, lite-first
//      for bulk calls, non-Pro image model first (from the key's own
//      model list, never hard-coded names).
//   2. Cooldown skip — a (key, model) pair resting after a rate-limit
//      hit is not attempted again.
//   3. Limit classification — a per-DAY quota error produces the
//      "today's free limit is finished" message; a plain per-minute 429
//      produces the "wait a minute" message. Never a raw "Google is
//      busy" and never the wrong one of the two.
//   4. Brief-batch parsing — the Redesigner's one-call designer briefs
//      split correctly, tolerate partial replies, reject garbage.
//   5. Size snapshot — the thumbnail SIZES table keeps its exact pixel
//      dimensions and valid model aspect ratios, and the per-run
//      snapshot (snapSize) is actually used by the generation paths.
//
// Everything runs against stubs: no network, no real key.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/* ---------------- environment stubs (before any site import) ---------------- */
function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    _map: m,
  };
}
globalThis.localStorage = makeStorage();
globalThis.sessionStorage = makeStorage();
globalThis.window = globalThis;
globalThis.location = { pathname: '/', search: '', href: 'http://test/' };
globalThis.document = {
  body: { dataset: {} },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
  addEventListener: () => {},
};
// Fast-forward: the gemini layer's honest waits (seconds/minutes) must
// not slow the suite. Deadline maths uses the NOMINAL wait values, so
// capping the real sleep is safe.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, Math.min(Number(ms) || 0, 25), ...a);

/* ---------------- fetch stub ---------------- */
const MODELS = {
  models: [
    { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-image-pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
  ],
};
const TEXT_OK = { candidates: [{ content: { parts: [{ text: 'ok' }] } }] };
const IMG_OK = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'QUJD' } }] } }] };
const DAILY_429 = { error: { code: 429, message: 'Quota exceeded for quota metric \'GenerateRequestsPerDayPerProjectPerModel-FreeTier\' (limit: 20)', status: 'RESOURCE_EXHAUSTED', details: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] } };
const MINUTE_429 = { error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } };

let fetchMode = 'ok'; // 'ok' | 'daily' | 'minute'
let attempted = [];   // model names hit on generateContent, in order
globalThis.fetch = async (url) => {
  const u = String(url);
  const json = (obj, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) });
  if (u.includes('/models?')) return json(MODELS);
  const m = u.match(/models\/([^:?]+):generateContent/);
  if (m) {
    attempted.push(m[1]);
    if (fetchMode === 'daily') return json(DAILY_429, 429);
    if (fetchMode === 'minute') return json(MINUTE_429, 429);
    return json(m[1].includes('image') ? IMG_OK : TEXT_OK);
  }
  return json({}, 404);
};

/* ---------------- tiny test runner ---------------- */
let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
const freshGemini = (tag) => import(pathToFileURL(path.join(ROOT, 'js/gemini.js')).href + `?t=${tag}`);
function seedKey(g) {
  // Keys live in localStorage as an array of plain strings.
  localStorage.setItem('sc_gemini_keys_v1', JSON.stringify(['TESTKEY-0123456789']));
  return g;
}
// Groups must not inherit each other's cooldowns/model cache through
// storage (in a browser those belong to one page session; here each
// group simulates a fresh one).
function resetStorage() { localStorage._map.clear(); sessionStorage._map.clear(); }

/* ---------------- 1. model resolution ---------------- */
console.log('Model resolution');
{
  const g = seedKey(await freshGemini('res'));
  attempted = [];
  await g.geminiText('hello');
  check('quality text call tries the flagship first', attempted[0] === 'gemini-3.8-flash', `got ${attempted[0]}`);
  attempted = [];
  await g.geminiText('hello', { bulk: true });
  check('bulk text call tries the lite model first', attempted[0] === 'gemini-2.5-flash-lite', `got ${attempted[0]}`);
  attempted = [];
  await g.geminiImage('a red circle', null, '16:9');
  check('image call tries the non-Pro image model first', attempted[0] === 'gemini-2.5-flash-image', `got ${attempted[0]}`);
}

/* ---------------- 2. cooldown skip ---------------- */
console.log('Cooldown skip');
{
  resetStorage();
  const g = seedKey(await freshGemini('cool'));
  g.markCooldown('TESTKEY-0123456789', 'gemini-3.8-flash', 60000);
  attempted = [];
  await g.geminiText('hello');
  check('resting flagship is skipped', attempted[0] === 'gemini-2.5-flash-lite', `got ${attempted[0]}`);
}

/* ---------------- 3. limit classification + messages ---------------- */
console.log('Limit classification');
{
  resetStorage();
  const g = seedKey(await freshGemini('daily'));
  fetchMode = 'daily';
  let msg = '';
  try { await g.geminiText('hello'); } catch (e) { msg = e.message; }
  check('daily quota says today\'s limit is finished', /Today's free limit on this key is finished/.test(msg), `got: ${msg}`);
  const rest = await g.familyRestInfo('text');
  check('family reports resting after a daily hit', rest.resting === true && rest.until > Date.now());
  fetchMode = 'ok';
}
{
  resetStorage();
  const g = seedKey(await freshGemini('minute'));
  fetchMode = 'minute';
  let msg = '';
  try { await g.geminiText('hello'); } catch (e) { msg = e.message; }
  check('per-minute 429 says wait a minute / add another key', /Free limit reached — wait a minute, or add another key in Settings/.test(msg), `got: ${msg}`);
  check('per-minute message never claims the day is over', !/Today's free limit/.test(msg));
  fetchMode = 'ok';
}

/* ---------------- 4. brief-batch parsing ---------------- */
console.log('Brief-batch parsing');
{
  const t = await import(pathToFileURL(path.join(ROOT, 'js/tools.js')).href + '?t=brief');
  const p = t.__test.parseBriefBatch;
  const full = p({ A: ' brief a ', B: 'brief b' }, ['A', 'B']);
  check('full batch parses and trims', full && full.A === 'brief a' && full.B === 'brief b');
  const partial = p({ A: 'only a' }, ['A', 'B']);
  check('partial batch keeps what exists', partial && partial.A === 'only a' && !('B' in partial));
  check('empty strings are unusable', p({ A: '  ' }, ['A']) === null);
  check('garbage is unusable', p(null, ['A']) === null && p('text', ['A']) === null && p(42, ['A']) === null);
}

/* ---------------- 5. size snapshot ---------------- */
console.log('Thumbnail size system');
{
  const src = readFileSync(path.join(ROOT, 'js/tools.js'), 'utf8');
  const m = src.match(/const SIZES = \{([\s\S]*?)\n  \};/);
  check('SIZES table found in tools.js', !!m);
  const SIZES = eval(`({${m[1]}})`);
  const expect = {
    youtube: [1280, 720], shorts: [1080, 1920], igpost: [1080, 1080], igportrait: [1080, 1350],
    fbpost: [1200, 630], fbad: [1200, 628], fbcover: [1640, 924], classic: [1280, 960],
  };
  check('exactly the 8 platform sizes', Object.keys(SIZES).length === 8, `got ${Object.keys(SIZES).length}`);
  for (const [k, px] of Object.entries(expect)) {
    check(`${k} is ${px[0]}×${px[1]}`, SIZES[k] && SIZES[k].px[0] === px[0] && SIZES[k].px[1] === px[1], `got ${SIZES[k] && SIZES[k].px}`);
  }
  const aspects = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']);
  check('every model aspect is one the image API accepts', Object.values(SIZES).every(s => aspects.has(s.model)));
  check('generation runs snapshot the size (snapSize used ≥3×)', (src.match(/snapSize\(\)/g) || []).length >= 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
