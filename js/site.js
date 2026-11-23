// StreamClip AI — shared helpers (toast) + Settings page logic.
import { getKeys, addKey, removeKey, checkKey, fetchModelList, getKeyRestInfo, esc } from './gemini.js';

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
    b.disabled = false; b.innerHTML = 'Check and add';
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
}
