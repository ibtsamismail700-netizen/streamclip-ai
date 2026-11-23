// StreamClip AI — home page: app-style hero handoff, Live now categories, Your shorts.
// The hero and the category cards hand off to the Stream Clipper two ways at
// once (query param + a one-shot localStorage note) and the tool reads both.
import { toast } from './site.js';
import { esc } from './gemini.js';

const $ = (id) => document.getElementById(id);
const HANDOFF = 'sc_handoff_v1';
const SHORTS = 'sc_shorts_v1';

function goClipper(extra) {
  try { localStorage.setItem(HANDOFF, JSON.stringify({ ...extra, ts: Date.now() })); } catch {}
  const q = new URLSearchParams();
  if (extra.link) q.set('link', extra.link);
  if (extra.cat) q.set('cat', extra.cat);
  const qs = q.toString();
  location.href = 'tools/stream-clipper.html' + (qs ? '?' + qs : '');
}

/* ---------- hero: paste a link, find the best moments ---------- */
const link = $('herolink');
if (link) {
  const find = () => goClipper({ link: link.value.trim() });
  $('herofind').addEventListener('click', find);
  link.addEventListener('keydown', (e) => { if (e.key === 'Enter') find(); });
  $('heropaste').addEventListener('click', async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t && t.trim()) { link.value = t.trim(); toast('Link pasted — tap Find the best moments.'); }
      else { link.focus(); toast('Clipboard looks empty — paste the link into the box.', true); }
    } catch { link.focus(); toast('Tap the box and paste your link there.'); }
  });
}

/* ---------- Live now: category cards are plain links to live-now.html
   (the app opens a per-category "Live right now" results page, not the
   clipper). Only the Search card is wired here — it filters the grid. */
const cs = $('catsearch');
if (cs) {
  $('catsearchcard').addEventListener('click', () => { cs.classList.remove('hidden'); cs.focus(); });
  cs.addEventListener('input', () => {
    const q = cs.value.trim().toLowerCase();
    document.querySelectorAll('.cat[data-cat]').forEach(c => {
      const hit = !q || (c.dataset.cat + ' ' + (c.dataset.sub || '')).toLowerCase().includes(q);
      c.classList.toggle('hidden', !hit);
    });
  });
}

/* ---------- Your shorts (finished clips saved by the tools in this browser) ---------- */
(function renderShorts() {
  const grid = $('shortsgrid');
  if (!grid) return;
  let shorts = [];
  try { shorts = JSON.parse(localStorage.getItem(SHORTS) || '[]'); } catch {}
  if (!Array.isArray(shorts)) shorts = [];
  const count = $('shortscount');
  if (count) count.textContent = shorts.length ? String(shorts.length) : '';
  const empty = $('shortsempty');
  if (!shorts.length) { if (empty) empty.classList.remove('hidden'); return; }
  if (empty) empty.classList.add('hidden');
  grid.innerHTML = shorts.map(s => `<div class="tile"><div class="th"${s.thumb ? ` style="background-image:url('${s.thumb}')"` : ''}><span class="tag">${s.when ? esc(new Date(s.when).toLocaleDateString()) : 'Short'}</span></div><div class="tt">${esc(s.title || 'Untitled short')}</div></div>`).join('');
})();
