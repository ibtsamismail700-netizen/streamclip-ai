// StreamClip AI — shared helpers (toast) + Settings page logic.
import { getKeys, addKey, removeKey, checkKey, fetchModelList, getKeyRestInfo, requireKey, hasKey, familyRestInfo, testKeyFamilies, getActivity, clearActivity, esc } from './gemini.js';

export function toast(msg, bad = false) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.toggle('bad', bad);
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 3400);
}
window.__toast = toast;

/* ---------- "Your work" — results persist on this device ----------
 * Every successful generation saves its result payload here (text-sized
 * payloads only; oversized ones are skipped), the homepage shows them
 * under "Recent work", and each tool restores its own last result when
 * the page opens — so a refresh or a stray tap no longer loses work. */
export const WORK_LS = 'sc_work_v1';
export const WORK_LINKS = {
  hooks: ['Hooks + Title Generator', 'tools/hooks-title-generator.html'],
  translate: ['Caption Translation', 'tools/caption-translation.html'],
  notes: ['Lecture to Notes', 'tools/lecture-notes.html'],
  'notes-sheet': ['Lecture to Notes — revision sheet', 'tools/lecture-notes.html'],
  flashcards: ['Flashcards + Quiz', 'tools/flashcards-quiz.html'],
  presentation: ['Video Presentation Maker', 'tools/presentation-maker.html'],
  clipper: ['Stream Clipper', 'tools/stream-clipper.html'],
  'podcast-clipper': ['Podcast Clipper', 'tools/podcast-clipper.html'],
  thumbnail: ['Thumbnail Creator', 'tools/thumbnail-creator.html'],
  'thumbnail-rd': ['Thumbnail Redesigner', 'tools/thumbnail-creator.html'],
  'lecture-clips': ['Lecture to Revision Clips', 'tools/lecture-clips.html'],
  examprep: ['Exam Prep — Questions', 'tools/exam-prep.html'],
  'upload-video': ['Upload Your Own Video', 'tools/upload-video.html'],
  'your-branding': ['Your Branding', 'tools/your-branding.html'],
};
export function getWork() { try { const a = JSON.parse(localStorage.getItem(WORK_LS) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }
export function saveWork(kind, title, payload) {
  try {
    if (JSON.stringify(payload).length > 900000) return; // text payloads only — skip image-heavy results that would blow the quota
    const arr = getWork().filter(w => w.kind !== kind);
    arr.unshift({ kind, title: String(title || 'Untitled'), t: Date.now(), payload });
    localStorage.setItem(WORK_LS, JSON.stringify(arr.slice(0, 20)));
  } catch { /* storage full/blocked — the live result still shows */ }
}
export function workFor(kind) { return getWork().find(w => w.kind === kind) || null; }

/* ---------- Key prompt on page load ----------
 * A first-time visitor should learn a key is needed BEFORE filling in a
 * whole form: when a tool page has the keyprompt slot and no key exists,
 * render the same note requireKey() shows on click — without scrolling. */
if (document.getElementById('keyprompt') && !hasKey()) requireKey({ scroll: false });

/* ---------- Resting-limits notice (tool pages) ----------
 * When EVERY (key, model) pair for the family a tool needs is cooling
 * after a rate-limit hit, say so once, slim, at the top of the tool —
 * instead of surprising the user mid-run. Quiet when things are fine;
 * re-checked every 30s so it clears itself when the rest ends. */
const TOOL_FAMILIES = {
  thumbnail: ['image'], profilepic: ['image'],
  presentation: ['text', 'tts'], scriptshort: ['text', 'image', 'tts'],
  dub: ['text', 'tts'],
};
const FAMILY_NAMES = { text: 'text & video', image: 'image', tts: 'voice' };
(function restNotice() {
  const toolName = document.body?.dataset?.tool;
  if (!toolName || !hasKey()) return;
  const fams = TOOL_FAMILIES[toolName] || ['text'];
  const prefix = (location.pathname.includes('/tools/') || location.pathname.includes('/blog/')) ? '../' : '';
  let el = null;
  const paint = async () => {
    let resting = null;
    for (const f of fams) { const info = await familyRestInfo(f); if (info.resting) { resting = { fam: f, until: info.until }; break; } }
    if (!resting) { if (el) { el.remove(); el = null; } return; }
    const clock = new Date(resting.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (!el) {
      el = document.createElement('div');
      el.className = 'note restnote';
      const anchor = document.getElementById('keyprompt') || document.querySelector('.wrap');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(el, anchor.nextSibling);
      else document.body.prepend(el);
    }
    el.innerHTML = `<div><b>Free limits are resting.</b><div class="small dim">Google has paused the ${FAMILY_NAMES[resting.fam] || resting.fam} models on your key${getKeys().length > 1 ? 's' : ''} until about ${clock}. <a href="${prefix}settings.html">Add another key in Settings</a> to keep working now, or wait until then.</div></div>`;
  };
  paint();
  setInterval(paint, 30000);
})();

// Settings page (settings.html)
const keyList = document.getElementById('keylist');
if (keyList) {
  const fmtClock = (ts) => { const d = new Date(ts); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':'); };
  // Per-key status from the quota cooldown map: a key whose model hit the
  // free limit shows "Resting until HH:MM:SS" while rotation works the
  // other keys; it flips back to "Active" on its own when the rest ends.
  const paintRest = () => {
    const rest = getKeyRestInfo();
    keyList.querySelectorAll('[data-rest]').forEach(el => {
      const info = rest[Number(el.dataset.rest)];
      if (info && info.until) { el.textContent = `Resting until ${fmtClock(info.until)}`; el.className = 'tag rest'; }
      else { el.textContent = 'Active'; el.className = 'tag ok'; }
    });
  };
  const render = () => {
    const keys = getKeys();
    keyList.innerHTML = keys.length
      ? keys.map((k, i) => `<div class="spread mt"><span class="tag">Key ${i + 1} · ••••${esc(k.slice(-6))}</span><span class="spread" style="gap:8px"><span class="tag ok" data-rest="${i}">Active</span><button class="chip" data-del="${i}">Remove</button></span></div>`).join('')
        + (keys.length < 10 ? '<button class="chip mt" id="addanother">＋ Add another key</button>' : '')
      : '<p class="sub mt">No key added yet. Follow the steps below to create yours — it takes about a minute.</p>';
    keyList.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { removeKey(Number(b.dataset.del)); render(); toast('Key removed.'); }));
    const aa = document.getElementById('addanother');
    if (aa) aa.addEventListener('click', () => { const inp = document.getElementById('keyinput'); if (inp) { inp.scrollIntoView({ behavior: 'smooth', block: 'center' }); inp.focus(); } });
    paintRest();
  };
  render();
  setInterval(paintRest, 5000); // keep Active/Resting live as cooldowns expire
  document.getElementById('addkey').addEventListener('click', async (ev) => {
    const input = document.getElementById('keyinput');
    const k = input.value.trim();
    if (k.length < 20) { toast('That does not look like a Gemini key. Copy the full key.', true); return; }
    if (getKeys().includes(k)) { toast('This key is already added.'); return; }
    const b = ev.currentTarget;
    b.disabled = true; b.innerHTML = '<span class="spin"></span> Adding…';
    // The visitor's own key is saved FIRST — adding a key never depends on
    // our check. The check only reports the key's status afterwards.
    addKey(k);
    input.value = '';
    render();
    const r = await checkKey(k);
    if (r.state === 'verified') toast('Key added and verified with Google. All AI tools are now unlocked.');
    else if (r.state === 'rejected') toast('Key added, but Google says this key is not valid. Check you copied the full key, or create a fresh one and add that instead.', true);
    else toast('Key added. Google could not be reached to verify it just now — the tools will use it as-is.');
    b.disabled = false; b.innerHTML = 'Add key';
    loadUnlock();
  });

  // "What your key unlocks" — display-only model list from Google.
  const unlockHost = document.getElementById('unlock');
  const GROUPS = [
    { title: 'AI text, analysis, video watching & moment scoring', desc: 'Powers the Stream Clipper scan (these models also watch YouTube videos and read images/thumbnails), hooks & titles, lecture notes, translation, flashcards and quizzes.', free: 'Free tier: generous daily allowance on the Flash and Flash-Lite models — plenty for daily clipping and study.', test: (n, m) => (m.supportedGenerationMethods || []).includes('generateContent') && !/image|tts|live|embedding|aqa|computer|robot/.test(n) },
    { title: 'Thumbnail image generation', desc: 'Powers the AI backgrounds in Thumbnail Creator.', free: 'Free tier: a small daily allowance on the preview image model.', test: (n) => /image|imagen/.test(n) },
    { title: 'AI voices (text-to-speech)', desc: 'Powers the Play-voice buttons in Video Presentation Maker — 30 Gemini voices.', free: 'Free tier: a limited daily allowance on the preview TTS model.', test: (n) => /tts/.test(n) },
    { title: 'Live voice & realtime models', desc: 'Realtime audio models your key can also reach (not needed by the tools here).', free: 'Free tier: limited preview access.', test: (n) => /live|native-audio/.test(n) },
    { title: 'Embeddings & utilities', desc: 'Building-block models for developers; the tools here do not need them.', free: 'Free tier: small allowances.', test: (n) => /embedding|aqa|computer|robot|gemma/.test(n) },
  ];
  async function loadUnlock() {
    if (!unlockHost) return;
    const keys = getKeys();
    if (!keys.length) { unlockHost.innerHTML = '<p class="sub mt">Add a key above and this panel fills in automatically.</p>'; return; }
    unlockHost.innerHTML = '<p class="sub mt">Asking Google what this key can use…</p>';
    try {
      const models = await fetchModelList(keys[0]);
      const usable = models.filter(m => (m.supportedGenerationMethods || []).includes('generateContent'));
      const used = new Set();
      const cards = [];
      for (const g of GROUPS) {
        const mine = usable.filter(m => { const n = (m.name || '').replace('models/', ''); return !used.has(n) && g.test(n, m); });
        mine.forEach(m => used.add((m.name || '').replace('models/', '')));
        if (!mine.length) continue;
        cards.push(`<div class="outcard"><b>${g.title}</b><p class="small dim mt">${g.desc}</p>
          <div class="chips mt">${mine.map(m => `<span class="chip" style="cursor:default">${esc(m.displayName || m.name.replace('models/', ''))}</span>`).join('')}</div>
          <p class="small dim mt">${g.free}</p></div>`);
      }
      const rest = usable.filter(m => !used.has((m.name || '').replace('models/', '')));
      unlockHost.innerHTML = `<p class="sub mt">Google reports <b>${usable.length} generation models</b> on your key:</p>${cards.join('')}
        ${rest.length ? `<div class="outcard"><b>Also available</b><div class="chips mt">${rest.map(m => `<span class="chip" style="cursor:default">${esc(m.displayName || m.name.replace('models/', ''))}</span>`).join('')}</div></div>` : ''}
        <p class="small dim mt">Free-tier allowances are set by Google and can change; if a tool ever says your limit is used up, waiting or adding a second key (another Google account) in Settings is the fix.</p>`;
    } catch (e) {
      unlockHost.innerHTML = `<p class="sub mt">Could not load the model list from Google just now (${esc(e.message)}). Your key is saved and the tools will still use it — tap "Refresh the list from Google" to try again.</p>`;
    }
  }
  const ub = document.getElementById('unlockbtn');
  if (ub) ub.addEventListener('click', loadUnlock);
  loadUnlock();

  /* ----- Test my key: one tiny real call per family ----- */
  const testBtn = document.getElementById('testkey');
  if (testBtn) testBtn.addEventListener('click', async () => {
    if (!getKeys().length) { toast('Add a key first, then test it.', true); return; }
    testBtn.disabled = true; testBtn.innerHTML = '<span class="spin"></span> Testing…';
    const host = document.getElementById('testresult');
    try {
      const r = await testKeyFamilies();
      const names = { text: 'Text, analysis & video watching', image: 'Thumbnail images', tts: 'AI voices (text-to-speech)' };
      const row = (k) => {
        const v = r[k];
        if (!v) return '';
        const state = v.state === 'working' ? `<span class="tag ok">Working</span><span class="small dim">${esc(v.model || '')}</span>`
          : v.state === 'resting' ? `<span class="tag rest">Resting until ${fmtClock(v.until)}</span>`
          : `<span class="tag" style="background:rgba(255,91,79,.16);color:#ff9a92">Error</span><span class="small dim">${esc(v.message || '')}</span>`;
        return `<div class="spread mt"><span><b>${names[k]}</b></span><span class="spread" style="gap:8px">${state}</span></div>`;
      };
      if (host) host.innerHTML = row('text') + row('image') + row('tts') + '<p class="small dim mt">The test uses your first key and one tiny call per kind — the same calls the tools make. A "Resting" result means Google has paused that kind on this key for now; the other keys keep working.</p>';
    } catch (e) { if (host) host.innerHTML = `<p class="sub mt">The test could not run: ${esc(e.message)}</p>`; }
    testBtn.disabled = false; testBtn.textContent = 'Test my key';
  });

  /* ----- Activity log: the last real errors on this device ----- */
  const actHost = document.getElementById('actlog');
  const paintActivity = () => {
    if (!actHost) return;
    const rows = getActivity();
    actHost.innerHTML = rows.length
      ? rows.map(a => `<div class="outcard"><div class="spread"><b>${esc(a.tool || 'tool')}</b><span class="small dim">${esc(new Date(a.t).toLocaleString())}</span></div><p class="small mt">${esc(a.msg)}</p></div>`).join('')
      : '<p class="sub mt">No errors recorded — when a tool hits a problem, the real message lands here.</p>';
  };
  paintActivity();
  const ac = document.getElementById('actcopy');
  if (ac) ac.addEventListener('click', () => {
    const txt = getActivity().map(a => `[${new Date(a.t).toISOString()}] ${a.tool || 'tool'}: ${a.msg}`).join('\n');
    if (!txt) { toast('Nothing to copy yet.'); return; }
    navigator.clipboard.writeText(txt).then(() => toast('Activity log copied.')).catch(() => toast('Copy failed — select the text manually.', true));
  });
  const acl = document.getElementById('actclear');
  if (acl) acl.addEventListener('click', () => { clearActivity(); paintActivity(); toast('Activity log cleared.'); });

  /* ----- Clear ALL StreamClip AI data from this browser ----- */
  const cd = document.getElementById('cleardata');
  if (cd) cd.addEventListener('click', () => {
    if (!window.confirm('Remove everything StreamClip AI keeps in this browser? That means your Gemini keys, Your Shorts posters, saved work, branding kit, lecture handoffs and the activity log. This cannot be undone.')) return;
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('sc_')) doomed.push(k); }
    doomed.forEach(k => localStorage.removeItem(k));
    try { sessionStorage.removeItem('sc_cooldowns_v1'); } catch { /* ignore */ }
    toast('All StreamClip AI data cleared from this browser.');
    setTimeout(() => location.reload(), 600);
  });
}
