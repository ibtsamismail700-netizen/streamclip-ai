// StreamClip AI — home page: app-style hero handoff, Live now categories, Your shorts.
// The hero and the category cards hand off to the Stream Clipper two ways at
// once (query param + a one-shot localStorage note) and the tool reads both.
import { toast, getWork, WORK_LINKS } from './site.js';
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
    let shown = 0;
    document.querySelectorAll('.cat[data-cat]').forEach(c => {
      const hit = !q || (c.dataset.cat + ' ' + (c.dataset.sub || '')).toLowerCase().includes(q);
      c.classList.toggle('hidden', !hit);
      if (hit) shown++;
    });
    // A search that matches nothing must say so (and offer the way out),
    // not leave a silently empty grid.
    const empty = $('catempty');
    if (empty) {
      empty.classList.toggle('hidden', shown > 0 || !q);
      if (!shown && q) empty.innerHTML = `<b>No category matches "${esc(cs.value.trim())}" in this list.</b><p class="small dim mt">You can <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(cs.value.trim() + ' live')}&sp=EgJAAQ%253D%253D" target="_blank" rel="noopener">search YouTube for "${esc(cs.value.trim())} live" streams</a> instead — or clear the search to browse every category.</p>`;
    }
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
  const note = $('shortsnote');
  if (note) note.classList.remove('hidden');
  grid.innerHTML = shorts.map(s => {
    const tool = WORK_LINKS[s.tool] || WORK_LINKS['upload-video'];
    return `<a class="tile" href="${tool[1]}" title="Open ${esc(tool[0])} — the tool that made this short"><div class="th"${s.thumb ? ` style="background-image:url('${s.thumb}')"` : ''}><span class="tag">${s.when ? esc(new Date(s.when).toLocaleDateString()) : 'Short'}</span></div><div class="tt">${esc(s.title || 'Untitled short')}</div></a>`;
  }).join('');
})();

/* ---------- Recent work: results the tools saved on this device ---------- */
(function renderWork() {
  const host = $('recentwork');
  if (!host) return;
  const items = getWork().slice(0, 6);
  if (!items.length) return;
  const sec = $('recentsec');
  if (sec) sec.classList.remove('hidden');
  host.innerHTML = items.map(w => {
    const link = WORK_LINKS[w.kind] || ['Tool', 'tools/stream-clipper.html'];
    return `<a class="toolcard" href="${link[1]}"><span class="tag y">${esc(link[0])}</span><h3>${esc(w.title)}</h3><p>${esc(new Date(w.t).toLocaleString())} — tap to reopen it in the tool.</p></a>`;
  }).join('');
})();
