// StreamClip AI — Live Now results page.
// On load it asks the site's own /api/live function for YouTube's real live
// list for this category (the API key stays server-side) and renders real
// stream cards. If that function is not configured or YouTube is unavailable,
// it falls back to the honest design below: a button opening YouTube's own
// live search for the category (new tab). Streams are never fabricated, and
// a pasted stream link hands off to the Stream Clipper like the home hero.
import { toast } from './site.js';

const $ = (id) => document.getElementById(id);
const CATS = {
  'gta-6': 'GTA 6',
  'gta-5-rp': 'GTA 5 RP',
  'fortnite': 'Fortnite',
  'minecraft': 'Minecraft',
  'free-fire': 'Free Fire',
  'bgmi-pubg': 'BGMI / PUBG',
  'valorant': 'Valorant',
  'call-of-duty': 'Call of Duty',
  'roblox': 'Roblox',
  'just-chatting': 'Just Chatting',
  'irl': 'IRL',
};

const slug = new URLSearchParams(location.search).get('cat') || '';
const name = CATS[slug] || 'Live streams';

document.title = `${name} — Live right now | StreamClip AI`;
$('lntitle').textContent = name;
$('lnhead').textContent = `Live in ${name}`;
$('lncat1').textContent = name;
$('lncat2').textContent = name;

// YouTube search with the "Live" feature filter (sp=EgJAAQ%253D%253D).
const yt = $('ytbtn');
yt.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' live')}&sp=EgJAAQ%253D%253D`;
yt.textContent = `See who is live in ${name} on YouTube`;

/* ---------- real live list from /api/live, fallback design on any failure ---------- */
const loadingEl = $('lnloading');
const listEl = $('lnstreams');
const fallbackEl = $('lnfallback');

function showFallback() {
  loadingEl.hidden = true;
  listEl.hidden = true;
  fallbackEl.hidden = false;
}

function fmtWatching(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 'Live now';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M watching`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K watching`;
  return `${n} watching`;
}

function renderStreams(streams) {
  listEl.innerHTML = '';
  for (const s of streams) {
    const url = s.url || `https://www.youtube.com/watch?v=${s.id || ''}`;
    // The card itself opens the Stream Clipper with this stream loaded
    // (the app's flow); a small separate link still opens it on YouTube.
    const a = document.createElement('div');
    a.className = 'live-row cardlink';
    a.setAttribute('role', 'link');
    a.title = 'Clip this stream with StreamClip AI';

    const th = document.createElement('div');
    th.className = 'live-th';
    if (s.thumbnail) th.style.backgroundImage = `url("${s.thumbnail}")`;
    const tag = document.createElement('span');
    tag.className = 'tag live';
    tag.textContent = 'LIVE';
    th.appendChild(tag);

    const tx = document.createElement('div');
    tx.className = 'live-tx';
    const b = document.createElement('b');
    b.textContent = s.title || 'Live stream';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = s.channel || '';
    const watch = document.createElement('span');
    watch.className = 'watch';
    watch.textContent = fmtWatching(s.viewers);
    const yt = document.createElement('a');
    yt.className = 'ytgo small';
    yt.href = url;
    yt.target = '_blank';
    yt.rel = 'noopener';
    yt.textContent = 'Watch on YouTube ↗';
    yt.addEventListener('click', (e) => e.stopPropagation());
    tx.append(b, who, watch, yt);

    a.append(th, tx);
    a.addEventListener('click', () => {
      try {
        localStorage.setItem('sc_handoff_v1', JSON.stringify({
          link: url, title: s.title || '', channel: s.channel || '',
          live: true, viewers: typeof s.viewers === 'number' ? s.viewers : null, ts: Date.now(),
        }));
      } catch {}
      location.href = 'tools/stream-clipper.html?link=' + encodeURIComponent(url);
    });
    listEl.appendChild(a);
  }
}

async function loadLive() {
  if (!slug) { showFallback(); return; }
  loadingEl.hidden = false;
  listEl.hidden = true;
  fallbackEl.hidden = true;
  try {
    // Bounded wait: a hung function must fall back to the honest YouTube
    // search design, not spin forever.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    let r;
    try { r = await fetch(`/api/live?cat=${encodeURIComponent(slug)}`, { signal: ctl.signal }); }
    finally { clearTimeout(timer); }
    if (!r.ok) throw new Error(`api ${r.status}`);
    const d = await r.json();
    if (!d || !Array.isArray(d.streams) || !d.streams.length) throw new Error('no streams');
    renderStreams(d.streams);
    loadingEl.hidden = true;
    listEl.hidden = false;
    const fresh = $('lnfresh');
    if (fresh) {
      const clock = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      fresh.innerHTML = `Live list fetched at ${clock} · <button class="chip" id="lnrefresh" type="button">Refresh</button>`;
      fresh.classList.remove('hidden');
      const rb = $('lnrefresh');
      if (rb) rb.addEventListener('click', loadLive);
    }
  } catch { showFallback(); }
}
loadLive();

/* ---------- paste a stream link -> Stream Clipper (same handoff as home) ---------- */
const link = $('lnlink');
function clip() {
  const v = link.value.trim();
  try { localStorage.setItem('sc_handoff_v1', JSON.stringify({ link: v, ts: Date.now() })); } catch {}
  location.href = 'tools/stream-clipper.html' + (v ? '?link=' + encodeURIComponent(v) : '');
}
$('lnclip').addEventListener('click', clip);
link.addEventListener('keydown', (e) => { if (e.key === 'Enter') clip(); });
$('lnpaste').addEventListener('click', async () => {
  try {
    const t = await navigator.clipboard.readText();
    if (t && t.trim()) { link.value = t.trim(); toast('Link pasted — tap Clip this stream.'); }
    else { link.focus(); toast('Clipboard looks empty — paste the link into the box.', true); }
  } catch { link.focus(); toast('Tap the box and paste your link there.'); }
});
