// StreamClip AI — Live Now results page.
// A static site has no server and no YouTube Data API key, so it cannot pull
// YouTube's real live list. This page therefore never fabricates streams: its
// main action opens YouTube's own live search for the category (new tab),
// and a pasted stream link hands off to the Stream Clipper like the home hero.
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
