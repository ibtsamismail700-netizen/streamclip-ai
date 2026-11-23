// StreamClip AI — tool logic, wave 2 (Podcast Clipper, Script-to-Short,
// Score My Short, Repurpose Pack, Auto Captions, Mock Test, Handwritten
// Notes, Assignment Builder, Profile Picture Maker).
// All AI runs in the browser on the visitor's key, via js/gemini.js only.
import { requireKey, hasKey, geminiText, geminiJson, geminiImage, geminiParts, geminiPartsJson, geminiYouTubeJson, geminiTTS, GEMINI_VOICES, fileToInline, esc } from './gemini.js';
import { toast } from './site.js';

const $ = (id) => document.getElementById(id);
const tool = document.body.dataset.tool;
const busy = (btn, on, label) => { btn.disabled = on; btn.innerHTML = on ? '<span class="spin"></span> Working…' : label; };
const retryMsg = (info) => info?.message || `Google is busy — retrying (${info?.attempt}/${info?.total})…`;
const retryNote = (btn, el) => (info) => {
  const msg = retryMsg(info);
  if (btn) btn.innerHTML = `<span class="spin"></span> ${msg}`;
  if (el) el.textContent = msg;
};
/* AlphaPost-pattern pacing: a short breather between sequential Gemini
 * calls, longer after a limit hit — bursts never slam the per-minute quota. */
const pace = (ms) => new Promise((r) => setTimeout(r, ms));
const hitLimit = (e) => !!e && /free limit|limit reached|quota|429|rate/i.test(e.message || '');
const breather = (prevErr) => pace(prevErr && hitLimit(prevErr) ? 8000 : 2000);
/* Job progress ring (shared, AlphaPost-style) — honest % only: steps
 * completed plus a within-step fraction where the code truly knows it. */
function makeProgress(container, stepNames) {
  if (!container) return { setStep() {}, setFraction() {}, done() {}, fail() {} };
  const C = 2 * Math.PI * 52;
  container.innerHTML = `<div class="prog"><div class="ringwrap"><svg class="ring" viewBox="0 0 132 132"><circle class="track" cx="66" cy="66" r="52" fill="none" stroke-width="11"/><circle class="bar" cx="66" cy="66" r="52" fill="none" stroke-width="11" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg><div class="pct">0%</div></div><div class="pstep"></div><ul class="psteps">${stepNames.map((s, i) => `<li data-i="${i}"><span class="n">${i + 1}</span><span class="t">${esc(s)}</span></li>`).join('')}</ul><p class="pmsg hidden"></p></div>`;
  const bar = container.querySelector('.bar'), pctEl = container.querySelector('.pct'), cur = container.querySelector('.pstep'), msg = container.querySelector('.pmsg');
  const lis = [...container.querySelectorAll('.psteps li')];
  const N = stepNames.length;
  let step = 0, frac = 0, failed = false;
  const paint = () => {
    const p = Math.max(0, Math.min(100, Math.round(((step + frac) / N) * 100)));
    bar.style.strokeDashoffset = String(C * (1 - p / 100));
    pctEl.textContent = p + '%';
    lis.forEach((li, i) => {
      li.className = i < step ? 'done' : i === step ? (failed ? 'bad' : 'now') : '';
      li.querySelector('.n').textContent = i < step ? '✓' : String(i + 1);
    });
    if (!failed && step < N) cur.textContent = lis[step].querySelector('.t').textContent;
  };
  paint();
  return {
    setStep(i, name) { step = Math.max(0, Math.min(N - 1, i)); frac = 0; if (name && lis[step]) lis[step].querySelector('.t').textContent = name; paint(); },
    setFraction(f) { frac = Math.max(0, Math.min(1, Number(f) || 0)); paint(); },
    done() { step = N - 1; frac = 1; paint(); },
    fail(m) { failed = true; container.querySelector('.prog').classList.add('fail'); paint(); if (m) { msg.textContent = m; msg.classList.remove('hidden'); } },
  };
}
const out = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
function download(name, content, type) {
  const a = document.createElement('a');
  a.href = content instanceof Blob ? URL.createObjectURL(content) : URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click();
}
function fmt(s) { s = Math.max(0, Math.round(Number(s) || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; }
function parseTs(v) {
  if (typeof v === 'number') return v;
  const s = String(v || '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/(?:(\d+):)?([0-5]?\d):([0-5]\d)/);
  if (m) return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  const m2 = s.match(/(\d+):([0-5]\d)/);
  if (m2) return Number(m2[1]) * 60 + Number(m2[2]);
  return null;
}
function copyText(t, msg = 'Copied.') { navigator.clipboard.writeText(t).then(() => toast(msg)).catch(() => toast('Copy failed — select the text manually.', true)); }
function chunkText(text, size = 5000) {
  const blocks = text.split(/\n\s*\n/); const chunks = []; let cur = '';
  for (const b of blocks) { if ((cur + '\n\n' + b).length > size && cur) { chunks.push(cur); cur = b; } else cur = cur ? cur + '\n\n' + b : b; }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [text];
}
const ytId = (u) => { const m = String(u || '').match(/(?:youtube\.com\/(?:watch\?[^#]*v=|live\/|shorts\/)|youtu\.be\/)([\w-]{6,})/); return m ? m[1] : ''; };
/** Chip-group wiring: container id + data attribute → callback with value. */
function wireChips(boxId, attr, fn) {
  const box = $(boxId); if (!box) return;
  box.querySelectorAll(`[data-${attr}]`).forEach(c => c.addEventListener('click', () => {
    box.querySelectorAll(`[data-${attr}]`).forEach(x => x.classList.toggle('on', x === c));
    fn(c.dataset[attr]);
  }));
}

/* ---------- Student Mode: shared lecture source (YouTube / PDF / text) ----------
 * Same pattern as the first student tools: one analyse prepares the material
 * once; every student tool — here and via the sc_student_source_v1 handoff —
 * then works from that same material without rescanning. */
const STUDENT_TOOLS2 = ['mocktest', 'handwritten'];
const SRC_LS = 'sc_student_source_v1';
const SRC_FROM = { notes: 'Notes', flashcards: 'Flashcards + Quiz', presentation: 'Presentation Maker', 'lecture-clips': 'Revision Clips', examprep: 'Exam Prep', mocktest: 'Mock Test', handwritten: 'Handwritten Notes', assignment: 'Assignment Builder' };
let SRC = null; // {type:'youtube'|'pdf'|'text', link, videoId, text, pdfName, title, durationSec, chapters:[{title,startSec}], ready}
const srcYtId = (u) => { const m = String(u || '').match(/(?:youtube\.com\/(?:watch\?[^#]*v=|live\/|shorts\/)|youtu\.be\/)([\w-]{6,})/); return m ? m[1] : ''; };
const srcPart = () => ({ fileData: { fileUri: SRC.link, mimeType: 'video/*' } });
const srcReady = () => !!(SRC && SRC.ready);
function requireSource() {
  if (srcReady()) return true;
  toast('First add your lecture in Step 1 — a YouTube link, a PDF, or pasted text — and tap Analyse.', true);
  const el = $('srccard'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return false;
}
async function sourceJson(prompt, opts = {}) {
  if (!srcReady()) throw new Error('Add your lecture source first (Step 1).');
  if (SRC.type === 'youtube') return geminiPartsJson([srcPart(), { text: prompt }], { temperature: 0.5, timeoutMs: 240000, ...opts });
  return geminiJson(`${prompt}\n\n--- THE MATERIAL ---\n${String(SRC.text || '').slice(0, 60000)}`, opts);
}
async function sourceText(prompt, opts = {}) {
  if (!srcReady()) throw new Error('Add your lecture source first (Step 1).');
  if (SRC.type === 'youtube') return geminiParts([srcPart(), { text: prompt }], { temperature: 0.5, timeoutMs: 240000, ...opts });
  return geminiText(`${prompt}\n\n--- THE MATERIAL ---\n${String(SRC.text || '').slice(0, 60000)}`, opts);
}
function sstep(id, state, text) { const el = $(id); if (!el) return; el.className = 'step' + (state ? ' ' + state : ''); const s = el.querySelector('span:last-child'); if (s && text) s.textContent = text; }
function saveHandoff() {
  if (!SRC) return;
  try {
    localStorage.setItem(SRC_LS, JSON.stringify({
      type: SRC.type, link: SRC.link || '', text: SRC.type === 'youtube' ? '' : (SRC.text || ''),
      pdfName: SRC.pdfName || '', title: SRC.title || '', durationSec: SRC.durationSec || 0,
      chapters: SRC.chapters || [], from: tool,
    }));
  } catch { /* a very large PDF text may exceed storage — the page still works */ }
}
function renderSrcSummary() {
  const host = $('srcsummary'); if (!host) return;
  if (!srcReady()) { host.innerHTML = ''; return; }
  const isYt = SRC.type === 'youtube';
  const head = isYt ? 'Lecture analysed' : SRC.type === 'pdf' ? 'PDF analysed' : 'Text ready';
  const meta = isYt
    ? `${esc(SRC.title || 'YouTube lecture')}${SRC.durationSec ? ` · ${fmt(SRC.durationSec)} long` : ''}`
    : SRC.type === 'pdf'
      ? `${esc(SRC.pdfName || 'Your PDF')} · content ready${SRC.text ? ` · ${SRC.text.length.toLocaleString()} characters read` : ''}`
      : `${String(SRC.text || '').length.toLocaleString()} characters · ${String(SRC.text || '').trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words`;
  const chapters = (SRC.chapters || []).length ? `<b style="display:block" class="mt">${isYt ? 'Topics found, in lecture order' : 'Sections found, in order'}</b><ul>${SRC.chapters.map(c => {
    const t = isYt && c.startSec != null ? ` <a href="https://www.youtube.com/watch?v=${SRC.videoId}&t=${Math.max(0, Math.floor(c.startSec))}s" target="_blank" rel="noopener">▶ ${fmt(c.startSec)}</a>` : '';
    return `<li>${esc(c.title)}${t}</li>`;
  }).join('')}</ul>` : '';
  host.innerHTML = `<div class="outcard"><div class="spread"><b>✓ ${head}</b><span class="tag y">${isYt ? 'YouTube' : SRC.type === 'pdf' ? 'PDF' : 'Text'}</span></div><p class="small dim mt">${meta}</p>${chapters}<p class="small dim mt">Every tool below now works from this material — no need to analyse again.</p></div>`;
  const mt = $('moretools'); if (mt) mt.classList.remove('hidden');
}
function setSource(src) { SRC = src; renderSrcSummary(); saveHandoff(); }
function clearSource() {
  SRC = null;
  try { localStorage.removeItem(SRC_LS); } catch { /* ignore */ }
  renderSrcSummary();
  const mt = $('moretools'); if (mt) mt.classList.add('hidden');
  const note = $('srcnote'); if (note) note.classList.add('hidden');
}
if (STUDENT_TOOLS2.includes(tool)) {
  let srcTab = 'yt', pendingPdf = null;
  const setSrcTab = (t) => {
    srcTab = t;
    for (const k of ['yt', 'pdf', 'text']) {
      const tab = $(`src-${k}`); if (tab) tab.classList.toggle('on', k === t);
      const panel = $(`panel-src-${k}`); if (panel) panel.classList.toggle('hidden', k !== t);
    }
  };
  on('src-yt', 'click', () => { setSrcTab('yt'); clearSource(); });
  on('src-pdf', 'click', () => { setSrcTab('pdf'); clearSource(); });
  on('src-text', 'click', () => { setSrcTab('text'); clearSource(); });
  on('scanbtn', 'click', async (e) => {
    if (!requireKey()) return;
    const link = $('srclink').value.trim();
    const id = srcYtId(link);
    if (!id) { toast('Paste a proper YouTube lecture link first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Reading the source', 'Analysing the lecture', 'Ready']);
    $('scansteps').classList.remove('hidden');
    sstep('ss1', 'now', 'Reading the lecture link…');
    sstep('ss2', '', 'Gemini watches the lecture');
    sstep('ss3', '', 'Mapping the topics in order');
    try {
      sstep('ss1', 'ok', 'Lecture link accepted');
      sstep('ss2', 'now', 'Gemini is watching the whole lecture…');
      prog.setStep(1);
      const d = await geminiPartsJson([{ fileData: { fileUri: link, mimeType: 'video/*' } }, { text: `Watch this whole lecture video carefully. Return JSON only: {"title":"...","durationSec":0,"chapters":[{"title":"...","startSec":0}]}
title: the lecture's real title. durationSec: its total length in seconds (0 only if you truly cannot tell). chapters: the main topics in the EXACT order they are taught (never reshuffled), each with startSec = the second from the video start where that topic begins. Up to 12 chapters.` }], { temperature: 0.3, timeoutMs: 240000, onRetry: (info) => sstep('ss2', 'now', retryMsg(info)) });
      sstep('ss2', 'ok', 'Lecture watched');
      const chapters = (d.chapters || []).map(c => ({ title: String(c.title || 'Topic'), startSec: parseTs(c.startSec) })).filter(c => c.title);
      setSource({ type: 'youtube', link, videoId: id, title: d.title || '', durationSec: Number(d.durationSec) || 0, chapters, ready: true });
      sstep('ss3', 'ok', chapters.length ? `${chapters.length} topics mapped, in lecture order` : 'Topics mapped');
      prog.done();
      toast('Lecture analysed — now choose your options below.');
    } catch (err) { sstep('ss2', '', 'Watching stopped'); prog.fail(err.message); toast('Analyse failed: ' + err.message, true); }
    busy(b, false, 'Analyse lecture');
  });
  on('srcpdf', 'change', (e) => {
    pendingPdf = e.target.files?.[0] || null;
    const st = $('pdfstatus');
    if (st) st.textContent = pendingPdf ? `Selected: ${pendingPdf.name} (${(pendingPdf.size / 1048576).toFixed(1)} MB) — tap "Analyse PDF".` : '';
  });
  on('readpdf', 'click', async (e) => {
    if (!requireKey()) return;
    if (!pendingPdf) { toast('Choose your PDF file first.', true); return; }
    if (pendingPdf.size > 18 * 1024 * 1024) { toast('This PDF is over ~18 MB — too big to send to Gemini from the browser. Split it or use a smaller copy.', true); return; }
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Reading the file', 'Extracting the text', 'Ready']);
    $('pdfsteps').classList.remove('hidden');
    sstep('ps1', 'now', 'Reading the PDF file…');
    sstep('ps2', '', 'Extracting the full text');
    sstep('ps3', '', 'Finding the sections');
    const st = $('pdfstatus');
    try {
      const part = await fileToInline(pendingPdf);
      sstep('ps1', 'ok', 'PDF file read');
      sstep('ps2', 'now', 'Gemini is extracting the full text…');
      prog.setStep(1);
      const d = await geminiPartsJson([part, { text: `Extract the content of this PDF document for a student. Return JSON only: {"text":"...","sections":["..."],"pageCount":0}
text: the FULL text of the document in reading order — do not summarise, skip or shorten it; keep headings on their own lines. sections: the main section headings, in the document's own order. pageCount: the number of pages in this PDF if you can tell, otherwise 0.` }], { temperature: 0.2, timeoutMs: 240000, onRetry: (info) => sstep('ps2', 'now', retryMsg(info)) });
      const text = String(d.text || '').trim();
      if (text.length < 80) throw new Error('No readable text came out of this PDF. If it is scanned images, paste the text instead.');
      sstep('ps2', 'ok', 'Text extracted');
      const pages = Number(d.pageCount) || 0;
      if (st) st.textContent = pages > 0 ? `PDF read — ${pages} pages of content ready.` : 'PDF read — content ready.';
      setSource({ type: 'pdf', text, pdfName: pendingPdf.name, title: '', durationSec: 0, chapters: (d.sections || []).map(s => ({ title: String(s), startSec: null })), ready: true });
      sstep('ps3', 'ok', (d.sections || []).length ? `${(d.sections || []).length} sections found, in order` : 'Sections mapped');
      prog.done();
      toast('PDF analysed — now choose your options below.');
    } catch (err) { sstep('ps2', '', 'Extraction stopped'); prog.fail(err.message); if (st) st.textContent = ''; toast('Analyse failed: ' + err.message, true); }
    busy(b, false, 'Analyse PDF');
  });
  on('usetext', 'click', () => {
    const text = $('srctext').value.trim();
    if (text.length < 120) { toast('Paste a longer text first (at least a few paragraphs).', true); return; }
    setSource({ type: 'text', text, title: '', durationSec: 0, chapters: [], ready: true });
    toast('Text ready — now choose your options below.');
  });
  try {
    const h = JSON.parse(localStorage.getItem(SRC_LS) || 'null');
    if (h && h.type) {
      if (h.type === 'youtube' && h.link) {
        setSrcTab('yt');
        if ($('srclink')) $('srclink').value = h.link;
        SRC = { type: 'youtube', link: h.link, videoId: srcYtId(h.link), title: h.title || '', durationSec: h.durationSec || 0, chapters: h.chapters || [], ready: true };
      } else if ((h.type === 'pdf' || h.type === 'text') && h.text) {
        setSrcTab(h.type);
        if (h.type === 'text' && $('srctext')) $('srctext').value = h.text;
        SRC = { type: h.type, text: h.text, pdfName: h.pdfName || '', title: '', durationSec: 0, chapters: h.chapters || [], ready: true };
      }
      if (SRC) {
        renderSrcSummary();
        const note = $('srcnote');
        if (note) { note.textContent = `Using your scanned lecture from ${SRC_FROM[h.from] || 'Student Mode'} — change source above if needed.`; note.classList.remove('hidden'); }
      }
    }
  } catch { /* no handoff — fresh start */ }
}

/* ---------- Shared notes JSON (same schema as Lecture to Notes) ---------- */
async function notesJson({ easy, lang, len }, onRetry) {
  const isYt = SRC && SRC.type === 'youtube';
  const lenGuide = len === 'Short revision'
    ? 'Keep it tight: at most 6 sections, 3-4 short points each — only what a student revises the night before.'
    : 'Cover the whole lecture properly: every main topic becomes a section, 4-7 points each.';
  const prompt = `You are a study-notes writer making designed notes from the attached lecture material.
Return JSON only: {"title":"...","subtitle":"one line that sums up the whole topic","sections":[{"heading":"...","startSec":0,"points":["..."],"body":"","keyIdea":"","formulas":["..."]}],"definitions":[{"term":"...","meaning":"..."}],"examples":["..."],"important":["..."],"remember":["..."]}
ORDER RULE (important): the sections MUST follow the exact order the material teaches the topics — the same sequence from start to finish. Never reshuffle, group or reorder topics.
${isYt ? 'startSec: the second (from the video start) where that section of the lecture begins.' : 'startSec: always null — use the material\'s own section headings as the section headings.'}
LENGTH: ${lenGuide}
${easy ? 'EASY LANGUAGE (important): explain everything in very simple, easy words — short sentences and everyday examples — so even a weak student understands every point word by word. Avoid hard words; when a technical term is needed, explain it in simple words in brackets right there.' : ''}
LANGUAGE: write all the notes in ${lang}. Keep technical terms in English.
keyIdea: fill it only when the section has ONE clear takeaway a student must not miss; otherwise "".
formulas: every formula, equation, date or exact fact belongs in a "formulas" list, never buried inside points.
examples: only real examples that are IN the material — never invent new ones; [] if the material has none.
important: exam-critical points, likely-question areas and traps from the material; [] if none stand out.
remember: 1-2 short lines — the must-not-forget summary of the whole lecture.
definitions: the key terms, each with a one-line meaning in the notes language.`;
  const d = await sourceJson(prompt, { temperature: 0.45, onRetry });
  if (!d || !Array.isArray(d.sections) || !d.sections.length) throw new Error('The AI reply could not be read. Try again.');
  return d;
}
function notesMd(d) {
  const L = [`# ${d.title || 'Lecture notes'}`, d.subtitle ? `\n${d.subtitle}` : ''];
  (d.sections || []).forEach((s, i) => {
    L.push(`\n## ${i + 1}. ${s.heading}`);
    if (s.body) L.push(s.body);
    (s.points || []).forEach(p => L.push(`- ${p}`));
    if (s.keyIdea) L.push(`> Key idea: ${s.keyIdea}`);
    (s.formulas || []).forEach(f => L.push(`- Formula: ${f}`));
  });
  const allF = [...(d.formulas || []), ...(d.sections || []).flatMap(s => s.formulas || [])];
  if (allF.length) L.push(`\n## Formulas & exact facts\n${allF.map(f => `- ${f}`).join('\n')}`);
  if ((d.definitions || []).length) L.push(`\n## Key definitions\n${d.definitions.map(x => `- **${x.term}**: ${x.meaning}`).join('\n')}`);
  if ((d.examples || []).length) L.push(`\n## Examples\n${d.examples.map(x => `- ${x}`).join('\n')}`);
  if ((d.important || []).length) L.push(`\n## Important — exam favourites\n${d.important.map(x => `- ${x}`).join('\n')}`);
  if ((d.remember || []).length) L.push(`\n## Remember\n${d.remember.map(r => `- ${r}`).join('\n')}`);
  return L.join('\n');
}

/* ---------- SRT helpers (Auto Captions + Repurpose Pack) ---------- */
function srtTime(sec) {
  sec = Math.max(0, Number(sec) || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60), ms = Math.round((sec - Math.floor(sec)) * 1000);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}
/** Build cues from segments [{start,end,text}] in one of the caption styles. */
function buildCues(segments, style) {
  const cues = [];
  for (const seg of segments) {
    const start = Number(seg.start) || 0, end = Math.max(start + 0.5, Number(seg.end) || start + 2);
    const words = String(seg.text || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    if (style === 'karaoke') {
      const step = (end - start) / words.length;
      words.forEach((w, i) => cues.push({ start: start + i * step, end: start + (i + 1) * step, text: w }));
    } else if (style === 'short') {
      const per = 7, n = Math.ceil(words.length / per), step = (end - start) / n;
      for (let i = 0; i < n; i++) cues.push({ start: start + i * step, end: start + (i + 1) * step, text: words.slice(i * per, (i + 1) * per).join(' ') });
    } else {
      cues.push({ start, end, text: words.join(' ') });
    }
  }
  return cues;
}
function cuesToSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}`).join('\n\n') + '\n';
}
function srtToVtt(srt) {
  return 'WEBVTT\n\n' + srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
}

/* ---------- Podcast Clipper ----------
 * The Stream Clipper's window scan, re-tuned for conversation: podcasts and
 * interviews are scored on funny / insightful / heated moments, with the
 * prompt listening for speaker changes (a new voice starting a story is
 * often where a clip begins). Results mirror the clipper: Best-moments
 * cards with Watch-this-scene provenance, Pick toggles and a brief panel. */
if (tool === 'podcast') {
  let clipLen = 45, pickCount = 5, found = [], videoId = '', durationSec = 0, videoTitle = '';
  wireChips('rg-plen', 'plen', v => { clipLen = Number(v); });
  wireChips('rg-pcount', 'pcount', v => { pickCount = Number(v); });
  const stepEl = (id, state, text) => { const el = $(id); if (!el) return; el.className = 'step' + (state ? ' ' + state : ''); el.querySelector('span:last-child').textContent = text; };
  const scanRetry = (id) => (info) => stepEl(id, 'now', retryMsg(info));
  const PROBE_PROMPT = 'Return JSON only: {"durationSec": 0, "title": ""} — durationSec is the total length of this video in seconds (a number), title is its title. If you truly cannot tell the length, use 0.';
  const timeLine = (m) => (m.startSec != null && m.endSec != null) ? `${fmt(m.startSec)} to ${fmt(m.endSec)} · ${Math.max(1, Math.round(m.endSec - m.startSec))}s` : '—';
  const watchUrl = (m) => (videoId && m.startSec != null) ? `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(m.startSec))}s` : '';
  function momentCard(m, i) {
    const wu = watchUrl(m);
    return `<div class="outcard moment"><div><span class="time">${esc(timeLine(m))}</span><h3>${esc(m.title)}</h3></div>
      <div class="score${m.score < 70 ? ' mid' : ''}">${esc(String(m.score))}</div>
      <p class="why">${esc(m.why || '')}</p>
      <p class="why"><span class="tag y">Hook</span> ${esc(m.hook || '')}</p>
      ${wu ? `<p class="why"><a href="${wu}" target="_blank" rel="noopener">▶ Watch this scene</a> — verify it in the episode at ${esc(fmt(m.startSec))}.</p>` : ''}
      <div class="acts"><button class="chip pickbtn${m.picked ? ' on' : ''}" data-pick="${i}">${m.picked ? '✓ Picked' : 'Pick'}</button></div></div>`;
  }
  function renderFound() {
    const host = $('pmoments'); if (!host) return;
    host.innerHTML = found.map((m, i) => momentCard(m, i)).join('');
    host.querySelectorAll('[data-pick]').forEach(btn => btn.addEventListener('click', () => { const m = found[Number(btn.dataset.pick)]; m.picked = !m.picked; renderFound(); }));
    const sm = $('psummary');
    if (sm) sm.innerHTML = found.length ? `<div class="spread mt2"><h2>Best moments</h2><span class="tag y">${found.length} found</span></div>` : '';
    renderMake();
  }
  function renderMake() {
    const host = $('pmake'); if (!host) return;
    const picks = found.filter(m => m.picked);
    host.innerHTML = found.length ? `<button class="btn block big mt" id="pmakebtn">✦ Make ${picks.length} clips</button><div id="pbriefhost"></div>` : '';
    const mb = $('pmakebtn');
    if (mb) mb.addEventListener('click', renderBrief);
  }
  function briefText(picks) {
    const head = `# StreamClip AI — podcast clips production plan\nThis is the production plan for your clips — not a video file. The Watch links open each scene on YouTube.\nSource: ${videoTitle || 'Podcast episode'} (https://www.youtube.com/watch?v=${videoId})\n`;
    return head + picks.map((m, i) => `## Clip ${i + 1}: ${m.title}\n- Time: ${timeLine(m)} (score ${m.score})\n- Watch this scene: ${watchUrl(m) || '—'}\n- Hook: ${m.hook || '—'}\n- Why it works: ${m.why || '—'}`).join('\n\n');
  }
  function renderBrief() {
    const host = $('pbriefhost'); if (!host) return;
    const picks = found.filter(m => m.picked);
    if (!picks.length) { host.innerHTML = '<div class="outcard mt"><b>No moments picked.</b><p class="small dim mt">Pick at least one moment above first.</p></div>'; return; }
    host.innerHTML = `<h3 class="mt2">Your clips plan — ${picks.length} picked</h3>` + picks.map((m) => `<div class="outcard"><div class="spread"><b>${esc(m.title)}</b><span class="tag y">${esc(timeLine(m))}</span></div>
      <p class="small dim mt">Score ${m.score}${watchUrl(m) ? ` · <a href="${watchUrl(m)}" target="_blank" rel="noopener">▶ Watch this scene</a>` : ''}</p>
      <p class="small mt"><b>Hook:</b> ${esc(m.hook || '—')}<br><b>Why it works:</b> ${esc(m.why || '—')}</p></div>`).join('') +
      `<div class="note mt"><div><b>Render step.</b><div class="small dim">These briefs are the production plan for your clips. The final downloadable videos are made in the render step — this website does not run a render engine yet, so nothing here fakes a finished file. The Watch links open each scene on YouTube.</div></div></div>
      <div class="btns two mt"><button class="btn sm" id="pcopybrief">Copy plan</button><button class="btn dark sm" id="pdlbrief">Download plan (.md)</button></div>`;
    on('pcopybrief', 'click', () => copyText(briefText(picks), 'Plan copied.'));
    on('pdlbrief', 'click', () => download('podcast-clips-plan.md', briefText(picks), 'text/markdown'));
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function finishPick(count, minScore) {
    found.sort((a, b) => b.score - a.score);
    let n = 0;
    for (const m of found) { m.picked = m.score >= minScore && n < count; if (m.picked) n++; }
  }
  async function scanWindow(url, s, en) {
    const focus = $('pfocus').value;
    return geminiYouTubeJson(url, `You are a top podcast clipper. Watch ONLY the segment of this podcast/interview you were given (it starts at ${fmt(s)} of the full episode). This is a CONVERSATION, not gameplay: score moments where the talk itself is the gold — a funny exchange or laugh, a sharp insight stated plainly, a heated disagreement or bold claim, a surprising story or confession, or a quotable one-liner. Aim for moments about ${clipLen} seconds long. Extra weight on: ${focus}.
SPEAKER CHANGES: note in "why" when a moment starts right as the OTHER speaker begins a story, answer or rant — clips that start on a fresh voice hold viewers better.
Return JSON only:
{"beyondEnd": false, "moments": [{"startSec": 0, "endSec": 0, "score": 0, "title": "...", "hook": "...", "why": "..."}]}
startSec/endSec are seconds FROM THE START OF THIS SEGMENT. score is a strict clip-worthiness score 0-99. title max 60 chars. hook is 3-7 punchy words. why is one short line (mention the speaker change if that is what makes it work). Skip small talk, ad reads, intros, outros and long silent pauses. If this segment is past the end of the episode, return {"beyondEnd": true, "moments": []}.`, { startSec: s, endSec: en, onRetry: scanRetry('pst2') });
  }
  function addMoments(list, base) {
    let added = 0, dropped = 0;
    for (const m of (list || [])) {
      const st = base + (parseTs(m.startSec) || 0);
      let en = m.endSec != null ? base + (parseTs(m.endSec) || 0) : null;
      if (durationSec > 0 && st >= durationSec) { dropped++; continue; }
      if (durationSec > 0 && en != null && en > durationSec) en = durationSec;
      found.push({ startSec: st, endSec: en, score: Math.max(0, Math.min(99, Number(m.score) || 0)), title: m.title || 'Moment', hook: m.hook || '', why: m.why || '', picked: false });
      added++;
    }
    return { added, dropped };
  }
  on('pscan', 'click', async (e) => {
    if (!requireKey()) return;
    const url = $('plink').value.trim();
    const id = ytId(url);
    if (!id) { toast('Paste a YouTube podcast or interview link first.', true); return; }
    videoId = id;
    const b = e.currentTarget; busy(b, true);
    found = []; durationSec = 0; videoTitle = ''; renderFound();
    $('scansteps').classList.remove('hidden');
    const prog = makeProgress($('scanprog'), ['Reading the episode', 'Listening & scoring moments', 'Ranking the best', 'Ready']);
    stepEl('pst1', 'now', 'Asking Gemini about this episode…');
    stepEl('pst2', '', 'Listening in 10-minute windows and scoring moments');
    stepEl('pst3', '', 'Ranking and pre-picking the best');
    try {
      try {
        const probe = await geminiYouTubeJson(url, PROBE_PROMPT, { timeoutMs: 120000, onRetry: scanRetry('pst1') });
        durationSec = Number(probe.durationSec) || 0;
        videoTitle = probe.title || '';
      } catch { /* probe is best-effort; windows below still run */ }
      stepEl('pst1', 'ok', videoTitle ? `Episode found: ${videoTitle}${durationSec ? ` · ${fmt(durationSec)} long` : ''}` : 'Episode accepted by Gemini');
      stepEl('pst2', 'now', 'Listening…');
      const WIN = 600;
      const total = durationSec > 0 ? Math.min(durationSec, 4 * 3600) : 3600;
      const winsTotal = Math.max(1, Math.ceil(total / WIN));
      let beyond = false, droppedTotal = 0, prevErr = null;
      for (let k = 0; k < winsTotal && !beyond; k++) {
        if (k > 0) await breather(prevErr);
        const s = k * WIN, en = Math.min(total, s + WIN);
        stepEl('pst2', 'now', `Listening ${fmt(s)} – ${fmt(en)} (window ${k + 1} of ${winsTotal})…`);
        prog.setStep(1); prog.setFraction(k / winsTotal);
        try {
          const d = await scanWindow(url, s, en);
          if (d.beyondEnd) { beyond = true; break; }
          prevErr = null;
          droppedTotal += addMoments(d.moments, s).dropped;
          found.sort((a, b2) => b2.score - a.score);
          renderFound();
          prog.setFraction((k + 1) / winsTotal);
        } catch (err) {
          prevErr = err;
          if (k === 0) throw err;
          stepEl('pst2', 'now', `Window ${k + 1} could not be watched (${err.message}) — continuing…`);
        }
      }
      stepEl('pst2', 'ok', `Listened to the episode — ${found.length} moments found${droppedTotal ? ` · Ignored ${droppedTotal} moment${droppedTotal > 1 ? 's' : ''} past the episode's end` : ''}`);
      prog.setStep(2);
      finishPick(pickCount, Number($('pmin').value));
      renderFound();
      stepEl('pst3', 'ok', `Best ${found.filter(m => m.picked).length} moments pre-picked (score ≥ ${$('pmin').value})`);
      prog.done();
      if (!found.length) toast('Gemini listened but found no strong moments. Try a livelier episode, or lower the minimum score.', true);
    } catch (err) {
      stepEl('pst1', '', 'Scan stopped');
      stepEl('pst2', '', '');
      prog.fail(err.message);
      toast('Podcast scan failed: ' + err.message + ' — private/age-restricted or very long videos can fail.', true);
    }
    busy(b, false, '✦ Find podcast moments');
  });
}

/* ---------- Script-to-Short ----------
 * Topic (or a full script) in → a complete short-form asset pack out:
 * scene lines, one AI image per scene, the whole script voiced with the
 * chosen Gemini voice, plus posting title/caption/hashtags. The pack is
 * everything the render step needs — this tool delivers assets, honestly,
 * not a fake MP4. */
if (tool === 'scriptshort') {
  const vsel = $('svoice');
  if (vsel) vsel.innerHTML = GEMINI_VOICES.map(v => `<option${v === 'Kore' ? ' selected' : ''}>${v}</option>`).join('');
  let dur = 45;
  wireChips('rg-sdur', 'sdur', v => { dur = Number(v); });
  const VIS = {
    'Cinematic photo': 'cinematic photograph, dramatic natural light, shallow depth of field, rich detail',
    'Anime': 'clean anime illustration, expressive, vibrant colours, studio-quality line art',
    '3D render': 'polished 3D render, soft studio lighting, high detail, Pixar-like quality',
    'Flat illustration': 'modern flat vector illustration, bold shapes, limited palette, clean',
    'Neon cyberpunk': 'neon cyberpunk scene, glowing signs, rain-slick streets, magenta and cyan light',
    'Documentary photo': 'realistic documentary photograph, natural light, candid, gritty detail',
  };
  on('sgo', 'click', async (e) => {
    if (!requireKey()) return;
    const input = $('sinput').value.trim();
    if (input.length < 8) { toast('Write a topic — or paste your full script — first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Writing the script', 'Designing the scenes', 'Creating the images', 'Making the voice', 'Packing it up', 'Ready']);
    const niche = $('sniche').value, lang = $('slang').value, vis = $('svis').value;
    const scenes = Math.max(4, Math.min(10, Math.round(dur / 6.5)));
    const words = Math.round(dur * 2.4);
    try {
      const d = await geminiJson($('smode').value === 'topic'
        ? `You write viral vertical shorts. Topic: "${input}". Niche/style: ${niche}. Language: ${lang}. Target length: about ${dur} seconds spoken (about ${words} words total).
Write the script as exactly ${scenes} scenes. Return JSON only:
{"title":"a posting title, max 70 chars","scenes":[{"line":"one spoken line for this scene","image":"a one-sentence description of the picture for this scene"}],"caption":"a 1-2 line posting caption","hashtags":["..."]}
Rules: the FIRST line must be a hook that stops the scroll. Lines flow as one story — no greetings, no "in this video". Each line 8-16 words. image descriptions: visual only, no text in the picture, vertical-friendly composition, consistent main character/setting across scenes. hashtags: 5-8, no # symbol. Write title, lines and caption in ${lang}.`
        : `You package scripts for vertical shorts. The user wrote this full script — use it AS-IS, do not rewrite the words:
"""${input.slice(0, 6000)}"""
Split it into exactly ${scenes} scenes at natural sentence breaks. Niche/style: ${niche}. Language of the script: ${lang}. Return JSON only:
{"title":"a posting title, max 70 chars","scenes":[{"line":"the exact script text for this scene, unchanged","image":"a one-sentence description of the picture for this scene"}],"caption":"a 1-2 line posting caption","hashtags":["..."]}
image descriptions: visual only, no text in the picture, vertical-friendly composition, consistent main character/setting across scenes. hashtags: 5-8, no # symbol.`, { temperature: 0.7, onRetry: retryNote(b) });
      const pack = { title: d.title || 'My short', scenes: (d.scenes || []).filter(s => s && s.line), caption: d.caption || '', hashtags: (d.hashtags || []).map(h => '#' + String(h).replace(/\s+/g, '')) };
      if (!pack.scenes.length) throw new Error('The AI reply held no scenes. Try again.');
      prog.setStep(1);
      out('sresult', `<div class="outcard"><div class="spread"><b>${esc(pack.title)}</b><span class="tag y">${pack.scenes.length} scenes · ~${dur}s</span></div>
        <p class="small dim mt">Creating one AI image per scene — this is the slow part on a free key.</p></div>
        <div id="scenelist">${pack.scenes.map((s, i) => `<div class="outcard slidecard" id="scene-${i}"><b>Scene ${i + 1}</b><p class="mt"><b>Line:</b> ${esc(s.line)}</p><div class="sceneimg mt" id="sceneimg-${i}"><span class="spin"></span> Creating image…</div><p class="small dim mt">Picture: ${esc(s.image || '')}</p></div>`).join('')}</div>
        <div id="voicehost"></div>
        <div class="outcard"><b>Posting pack</b><p class="small mt"><b>Caption:</b> ${esc(pack.caption)}</p><p class="small mt">${pack.hashtags.map(esc).join(' ')}</p>
        <div class="btns two mt"><button class="btn dark sm" id="copypack">Copy title + caption + hashtags</button><button class="btn sm" id="dlpack">Download the full pack (.md)</button></div></div>
        <div class="note mt"><div><b>Render step.</b><div class="small dim">This pack is everything the render step needs — script, scene pictures and the voice track. The final assembled video is made in the render step; this website does not run a render engine yet, so nothing here fakes a finished MP4.</div></div></div>`);
      on('copypack', 'click', () => copyText(`${pack.title}\n\n${pack.caption}\n\n${pack.hashtags.join(' ')}`, 'Posting pack copied.'));
      const packMd = () => `# ${pack.title}\n\n${pack.scenes.map((s, i) => `## Scene ${i + 1}\n- Line: ${s.line}\n- Picture: ${s.image || ''}`).join('\n\n')}\n\n## Caption\n${pack.caption}\n\n${pack.hashtags.join(' ')}`;
      on('dlpack', 'click', () => download('script-to-short-pack.md', packMd(), 'text/markdown'));
      // Images — one per scene, paced; a failure shows Google's real error.
      prog.setStep(2);
      let prevErr = null, made = 0;
      for (let i = 0; i < pack.scenes.length; i++) {
        if (i > 0) await breather(prevErr);
        const host = $(`sceneimg-${i}`);
        try {
          const url = await geminiImage(`Vertical 9:16 picture for a short-form video scene. ${pack.scenes[i].image || pack.scenes[i].line}. Style: ${VIS[vis] || VIS['Cinematic photo']}. No text, no words, no watermark in the picture.`, null, '9:16', { onRetry: retryNote(null, host) });
          pack.scenes[i].imgUrl = url;
          if (host) host.innerHTML = `<img class="prev" src="${url}" alt="Scene ${i + 1} picture"><a class="btn dark sm mt" href="${url}" download="scene-${i + 1}.png">Download this image</a>`;
          prevErr = null; made++;
        } catch (err) {
          prevErr = err;
          if (host) host.innerHTML = `<p class="small" style="color:var(--red)">Image failed — ${esc(err.message)}</p>`;
        }
        prog.setFraction((i + 1) / pack.scenes.length);
      }
      // Voice — the whole script, chunked by scenes under the TTS size cap.
      prog.setStep(3);
      const voiceName = vsel ? vsel.value : 'Kore';
      const chunks = [];
      let cur = '';
      for (const s of pack.scenes) { if ((cur + ' ' + s.line).length > 3200 && cur) { chunks.push(cur); cur = s.line; } else cur = cur ? cur + ' ' + s.line : s.line; }
      if (cur) chunks.push(cur);
      const vh = $('voicehost');
      let voiceHtml = `<div class="outcard"><b>AI voice — ${esc(voiceName)}</b><p class="small dim mt">The whole script, spoken. Download the .wav and give it to the render step with the scene pictures.</p>`;
      let vprev = null, vcount = 0;
      for (let i = 0; i < chunks.length; i++) {
        if (i > 0) await breather(vprev);
        try {
          const blob = await geminiTTS(chunks[i], voiceName, { onRetry: retryNote(b) });
          const url = URL.createObjectURL(blob);
          voiceHtml += `<div class="mt"><audio controls src="${url}" style="width:100%"></audio><a class="btn dark sm mt" href="${url}" download="voice-part-${i + 1}.wav">Download voice${chunks.length > 1 ? ` part ${i + 1}` : ''} (.wav)</a></div>`;
          vprev = null; vcount++;
        } catch (err) { vprev = err; voiceHtml += `<p class="small mt" style="color:var(--red)">Voice${chunks.length > 1 ? ` part ${i + 1}` : ''} failed — ${esc(err.message)}</p>`; }
        prog.setFraction((i + 1) / chunks.length);
      }
      voiceHtml += '</div>';
      if (vh) vh.innerHTML = voiceHtml;
      prog.setStep(4);
      prog.done();
      toast(`Pack ready — ${made} of ${pack.scenes.length} images, ${vcount} of ${chunks.length} voice parts.`);
    } catch (err) { prog.fail(err.message); toast('Script-to-Short failed: ' + err.message, true); }
    busy(b, false, 'Make my short pack');
  });
}

/* ---------- Score My Short ----------
 * A report card for one short: Gemini watches it (YouTube link natively, or
 * an uploaded file as an inline part) and scores Hook / Pacing / Visual /
 * Title out of 10, with an overall /100, what is working, an ordered fix
 * list, and a rewritten title + first-3-seconds hook. */
if (tool === 'scoremy') {
  let smTab = 'yt', smFile = null;
  const setSmTab = (t) => {
    smTab = t;
    for (const k of ['yt', 'up']) {
      const tab = $(`sm-${k}`); if (tab) tab.classList.toggle('on', k === t);
      const panel = $(`panel-sm-${k}`); if (panel) panel.classList.toggle('hidden', k !== t);
    }
  };
  on('sm-yt', 'click', () => setSmTab('yt'));
  on('sm-up', 'click', () => setSmTab('up'));
  on('smfile', 'change', (e) => {
    smFile = e.target.files?.[0] || null;
    const st = $('smstatus');
    if (st) st.textContent = smFile ? `Selected: ${smFile.name} (${(smFile.size / 1048576).toFixed(1)} MB)` : '';
  });
  const SCORE_PROMPT = (platform, cat) => `You are a strict short-form video coach. Watch this whole short video and grade it for ${platform}. Its category is ${cat}. Judge only what is actually in the video — never invent scenes.
Return JSON only: {"videoTitle":"the video's title if shown, else a 5-word description","hook":0,"pacing":0,"visual":0,"titleScore":0,"working":["..."],"fixes":["..."],"newTitle":"...","newHook":"...","summary":"one honest line"}
hook, pacing, visual, titleScore: strict scores 0-10 (10 = genuinely excellent; most shorts deserve 3-7). hook = the first 3 seconds: does it stop the scroll? pacing = dead air, speed of cuts, where attention would drop. visual = framing, quality, captions, readability. titleScore = the title/thumbnail promise vs what the video delivers (if no title is visible, grade the on-screen text/opening frame as the promise).
working: 2-4 specific things that are genuinely good. fixes: 3-6 SPECIFIC fixes, ordered most important first, each one actionable in one sentence ("Cut the 2-second silent intro" — not "improve pacing").
newTitle: a rewritten title, max 60 chars, that this exact video could honestly carry. newHook: the exact words/scene for a stronger first 3 seconds.
summary: one line a creator could screenshot and share — the verdict, no flattery.`;
  function renderReport(d, platform) {
    const parts = [['Hook', d.hook], ['Pacing', d.pacing], ['Visual', d.visual], ['Title', d.titleScore]];
    const nums = parts.map(([, v]) => Math.max(0, Math.min(10, Number(v) || 0)));
    const overall = Math.round(nums.reduce((a, b) => a + b, 0) / 4 * 10);
    const bar = (label, v) => `<div class="scorerow"><span>${label}</span><div class="scorebar"><i style="width:${v * 10}%"></i></div><b>${v}/10</b></div>`;
    const share = `My short scored ${overall}/100 on StreamClip AI — ${d.summary || ''}`.trim();
    out('smresult', `<div class="outcard"><div class="spread"><b>${esc(d.videoTitle || 'Your short')}</b><span class="score${overall < 50 ? ' mid' : ''}">${overall}</span></div>
      <p class="small dim mt">Overall score for ${esc(platform)} — the average of the four grades below, out of 100.</p>
      <div class="mt">${parts.map(([l], i) => bar(l, nums[i])).join('')}</div></div>
      <div class="outcard"><b>What's working</b><ul class="mt">${(d.working || []).map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>
      <div class="outcard"><b>Fix these — in this order</b><ol class="mt">${(d.fixes || []).map(f => `<li>${esc(f)}</li>`).join('')}</ol></div>
      <div class="outcard"><b>Rewritten title</b><p class="out mt">${esc(d.newTitle || '')}</p>
      <b>Stronger first 3 seconds</b><p class="out mt">${esc(d.newHook || '')}</p>
      <div class="btns two mt"><button class="btn dark sm" id="smcopytitle">Copy title</button><button class="btn dark sm" id="smcopyhook">Copy hook</button></div></div>
      <div class="outcard"><b>Shareable verdict</b><p class="out mt">${esc(share)}</p><button class="btn sm mt" id="smshare">Copy the verdict line</button></div>`);
    on('smcopytitle', 'click', () => copyText(d.newTitle || '', 'Title copied.'));
    on('smcopyhook', 'click', () => copyText(d.newHook || '', 'Hook copied.'));
    on('smshare', 'click', () => copyText(share, 'Verdict copied — post it anywhere.'));
  }
  on('smgo', 'click', async (e) => {
    if (!requireKey()) return;
    const platform = $('smplatform').value, cat = $('smcat').value;
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Reading your short', 'Watching & grading', 'Writing the report', 'Ready']);
    try {
      let d;
      if (smTab === 'yt') {
        const link = $('smlink').value.trim();
        if (!ytId(link)) { toast('Paste a proper YouTube link first.', true); busy(b, false, 'Score my short'); return; }
        prog.setStep(1);
        d = await geminiYouTubeJson(link, SCORE_PROMPT(platform, cat), { timeoutMs: 240000, onRetry: retryNote(b) });
      } else {
        if (!smFile) { toast('Choose your short video file first.', true); busy(b, false, 'Score my short'); return; }
        if (smFile.size > 18 * 1024 * 1024) { toast('This video is over ~18 MB — too big to send to Gemini from the browser. Use a shorter or smaller copy.', true); busy(b, false, 'Score my short'); return; }
        prog.setStep(1);
        const part = await fileToInline(smFile);
        d = await geminiPartsJson([part, { text: SCORE_PROMPT(platform, cat) }], { temperature: 0.4, timeoutMs: 240000, onRetry: retryNote(b) });
      }
      prog.setStep(2);
      renderReport(d, platform);
      prog.done();
      toast('Report ready — fixes are ordered, start at the top.');
    } catch (err) { prog.fail(err.message); toast('Scoring failed: ' + err.message, true); }
    busy(b, false, 'Score my short');
  });
}

/* ---------- Repurpose Pack ----------
 * One YouTube video in → the whole posting kit out: platform titles,
 * descriptions and hashtags, AI captions translated into up to 3 languages,
 * posting-time guidance, and the 3 best clip moments with Watch links. */
if (tool === 'repurpose') {
  const POST_TIMES = {
    'TikTok': 'Best windows (general guidance): 6–9 AM, 12–2 PM and 7–11 PM, your viewers\' local time. Tue–Thu usually strongest.',
    'YouTube Shorts': 'Best windows (general guidance): 12–3 PM and 6–9 PM local time; weekends skew earlier.',
    'Instagram Reels': 'Best windows (general guidance): 11 AM–1 PM and 7–9 PM local time; Monday and Wednesday usually strongest.',
  };
  on('rgo', 'click', async (e) => {
    if (!requireKey()) return;
    const url = $('rlink').value.trim();
    const id = ytId(url);
    if (!id) { toast('Paste a proper YouTube link first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Watching the video', 'Picking clip moments', 'Writing titles & descriptions', 'Making captions', 'Translating captions', 'Packing it up', 'Ready']);
    const tone = $('rtone').value;
    const langs = [$('rlang1').value, $('rlang2').value, $('rlang3').value].filter(l => l && l !== 'None');
    const uniqLangs = [...new Set(langs)];
    try {
      // 1) Probe + window scan for the 3 clip moments.
      let durationSec = 0, videoTitle = '';
      try {
        const probe = await geminiYouTubeJson(url, 'Return JSON only: {"durationSec": 0, "title": ""} — durationSec is the total length of this video in seconds (a number), title is its title. If you truly cannot tell the length, use 0.', { timeoutMs: 120000, onRetry: retryNote(b) });
        durationSec = Number(probe.durationSec) || 0; videoTitle = probe.title || '';
      } catch { /* best-effort */ }
      const WIN = 600;
      const total = durationSec > 0 ? Math.min(durationSec, 2 * 3600) : 3600;
      const winsTotal = Math.max(1, Math.ceil(total / WIN));
      const moments = [];
      let prevErr = null;
      for (let k = 0; k < winsTotal; k++) {
        if (k > 0) await breather(prevErr);
        const s = k * WIN, en = Math.min(total, s + WIN);
        prog.setStep(1); prog.setFraction(k / winsTotal);
        try {
          const d = await geminiYouTubeJson(url, `Watch ONLY this segment (it starts at ${fmt(s)} of the full video). Find the moments that would make the best standalone Shorts/Reels/TikToks. Return JSON only: {"beyondEnd": false, "moments": [{"startSec": 0, "endSec": 0, "score": 0, "title": "...", "why": "..."}]} startSec/endSec are seconds FROM THE START OF THIS SEGMENT. score strictly 0-99. If this segment is past the end of the video, return {"beyondEnd": true, "moments": []}.`, { startSec: s, endSec: en, onRetry: retryNote(b) });
          if (d.beyondEnd) break;
          prevErr = null;
          for (const m of (d.moments || [])) {
            const st = s + (parseTs(m.startSec) || 0);
            if (durationSec > 0 && st >= durationSec) continue;
            moments.push({ startSec: st, endSec: m.endSec != null ? s + (parseTs(m.endSec) || 0) : null, score: Math.max(0, Math.min(99, Number(m.score) || 0)), title: m.title || 'Moment', why: m.why || '' });
          }
        } catch (err) { prevErr = err; if (k === 0) throw err; }
      }
      moments.sort((a, b2) => b2.score - a.score);
      const topMoments = moments.slice(0, 3);
      // 2) Titles / descriptions / hashtags per platform.
      prog.setStep(2);
      const kit = await geminiJson(`You are a short-form repurposing strategist. The video: "${videoTitle || url}" (${durationSec ? fmt(durationSec) + ' long' : 'length unknown'}). Tone: ${tone}.
Return JSON only: {"tiktok":{"titles":["","",""],"description":"...","hashtags":["..."]},"shorts":{"titles":["","",""],"description":"...","hashtags":["..."]},"reels":{"titles":["","",""],"description":"...","hashtags":["..."]}}
Exactly 3 titles per platform, each in that platform's native style (TikTok: raw and curious; Shorts: searchable and clear; Reels: polished and save-worthy). Descriptions: 1-3 lines each, with a call to action. hashtags: 6-10 per platform, no # symbol. Base everything on what this video actually is — never invent content it does not have.`, { temperature: 0.7, onRetry: retryNote(b) });
      // 3) Captions: segment-level SRT from the video (first 30 min cap, stated on the page).
      prog.setStep(3);
      const capEnd = Math.min(durationSec > 0 ? durationSec : 1800, 1800);
      let capNote = '';
      let origSrt = '';
      try {
        const cap = await geminiYouTubeJson(url, `Listen to this video and transcribe the spoken words as caption segments. Return JSON only: {"language":"the spoken language","segments":[{"startSec":0,"endSec":0,"text":"..."}]}
Cover the video from 0 to ${capEnd} seconds. Segments of 2-6 seconds of speech each, in order, with honest start/end seconds. Transcribe ONLY what is actually said — never summarise or invent.`, { startSec: 0, endSec: capEnd, timeoutMs: 240000, onRetry: retryNote(b) });
        const segs = (cap.segments || []).map(s => ({ start: parseTs(s.startSec) || 0, end: parseTs(s.endSec) || 0, text: s.text || '' })).filter(s => s.text);
        if (segs.length) origSrt = cuesToSrt(buildCues(segs, 'clean'));
        capNote = cap.language ? `Original language detected: ${cap.language}. ` : '';
      } catch { capNote = 'The caption step did not answer this time — the rest of the pack is complete without it. '; }
      if (durationSec > 1800) capNote += 'Captions cover the first 30 minutes (the stated cap for this tool). ';
      // 4) Translate the SRT into each chosen language, timestamps untouched.
      prog.setStep(4);
      const translations = [];
      let terr = null;
      for (const lang of uniqLangs) {
        if (!origSrt) break;
        if (translations.length) await breather(terr);
        try {
          const chunks = chunkText(origSrt, 4500);
          const parts = [];
          for (let i = 0; i < chunks.length; i++) {
            if (i > 0) await breather(null);
            parts.push(await geminiText(`Translate these video captions into ${lang}. Keep every timestamp and every cue number exactly as it is. Translate only the spoken words. Do not add explanations, do not wrap in code fences.\n\n${chunks[i]}`, { bulk: true, temperature: 0.3, onRetry: retryNote(b) }));
          }
          translations.push({ lang, srt: parts.join('\n\n') });
          terr = null;
        } catch (err) { terr = err; translations.push({ lang, srt: '', error: err.message }); }
      }
      // 5) Render the pack.
      prog.setStep(5);
      const platCard = (name, key, times) => {
        const p = kit[key] || {};
        const tags = (p.hashtags || []).map(h => '#' + String(h).replace(/\s+/g, ''));
        return `<div class="outcard"><div class="spread"><b>${name}</b><button class="chip" data-copyplat="${key}">Copy all</button></div>
        <b class="small">Titles</b><ol>${(p.titles || []).map(t => `<li>${esc(t)}</li>`).join('')}</ol>
        <b class="small">Description</b><p class="out mt">${esc(p.description || '')}</p>
        <b class="small">Hashtags</b><p class="out mt">${tags.map(esc).join(' ')}</p>
        <p class="small dim mt">🕐 ${esc(times)}</p></div>`;
      };
      out('rresult', `<div class="outcard"><b>${esc(videoTitle || 'Your video')}</b><p class="small dim mt">One video → the full posting kit. Posting times are general guidance from common creator practice, not a promise — your own analytics beat any chart.</p></div>
        ${platCard('TikTok', 'tiktok', POST_TIMES['TikTok'])}
        ${platCard('YouTube Shorts', 'shorts', POST_TIMES['YouTube Shorts'])}
        ${platCard('Instagram Reels', 'reels', POST_TIMES['Instagram Reels'])}
        <div class="outcard"><b>Best clip moments</b>
        ${topMoments.length ? topMoments.map(m => `<p class="small mt"><b>${esc(fmt(m.startSec))}${m.endSec != null ? ' – ' + esc(fmt(m.endSec)) : ''}</b> · score ${m.score} — ${esc(m.title)} <a href="https://www.youtube.com/watch?v=${id}&t=${Math.max(0, Math.floor(m.startSec))}s" target="_blank" rel="noopener">▶ Watch</a><br><span class="dim">${esc(m.why)}</span></p>`).join('') : '<p class="small dim mt">No strong clip moments were found in this video.</p>'}
        <p class="small dim mt">Cut these in the <a href="stream-clipper.html">Stream Clipper</a> — paste the same link and jump to these times.</p></div>
        <div class="outcard"><b>Captions (.srt)</b><p class="small dim mt">${esc(capNote)}These are AI-generated segment captions made by listening to the video — read them once before posting, as names and numbers can be misheard.</p>
        ${origSrt ? `<div class="btns two mt"><button class="btn sm" id="dlcap0">Download original captions</button><button class="btn dark sm" id="copycap0">Copy original</button></div>` : ''}
        ${translations.map((t, i) => t.srt ? `<div class="btns two mt"><button class="btn sm" data-dlcap="${i}">Download ${esc(t.lang)} captions</button><button class="btn dark sm" data-copycap="${i}">Copy ${esc(t.lang)}</button></div>` : `<p class="small mt" style="color:var(--red)">${esc(t.lang)} translation failed — ${esc(t.error || '')}</p>`).join('')}
        </div>`);
      document.querySelectorAll('[data-copyplat]').forEach(btn => btn.addEventListener('click', () => {
        const p = kit[btn.dataset.copyplat] || {};
        const tags = (p.hashtags || []).map(h => '#' + String(h).replace(/\s+/g, ''));
        copyText(`TITLES\n${(p.titles || []).join('\n')}\n\nDESCRIPTION\n${p.description || ''}\n\n${tags.join(' ')}`, 'Platform kit copied.');
      }));
      if (origSrt) {
        on('dlcap0', 'click', () => download('captions-original.srt', origSrt, 'text/plain'));
        on('copycap0', 'click', () => copyText(origSrt, 'Captions copied.'));
      }
      document.querySelectorAll('[data-dlcap]').forEach(btn => btn.addEventListener('click', () => { const t = translations[Number(btn.dataset.dlcap)]; download(`captions-${t.lang.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.srt`, t.srt, 'text/plain'); }));
      document.querySelectorAll('[data-copycap]').forEach(btn => btn.addEventListener('click', () => { const t = translations[Number(btn.dataset.copycap)]; copyText(t.srt, 'Captions copied.'); }));
      prog.done();
      toast('Repurpose pack ready.');
    } catch (err) { prog.fail(err.message); toast('Repurpose failed: ' + err.message, true); }
    busy(b, false, 'Make the repurpose pack');
  });
}

/* ---------- Auto Captions ----------
 * Upload a short video → Gemini transcribes it into timed segments →
 * styled .srt (+ .vtt) downloads. Honest baseline, stated on the page:
 * timing is segment-level (one cue per spoken segment); the karaoke style
 * splits a segment's time evenly across its words — an even-timing
 * estimate, not measured word timing. */
if (tool === 'autocaptions') {
  let acFile = null;
  on('acfile', 'change', (e) => {
    acFile = e.target.files?.[0] || null;
    const st = $('acstatus');
    if (st) st.textContent = acFile ? `Selected: ${acFile.name} (${(acFile.size / 1048576).toFixed(1)} MB)` : '';
  });
  on('acgo', 'click', async (e) => {
    if (!requireKey()) return;
    if (!acFile) { toast('Choose your video file first.', true); return; }
    if (acFile.size > 18 * 1024 * 1024) { toast('This video is over ~18 MB — too big to send to Gemini from the browser. Trim it or use a smaller copy.', true); return; }
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Reading your video', 'Listening & transcribing', 'Styling the captions', 'Translating', 'Ready']);
    const style = $('acstyle').value, lang1 = $('aclang').value, lang2 = $('aclang2').value;
    try {
      const part = await fileToInline(acFile);
      prog.setStep(1);
      const d = await geminiPartsJson([part, { text: `Listen to this video carefully and transcribe ALL spoken words. The spoken language is ${lang1 === 'Auto — keep the original language' ? 'whatever is spoken — detect it' : lang1}. Return JSON only: {"language":"the language actually spoken","segments":[{"startSec":0,"endSec":0,"text":"..."}]}
Segments of 2-6 seconds of speech each, in order, covering the whole video, with honest start/end seconds. Transcribe ONLY what is actually said — never summarise, never invent. If there is no speech, return {"language":"none","segments":[]}.` }], { temperature: 0.2, timeoutMs: 240000, onRetry: retryNote(b) });
      const segs = (d.segments || []).map(s => ({ start: parseTs(s.startSec) || 0, end: parseTs(s.endSec) || 0, text: String(s.text || '') })).filter(s => s.text.trim());
      if (!segs.length) throw new Error('No speech was found in this video — captions need spoken words.');
      prog.setStep(2);
      const cues = buildCues(segs, style);
      const srt = cuesToSrt(cues);
      const vtt = srtToVtt(srt);
      const styleName = { clean: 'Clean lines', short: 'Short lines', karaoke: 'Karaoke word-by-word' }[style];
      let second = null;
      if (lang2 && lang2 !== 'None') {
        prog.setStep(3);
        const chunks = chunkText(srt, 4500);
        const parts = [];
        let perr = null;
        for (let i = 0; i < chunks.length; i++) {
          if (i > 0) await breather(perr);
          parts.push(await geminiText(`Translate these video captions into ${lang2}. Keep every timestamp and every cue number exactly as it is. Translate only the spoken words. Do not add explanations, do not wrap in code fences.\n\n${chunks[i]}`, { bulk: true, temperature: 0.3, onRetry: retryNote(b) }));
          perr = null;
        }
        second = { lang: lang2, srt: parts.join('\n\n') };
      } else prog.setStep(3);
      out('acresult', `<div class="outcard"><div class="spread"><b>Captions ready</b><span class="tag y">${cues.length} cues · ${esc(d.language || lang1)}</span></div>
        <p class="small dim mt">Style: ${esc(styleName)}. Timing is segment-level — one cue per spoken segment${style === 'karaoke' ? '; karaoke splits each segment\'s time evenly across its words, which is an estimate, not measured word timing' : ''}. Read them once before posting: names and numbers can be misheard.</p>
        <p class="out mt" style="max-height:260px;overflow:auto">${esc(srt)}</p>
        <div class="btns two mt"><button class="btn sm" id="acdl1">Download .srt</button><button class="btn dark sm" id="acdl2">Download .vtt</button></div>
        <button class="btn dark sm mt" id="accopy">Copy the .srt</button>
        ${second ? `<div class="spread mt2"><b>Translated — ${esc(second.lang)}</b></div><p class="out mt" style="max-height:220px;overflow:auto">${esc(second.srt)}</p><div class="btns two mt"><button class="btn sm" id="acdl3">Download ${esc(second.lang)} .srt</button><button class="btn dark sm" id="acdl4">Download ${esc(second.lang)} .vtt</button></div>` : ''}
        </div>`);
      on('acdl1', 'click', () => download('captions.srt', srt, 'text/plain'));
      on('acdl2', 'click', () => download('captions.vtt', vtt, 'text/vtt'));
      on('accopy', 'click', () => copyText(srt, 'Captions copied.'));
      if (second) {
        on('acdl3', 'click', () => download(`captions-${second.lang.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.srt`, second.srt, 'text/plain'));
        on('acdl4', 'click', () => download(`captions-${second.lang.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.vtt`, srtToVtt(second.srt), 'text/vtt'));
      }
      prog.done();
      toast('Captions ready — download the .srt or .vtt.');
    } catch (err) { prog.fail(err.message); toast('Captions failed: ' + err.message, true); }
    busy(b, false, 'Make my captions');
  });
}

/* ---------- Mock Test (Student Mode) ----------
 * A timed practice paper from the shared lecture source: MCQs are marked
 * exactly; short questions come with model answers for honest self-marking
 * (labelled as such). Wrong-answer topics become the "Revise these" list. */
if (tool === 'mocktest') {
  let test = null, timerId = null, timeLeft = 0;
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
  function startTimer(minutes) {
    stopTimer();
    if (!minutes) return;
    timeLeft = minutes * 60;
    const pill = $('mtimer');
    const paint = () => { if (pill) { pill.textContent = `⏱ ${fmt(timeLeft)} left`; pill.classList.toggle('low', timeLeft <= 60); } };
    paint();
    timerId = setInterval(() => {
      timeLeft--;
      paint();
      if (timeLeft <= 0) { stopTimer(); toast('Time is up — marking your test now.'); markTest(); }
    }, 1000);
  }
  function markTest() {
    if (!test) return;
    stopTimer();
    let score = 0;
    const wrongTopics = [];
    test.mcqs.forEach((q, qi) => {
      const card = document.querySelector(`[data-mcard="${qi}"]`);
      const picked = card ? card.querySelector('.chip.on') : null;
      const pickedIdx = picked ? Number(picked.dataset.o) : -1;
      q._picked = pickedIdx;
      const ok = pickedIdx === Number(q.answer);
      if (ok) score++;
      else if (q.topic) wrongTopics.push(q.topic);
      if (card) {
        card.querySelectorAll('[data-o]').forEach(x => {
          x.disabled = true;
          if (Number(x.dataset.o) === Number(q.answer)) x.style.outline = '2px solid var(--green)';
          else if (Number(x.dataset.o) === pickedIdx) x.style.background = 'var(--red)';
        });
        const w = card.querySelector('.mwhy');
        if (w) { w.classList.remove('hidden'); w.innerHTML = `<b>${ok ? 'Correct.' : pickedIdx < 0 ? 'Not answered.' : 'Not quite.'}</b> ${esc(q.why || '')}`; }
      }
    });
    test.shorts.forEach((q, qi) => {
      const host = document.querySelector(`[data-shost="${qi}"]`);
      if (host) host.innerHTML = `<div class="outcard" style="margin-top:10px"><b>Model answer — mark yourself honestly</b><p class="out mt">${esc(q.modelAnswer || '')}</p><p class="small dim mt">Compare your answer point by point: full marks only if you covered the same points. Short answers are self-marked — no AI pretends to grade handwriting-style answers fairly.</p></div>`;
    });
    const pct = test.mcqs.length ? Math.round(score / test.mcqs.length * 100) : 0;
    const topics = [...new Set(wrongTopics)];
    const res = $('mresult');
    if (res) res.innerHTML = `<div class="outcard"><div class="spread"><b>Your result</b><span class="score${pct < 50 ? ' mid' : ''}">${pct}%</span></div>
      <p class="small mt">MCQs: <b>${score} of ${test.mcqs.length}</b> correct.${test.shorts.length ? ` Short questions: compare yours with the model answers below each question.` : ''}</p>
      ${topics.length ? `<b class="small">Revise these topics</b><ul>${topics.map(t => `<li>${esc(t)}</li>`).join('')}</ul><a class="btn dark sm mt" href="lecture-notes.html">Revise with Lecture to Notes →</a>` : '<p class="small dim mt">No weak topics — every MCQ topic was answered correctly. Raise the difficulty and go again.</p>'}
      </div>`;
    const mb = $('mmark'); if (mb) mb.remove();
    const pill = $('mtimer'); if (pill) pill.textContent = '✓ Marked';
    res.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  on('mgo', 'click', async (e) => {
    if (!requireKey() || !requireSource()) return;
    const b = e.currentTarget; busy(b, true);
    stopTimer();
    const prog = makeProgress($('prog'), ['Reading your material', 'Writing the questions', 'Setting the paper', 'Ready']);
    prog.setStep(1);
    const count = Number($('mcount').value), types = $('mtypes').value, diff = $('mdiff').value, tlimit = Number($('mtime').value);
    try {
      const nShort = types === 'MCQ + short' ? Math.max(2, Math.round(count / 5)) : 0;
      const nMcq = count - nShort;
      const d = await sourceJson(`Set a practice exam paper from the attached lecture material ONLY — invent nothing that is not in it. Difficulty: ${diff}.
Return JSON only: {"mcqs":[{"q":"...","options":["a","b","c","d"],"answer":0,"why":"one line why the answer is right","topic":"the lecture topic this tests"}],"shorts":[{"q":"...","modelAnswer":"a full model answer in short paragraphs","topic":"..."}]}
Exactly ${nMcq} MCQs${nShort ? ` and exactly ${nShort} short questions` : ' and an empty "shorts" list'}. MCQ options: 4, plausible, only one correct; answer = the index (0-3) of the correct option. Spread questions across the material's topics in its own order.`, { temperature: 0.5, onRetry: retryNote(b) });
      test = {
        mcqs: (d.mcqs || []).filter(q => q && Array.isArray(q.options) && q.options.length >= 2),
        shorts: (d.shorts || []).filter(q => q && q.q),
      };
      if (!test.mcqs.length && !test.shorts.length) throw new Error('The AI reply held no questions. Try again.');
      prog.setStep(2);
      out('mtest', `<div class="card"><div class="spread"><h3>Your mock test</h3><span class="tag y" id="mtimer">${tlimit ? `⏱ ${fmt(tlimit * 60)} left` : 'No time limit'}</span></div>
        <p class="sub">Answer every question, then tap "Mark my test" at the bottom.${tlimit ? ' When the timer ends, the test marks itself.' : ''} MCQs are marked exactly; short questions are revealed with model answers for honest self-marking.</p>
        ${test.mcqs.map((q, qi) => `<div class="outcard" data-mcard="${qi}"><b>Q${qi + 1}. ${esc(q.q)}</b>
          <div class="chips mt">${q.options.map((o, oi) => `<button class="chip" data-o="${oi}">${esc(o)}</button>`).join('')}</div>
          <p class="small dim mt hidden mwhy"></p></div>`).join('')}
        ${test.shorts.map((q, qi) => `<div class="outcard"><b>S${qi + 1}. ${esc(q.q)}</b>
          <label class="field"><span>Your answer</span><textarea class="input" placeholder="Write your answer here, like in the real paper…"></textarea></label>
          <div data-shost="${qi}"></div></div>`).join('')}
        <button class="btn block big mt" id="mmark">Mark my test</button>
        <div id="mresult"></div></div>`);
      document.querySelectorAll('[data-mcard]').forEach(card => {
        card.querySelectorAll('[data-o]').forEach(btn => btn.addEventListener('click', () => {
          card.querySelectorAll('[data-o]').forEach(x => x.classList.toggle('on', x === btn));
        }));
      });
      on('mmark', 'click', markTest);
      startTimer(tlimit);
      prog.done();
      $('mtest').scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast('Your paper is set — good luck.');
    } catch (err) { prog.fail(err.message); toast('Mock test failed: ' + err.message, true); }
    busy(b, false, 'Set my mock test');
  });
}

/* ---------- Handwritten Notes (Student Mode) ----------
 * The same structured notes JSON as Lecture to Notes, rendered as a
 * handwriting-style sheet: ruled/grid/plain paper, a choice of ink colour,
 * and a handwriting font — the look students pin and share. */
if (tool === 'handwritten') {
  let ink = 'blue', paper = 'ruled', hfont = 'caveat', easyOn = true;
  wireChips('rg-ink', 'ink', v => { ink = v; repaintHw(); });
  wireChips('rg-paper', 'paper', v => { paper = v; repaintHw(); });
  wireChips('rg-hfont', 'hfont', v => { hfont = v; repaintHw(); });
  const easyEl = $('hweasy');
  if (easyEl) easyEl.addEventListener('click', () => { easyOn = !easyOn; easyEl.classList.toggle('on', easyOn); });
  let hwData = null;
  function hwHTML(d) {
    const secs = (d.sections || []).map((s, i) => `<div class="hw-sec"><h4><span class="hw-num">${i + 1}</span> ${esc(s.heading || 'Section')}</h4>
      ${s.body ? `<p>${esc(s.body)}</p>` : ''}
      ${(s.points || []).length ? `<ul>${s.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      ${s.keyIdea ? `<div class="hw-key"><b>Key idea:</b> ${esc(s.keyIdea)}</div>` : ''}
      ${(s.formulas || []).length ? `<div class="hw-fmls">${s.formulas.map(f => `<span>${esc(f)}</span>`).join('')}</div>` : ''}</div>`).join('');
    const allF = [...(d.formulas || []), ...(d.sections || []).flatMap(s => s.formulas || [])];
    return `<div class="hwsheet ink-${ink} paper-${paper} font-${hfont}" id="hwsheet">
      <div class="hw-head"><h3>${esc(d.title || 'Lecture notes')}</h3>${d.subtitle ? `<p>${esc(d.subtitle)}</p>` : ''}</div>
      ${secs}
      ${allF.length ? `<h4 class="hw-h">Formulas &amp; exact facts</h4><div class="hw-fmls">${allF.map(f => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
      ${(d.definitions || []).length ? `<h4 class="hw-h">Key definitions</h4>${d.definitions.map(x => `<p class="hw-def"><b>${esc(x.term)}</b> — ${esc(x.meaning)}</p>`).join('')}` : ''}
      ${(d.examples || []).length ? `<div class="hw-box"><h5>Examples</h5><ul>${d.examples.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${(d.important || []).length ? `<div class="hw-box hw-imp"><h5>Important — exam favourites</h5><ul>${d.important.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${(d.remember || []).length ? `<div class="hw-take"><b>★ Remember</b><ul>${d.remember.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}
      <p class="hw-foot">Made with StreamClip AI · Handwritten Notes</p></div>`;
  }
  function repaintHw() {
    const host = $('hwsheet');
    if (host && hwData) { const wrap = $('hwresult'); if (wrap) { const el = document.createElement('div'); el.innerHTML = hwHTML(hwData); host.replaceWith(el.firstElementChild); } }
  }
  on('hwgo', 'click', async (e) => {
    if (!requireKey() || !requireSource()) return;
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Reading the source', 'Analysing the lecture', 'Writing your notes', 'Inking the sheet', 'Ready']);
    prog.setStep(1);
    try {
      hwData = await notesJson({ easy: easyOn, lang: $('hwlang').value, len: $('hwlen').value }, retryNote(b));
      prog.setStep(3);
      out('hwresult', `${hwHTML(hwData)}
        <div class="btns three mt"><button class="btn sm" id="hwpng">Download picture (PNG)</button><button class="btn dark sm" id="hwprint">Print sheet</button><button class="btn dark sm" id="hwmd">Download notes (.md)</button></div>
        <p class="small dim mt">Change the ink, paper or handwriting above and the sheet re-inks instantly — no new AI call. Share the picture anywhere; it is the look students pin.</p>`);
      on('hwpng', 'click', async () => {
        const el = $('hwsheet');
        if (!window.html2canvas || !el) { toast('Image download could not run in this browser — use Print, then "Save as PDF", instead.', true); return; }
        try {
          toast('Making the picture — one moment…');
          const cv = await window.html2canvas(el, { scale: 2, backgroundColor: '#fffdf4', useCORS: true, logging: false });
          const a = document.createElement('a'); a.download = 'handwritten-notes.png'; a.href = cv.toDataURL('image/png'); a.click();
          toast('Notes picture downloaded.');
        } catch { toast('Image download failed in this browser — use Print, then "Save as PDF", instead.', true); }
      });
      on('hwprint', 'click', () => {
        const el = $('hwsheet'); if (!el) return;
        document.querySelectorAll('.hwsheet.picked').forEach(s => s.classList.remove('picked'));
        el.classList.add('picked');
        document.body.classList.add('printmode');
        const clean = () => { document.body.classList.remove('printmode'); el.classList.remove('picked'); window.removeEventListener('afterprint', clean); };
        window.addEventListener('afterprint', clean);
        setTimeout(clean, 60000);
        window.print();
      });
      on('hwmd', 'click', () => download('handwritten-notes.md', notesMd(hwData), 'text/markdown'));
      prog.done();
      toast('Handwritten notes ready — pick your ink and paper.');
    } catch (err) { prog.fail(err.message); toast('Handwritten notes failed: ' + err.message, true); }
    busy(b, false, 'Write my handwritten notes');
  });
}

/* ---------- Assignment Builder (Student Mode) ----------
 * Topic + an optional professor's Reference PDF (read first, its topics
 * shown, the draft follows them) → a structured assignment draft with
 * downloads. Framed honestly as a study draft to rewrite in your own words. */
if (tool === 'assignment') {
  let refFile = null, refPdf = null;
  on('refpdf', 'change', (e) => {
    refFile = e.target.files?.[0] || null;
    refPdf = null;
    out('reftopics', '');
    const st = $('refstatus');
    if (st) st.textContent = refFile ? `Selected: ${refFile.name} (${(refFile.size / 1048576).toFixed(1)} MB) — tap "Read reference PDF".` : '';
  });
  on('refread', 'click', async (e) => {
    if (!requireKey()) return;
    if (!refFile) { toast('Choose the reference PDF first.', true); return; }
    if (refFile.size > 18 * 1024 * 1024) { toast('This PDF is over ~18 MB — too big to send to Gemini from the browser. Use a smaller copy.', true); return; }
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Reading the PDF', 'Listing the topics', 'Ready']);
    const st = $('refstatus');
    try {
      if (st) st.textContent = 'Reading your reference PDF…';
      prog.setStep(1);
      const part = await fileToInline(refFile);
      const d = await geminiPartsJson([part, { text: `Read this reference PDF a professor gave a student for an assignment. Return JSON only: {"text":"...","topics":["..."]}
text: the FULL text of the document in reading order — do not summarise or shorten it; keep headings on their own lines. topics: the document's topics/structure as a short list (up to 12), in the document's own order, each one line.` }], { temperature: 0.2, timeoutMs: 240000, onRetry: retryNote(b, st) });
      const text = String(d.text || '').trim();
      if (text.length < 80) throw new Error('No readable text came out of this PDF.');
      refPdf = { text, topics: (d.topics || []).map(t => String(t)).filter(Boolean) };
      if (st) st.textContent = 'Reference PDF read — its topics are below. Now build your assignment.';
      out('reftopics', `<div class="outcard"><b>Topics found in your PDF</b>${refPdf.topics.length ? `<ul class="mt">${refPdf.topics.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="small dim mt">No clear topic list came back, but the full text was read and will still guide the draft.</p>'}<p class="small dim mt">Your assignment will follow these topics, in this order.</p></div>`);
      prog.done();
      toast('Reference PDF read — topics listed below.');
    } catch (err) { prog.fail(err.message); if (st) st.textContent = ''; toast('Reference PDF failed: ' + err.message, true); }
    busy(b, false, 'Read reference PDF');
  });
  let refsOn = true;
  const refsEl = $('arefs');
  if (refsEl) refsEl.addEventListener('click', () => { refsOn = !refsOn; refsEl.classList.toggle('on', refsOn); });
  const LEN_WORDS = { 'Short (~500 words)': 'about 500 words total', 'Medium (~1000 words)': 'about 1000 words total', 'Long (~2000 words)': 'about 2000 words total' };
  on('ago', 'click', async (e) => {
    if (!requireKey()) return;
    const topic = $('atopic').value.trim();
    if (!topic && !refPdf) { toast('Write your assignment topic — or read a reference PDF first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Reading your material', 'Planning the structure', 'Writing the assignment', 'Ready']);
    prog.setStep(1);
    const len = $('alen').value, level = $('alevel').value, lang = $('alang').value;
    try {
      const shape = `Length: ${LEN_WORDS[len] || LEN_WORDS['Medium (~1000 words)']}. Level: ${level} — match the vocabulary and depth to it. Language: write the whole assignment in ${lang} (keep technical terms in English).
Return JSON only: {"title":"...","subject":"...","introduction":"...","sections":[{"heading":"...","paragraphs":["...","..."]}],"conclusion":"...","references":["..."]}
Structure: a proper assignment — title, an introduction that states what will be covered, 3-6 headed sections with full paragraphs (not bullet fragments), and a conclusion that sums up the argument. ${refsOn ? 'references: 3-6 plausible source entries in a standard format, drawn from the material where possible.' : 'references: return an empty list.'}`;
      const d = refPdf
        ? await geminiJson(`Write a student assignment draft. ${topic ? `The assignment topic, as typed by the student, is: "${topic}" — lead with it.` : 'The student typed no topic — take the assignment subject from the reference PDF itself.'} The professor's REFERENCE PDF content is below: build the draft following its topics and structure, in its own order, and use its content. ${shape}\n\n--- REFERENCE PDF CONTENT ---\n${refPdf.text.slice(0, 60000)}`, { temperature: 0.55, onRetry: retryNote(b) })
        : await geminiJson(`Write a student assignment draft on this topic: "${topic}". ${shape}`, { temperature: 0.55, onRetry: retryNote(b) });
      prog.setStep(2);
      const sections = d.sections || [];
      const words = [d.introduction || '', ...sections.flatMap(s => s.paragraphs || []), d.conclusion || ''].join(' ').split(/\s+/).filter(Boolean).length;
      const md = `# ${d.title || topic}\n${d.subject ? `\n${d.subject}\n` : ''}\n## Introduction\n${d.introduction || ''}\n${sections.map(s => `\n## ${s.heading}\n${(s.paragraphs || []).join('\n\n')}`).join('\n')}\n\n## Conclusion\n${d.conclusion || ''}${refsOn && (d.references || []).length ? `\n\n## References\n${d.references.map(r => `- ${r}`).join('\n')}` : ''}`;
      out('aresult', `<div class="outcard"><h3>${esc(d.title || topic)}</h3>${d.subject ? `<p class="sub mt">${esc(d.subject)}</p>` : ''}<p class="small dim mt">About ${words.toLocaleString()} words · ${esc(level)} level · ${esc(lang)}</p></div>
        <div class="outcard"><b>Introduction</b><p class="out mt">${esc(d.introduction || '')}</p></div>
        ${sections.map(s => `<div class="outcard"><b>${esc(s.heading)}</b>${(s.paragraphs || []).map(p => `<p class="out mt">${esc(p)}</p>`).join('')}</div>`).join('')}
        <div class="outcard"><b>Conclusion</b><p class="out mt">${esc(d.conclusion || '')}</p></div>
        ${refsOn && (d.references || []).length ? `<div class="outcard"><b>References</b><ul class="mt">${d.references.map(r => `<li>${esc(r)}</li>`).join('')}</ul><p class="small dim mt">Check every reference against your library before submitting — AI-drafted lists can contain errors.</p></div>` : ''}
        <div class="btns two mt"><button class="btn sm" id="adl">Download assignment (.md)</button><button class="btn dark sm" id="acopy">Copy the whole assignment</button></div>
        <div class="note mt"><div><b>A study draft — make it yours.</b><div class="small dim">This draft gives you the structure and a starting text. Rewrite it in your own words, add your teacher's examples, and check the facts before you submit — submitting any AI draft as-is is both risky and against most school rules.</div></div></div>`);
      on('adl', 'click', () => download('assignment.md', md, 'text/markdown'));
      on('acopy', 'click', () => copyText(md, 'Assignment copied.'));
      prog.done();
      toast('Assignment draft ready — now rewrite it in your own words.');
    } catch (err) { prog.fail(err.message); toast('Assignment failed: ' + err.message, true); }
    busy(b, false, 'Build my assignment');
  });
}

/* ---------- Profile Picture Maker ----------
 * Two ways in: restyle your own photo (the photo goes to the image model
 * as an input part — real AI editing of YOUR picture) or describe an
 * avatar from text. The frame/ring is applied on canvas AFTER generation,
 * and every platform size is a true canvas render of the picked version. */
if (tool === 'profilepic') {
  let ppMode = 'photo', ppFile = null, ppStyle = 'gaming', ppVers = 4, ppFrame = 'gradient';
  let raws = [], picked = -1;
  const setPpTab = (t) => {
    ppMode = t;
    for (const k of ['photo', 'describe']) {
      const tab = $(`pp-t${k}`); if (tab) tab.classList.toggle('on', k === t);
      const panel = $(`panel-pp-${k}`); if (panel) panel.classList.toggle('hidden', k !== t);
    }
  };
  on('pp-tphoto', 'click', () => setPpTab('photo'));
  on('pp-tdescribe', 'click', () => setPpTab('describe'));
  on('ppfile', 'change', (e) => {
    ppFile = e.target.files?.[0] || null;
    const st = $('ppstatus'), prev = $('ppprev');
    if (ppFile) {
      if (st) st.textContent = `Selected: ${ppFile.name} (${(ppFile.size / 1048576).toFixed(1)} MB)`;
      if (prev) { prev.src = URL.createObjectURL(ppFile); prev.classList.remove('hidden'); }
    } else { if (st) st.textContent = ''; if (prev) prev.classList.add('hidden'); }
  });
  wireChips('rg-pstyle', 'pstyle', v => { ppStyle = v; });
  wireChips('rg-pver', 'pver', v => { ppVers = Number(v); });
  wireChips('rg-pframe', 'pframe', v => { ppFrame = v; renderAllPfp(); });
  on('ppbg', 'change', () => { const w = $('ppcolorwrap'); if (w) w.classList.toggle('hidden', $('ppbg').value !== 'solid'); });
  const STYLE_TXT = {
    gaming: 'esports gaming avatar portrait of the person, dramatic rim lighting, wearing a gaming headset, confident expression, vibrant colours, high detail',
    anime: 'anime-style portrait of the person, clean line art, expressive eyes, vibrant colours, studio-quality illustration',
    headshot: 'professional corporate headshot of the person, studio lighting, smart clothing, photorealistic, sharp focus',
    cartoon3d: '3D animated-movie character portrait of the person, Pixar-style rendering, soft lighting, charming and friendly',
    neon: 'neon cyberpunk portrait of the person, glowing magenta and cyan light, futuristic mood, cinematic',
    keep: 'the same person, cleaned up: tidy studio lighting, natural light retouch, neat appearance — still clearly and recognisably them, photorealistic',
  };
  function bgPhrase() {
    const bg = $('ppbg').value;
    if (bg === 'solid') return `plain solid background, colour ${$('ppcolor').value}`;
    if (bg === 'blurred') return 'softly blurred background, subject in sharp focus';
    return ppMode === 'photo' ? 'keep the original background setting' : 'a background that fits the style';
  }
  function loadImgEl(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
  function drawPfp(img, size, frame) {
    const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
    const x = cv.getContext('2d');
    const sc = Math.max(size / img.naturalWidth, size / img.naturalHeight);
    x.drawImage(img, (size - img.naturalWidth * sc) / 2, (size - img.naturalHeight * sc) / 2, img.naturalWidth * sc, img.naturalHeight * sc);
    if (frame !== 'none') {
      const cx = size / 2, cy = size / 2, r = size * 0.462, lw = Math.max(3, size * 0.034);
      x.lineWidth = lw;
      x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2);
      if (frame === 'gradient') {
        const g = x.createLinearGradient(0, 0, size, size);
        g.addColorStop(0, '#ffe46b'); g.addColorStop(0.5, '#ff7ac8'); g.addColorStop(1, '#4aa8ff');
        x.strokeStyle = g; x.stroke();
      } else if (frame === 'rgb') {
        const cols = ['#ff004c', '#ff8a00', '#ffee00', '#00e436', '#008aff', '#a200ff'];
        for (let i = 0; i < 6; i++) {
          x.beginPath(); x.strokeStyle = cols[i];
          x.arc(cx, cy, r, (i / 6) * Math.PI * 2 - Math.PI / 2, ((i + 1) / 6) * Math.PI * 2 - Math.PI / 2);
          x.stroke();
        }
      } else if (frame === 'gold') {
        const g = x.createLinearGradient(0, 0, size, size);
        g.addColorStop(0, '#f9e08a'); g.addColorStop(0.35, '#caa53d'); g.addColorStop(0.55, '#fff2b0'); g.addColorStop(0.8, '#caa53d'); g.addColorStop(1, '#f9e08a');
        x.strokeStyle = g; x.stroke();
      } else if (frame === 'neon') {
        x.save();
        x.shadowColor = '#39f5ff'; x.shadowBlur = size * 0.028;
        x.strokeStyle = '#39f5ff'; x.stroke();
        x.shadowColor = '#ff4dff'; x.shadowBlur = size * 0.02;
        x.beginPath(); x.arc(cx, cy, r - lw * 1.15, 0, Math.PI * 2); x.strokeStyle = '#ff4dff'; x.lineWidth = lw * 0.55; x.stroke();
        x.restore();
      }
    }
    return cv;
  }
  async function renderAllPfp() {
    const host = $('ppversions'); if (!host || !raws.length) return;
    host.querySelectorAll('[data-pcv]').forEach(async (slot) => {
      const i = Number(slot.dataset.pcv);
      if (!raws[i]) return;
      try {
        const img = await loadImgEl(raws[i]);
        const cv = drawPfp(img, 540, ppFrame);
        slot.innerHTML = '';
        cv.style.width = '100%'; cv.style.borderRadius = '14px'; cv.style.display = 'block';
        slot.appendChild(cv);
      } catch { /* keep the placeholder */ }
    });
    paintPfpDownloads();
  }
  function paintPfpDownloads() {
    const host = $('ppdl'); if (!host) return;
    if (picked < 0 || !raws[picked]) { host.innerHTML = ''; return; }
    const sizes = [['Instagram / TikTok', 1080], ['YouTube', 800], ['Facebook', 720], ['WhatsApp', 640]];
    host.innerHTML = `<div class="outcard"><b>Download version ${picked + 1} — platform sizes</b>
      <p class="small dim mt">Every size is rendered fresh from the full-quality master, with the ${esc(ppFrame)} frame applied. Square 1:1, as the platforms crop them.</p>
      <div class="btns two mt">${sizes.map(([n, s]) => `<button class="btn dark sm" data-pdl="${s}">${n} · ${s}×${s}</button>`).join('')}</div></div>`;
    host.querySelectorAll('[data-pdl]').forEach(btn => btn.addEventListener('click', async () => {
      try {
        const img = await loadImgEl(raws[picked]);
        const cv = drawPfp(img, Number(btn.dataset.pdl), ppFrame);
        const a = document.createElement('a'); a.download = `profile-picture-${btn.dataset.pdl}.png`; a.href = cv.toDataURL('image/png'); a.click();
        toast(`Downloaded at ${btn.dataset.pdl}×${btn.dataset.pdl}.`);
      } catch { toast('That size could not be rendered — try another version.', true); }
    }));
  }
  on('ppgo', 'click', async (e) => {
    if (!requireKey()) return;
    let imagePart = null;
    if (ppMode === 'photo') {
      if (!ppFile) { toast('Upload your photo first.', true); return; }
      if (ppFile.size > 18 * 1024 * 1024) { toast('This photo is over ~18 MB — use a smaller copy.', true); return; }
    } else if ($('pprompt').value.trim().length < 8) { toast('Describe the avatar you want first (a sentence or two).', true); return; }
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Reading your input', 'Styling your pictures', 'Framing the versions', 'Ready']);
    try {
      if (ppMode === 'photo') imagePart = await fileToInline(ppFile);
      prog.setStep(1);
      const styleTxt = ppMode === 'describe' && ppStyle === 'keep' ? 'clean professional studio portrait photograph, natural light, sharp focus' : STYLE_TXT[ppStyle];
      const prompt = ppMode === 'photo'
        ? `Restyle this person's photo into a square profile picture: ${styleTxt}. Background: ${bgPhrase()}. Keep the person's face clearly recognisable as the same person. Square composition, face centred and large in the frame, head-and-shoulders. No text, no watermark.`
        : `Create a square profile-picture avatar: ${$('pprompt').value.trim()}. Style: ${styleTxt}. Background: ${bgPhrase()}. Square composition, the subject centred and large in the frame. No text, no watermark.`;
      out('ppversions', `<div class="pfpgrid">${Array.from({ length: ppVers }, (_, i) => `<div class="vercard" data-ver="${i}"><div data-pcv="${i}" class="pfpslot"><span class="spin"></span> Creating version ${i + 1}…</div><p class="small dim mt">Version ${i + 1}</p></div>`).join('')}</div>
        <p class="small dim mt">Tap a version to pick it — the platform-size downloads appear under your pick.</p>`);
      out('ppdl', '');
      raws = new Array(ppVers).fill(null); picked = -1;
      let prevErr = null, made = 0;
      for (let i = 0; i < ppVers; i++) {
        if (i > 0) await breather(prevErr);
        const slot = document.querySelector(`[data-pcv="${i}"]`);
        try {
          raws[i] = await geminiImage(prompt, imagePart, '1:1', { onRetry: retryNote(null, slot) });
          prevErr = null; made++;
          if (picked < 0) picked = i;
        } catch (err) {
          prevErr = err;
          if (slot) slot.innerHTML = `<p class="small" style="color:var(--red)">Version ${i + 1} failed — ${esc(err.message)}</p>`;
        }
        prog.setFraction((i + 1) / ppVers);
      }
      document.querySelectorAll('[data-ver]').forEach(card => card.addEventListener('click', () => {
        const i = Number(card.dataset.ver);
        if (!raws[i]) return;
        picked = i;
        document.querySelectorAll('[data-ver]').forEach(c => c.classList.toggle('sel', Number(c.dataset.ver) === picked));
        paintPfpDownloads();
      }));
      prog.setStep(2);
      await renderAllPfp();
      document.querySelectorAll('[data-ver]').forEach(c => c.classList.toggle('sel', Number(c.dataset.ver) === picked));
      prog.done();
      if (!made) throw new Error('No version could be created — see the error on the cards above.');
      toast(`${made} version${made > 1 ? 's' : ''} ready — tap one to pick it, then download your sizes.`);
    } catch (err) { prog.fail(err.message); toast('Profile picture failed: ' + err.message, true); }
    busy(b, false, 'Create my pictures');
  });
}

/* ---------- Urdu/Hindi Dub Maker ----------
 * Step 1 extracts the spoken lines with timestamps. Step 3 translates them
 * (natural dub or narrator retelling) and voices EVERY line with the
 * chosen Gemini voice — per-line audio, a timed .srt in the target
 * language, and a two-language lines sheet. Mixing the dub onto the video
 * itself is the render step — stated plainly on the page. */
if (tool === 'dub') {
  const vsel = $('dvoice');
  if (vsel) vsel.innerHTML = GEMINI_VOICES.map(v => `<option${v === 'Kore' ? ' selected' : ''}>${v}</option>`).join('');
  let dubTab = 'yt', dubFile = null, dubSegs = [], dubDone = false;
  const MAXSEG = 60, CAPSEC = 1800;
  const setDubTab = (t) => {
    dubTab = t;
    for (const k of ['yt', 'up']) {
      const tab = $(`dub-${k}`); if (tab) tab.classList.toggle('on', k === t);
      const panel = $(`panel-dub-${k}`); if (panel) panel.classList.toggle('hidden', k !== t);
    }
  };
  on('dub-yt', 'click', () => setDubTab('yt'));
  on('dub-up', 'click', () => setDubTab('up'));
  on('dfile', 'change', (e) => {
    dubFile = e.target.files?.[0] || null;
    const st = $('dstatus');
    if (st) st.textContent = dubFile ? `Selected: ${dubFile.name} (${(dubFile.size / 1048576).toFixed(1)} MB)` : '';
  });
  const EXTRACT_PROMPT = `Listen to this video carefully and extract the spoken lines with timestamps. Return JSON only: {"language":"the language actually spoken","segments":[{"startSec":0,"endSec":0,"text":"the exact spoken words of this segment"}]}
Segments of 2-7 seconds of speech each, in order, covering the whole video you were given. Transcribe ONLY what is actually said — never summarise or invent. If there is no speech, return {"language":"none","segments":[]}.`;
  on('dextract', 'click', async (e) => {
    if (!requireKey()) return;
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Reading the video', 'Listening & extracting the lines', 'Ready']);
    try {
      let d;
      if (dubTab === 'yt') {
        const link = $('dlink').value.trim();
        if (!ytId(link)) { toast('Paste a proper YouTube link first.', true); busy(b, false, 'Extract the spoken lines'); return; }
        prog.setStep(1);
        d = await geminiYouTubeJson(link, EXTRACT_PROMPT + ` Cover at most the first ${CAPSEC} seconds.`, { startSec: 0, endSec: CAPSEC, timeoutMs: 240000, onRetry: retryNote(b) });
      } else {
        if (!dubFile) { toast('Choose your video file first.', true); busy(b, false, 'Extract the spoken lines'); return; }
        if (dubFile.size > 18 * 1024 * 1024) { toast('This video is over ~18 MB — too big to send to Gemini from the browser. Trim it or use a smaller copy.', true); busy(b, false, 'Extract the spoken lines'); return; }
        prog.setStep(1);
        const part = await fileToInline(dubFile);
        d = await geminiPartsJson([part, { text: EXTRACT_PROMPT }], { temperature: 0.2, timeoutMs: 240000, onRetry: retryNote(b) });
      }
      dubSegs = (d.segments || []).map(s => ({ start: parseTs(s.startSec) || 0, end: parseTs(s.endSec) || 0, orig: String(s.text || ''), dub: '', audioUrl: '' })).filter(s => s.orig.trim());
      if (!dubSegs.length) throw new Error('No spoken lines were found — a dub needs speech.');
      const capped = dubSegs.length > MAXSEG;
      if (capped) dubSegs = dubSegs.slice(0, MAXSEG);
      dubDone = false;
      out('dsegments', `<div class="outcard"><div class="spread"><b>${dubSegs.length} lines extracted</b><span class="tag y">${esc(d.language || 'original language')}</span></div>
        <p class="small dim mt">${dubTab === 'yt' ? `For YouTube links, extraction covers the first 30 minutes. ` : ''}${capped ? `The dub pack is capped at ${MAXSEG} lines per run — this run uses the first ${MAXSEG}. ` : ''}Check the lines, choose your dub options below, then generate.</p>
        <div style="max-height:300px;overflow:auto" class="mt">${dubSegs.map((s, i) => `<p class="small mt"><b>${esc(fmt(s.start))}</b> — ${esc(s.orig)}</p>`).join('')}</div></div>`);
      $('dubopts').classList.remove('hidden');
      prog.done();
      toast(`${dubSegs.length} lines extracted — now pick the language and voice.`);
    } catch (err) { prog.fail(err.message); toast('Extract failed: ' + err.message, true); }
    busy(b, false, 'Extract the spoken lines');
  });
  on('dgo', 'click', async (e) => {
    if (!requireKey()) return;
    if (!dubSegs.length) { toast('Extract the spoken lines first (Step 1).', true); return; }
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Translating the lines', 'Voicing the dub', 'Packing the dub', 'Ready']);
    const lang = $('dlang').value, style = $('dstyle').value, voice = vsel ? vsel.value : 'Kore';
    try {
      // Translate in chunks of 15 lines per call, mapping preserved by index.
      const CH = 15;
      let prevErr = null;
      for (let c = 0; c < dubSegs.length; c += CH) {
        if (c > 0) await breather(prevErr);
        const slice = dubSegs.slice(c, c + CH);
        try {
          const d = await geminiJson(`Translate these spoken video lines into ${lang} for a voice dub. ${style === 'narrator'
            ? 'STYLE — Narrator: do not translate word for word. Retell each line naturally in one narrator\'s voice, as if a single narrator is telling the viewer what is happening and being said. Keep each line\'s meaning and order.'
            : 'STYLE — Natural dub: translate the MEANING the way a real dub artist would say it in ' + lang + ' — natural spoken phrasing, same emotion, similar length so it fits the same seconds. Not word-for-word.'}
Return JSON only: {"lines":["..."]} — exactly ${slice.length} lines, in the same order as the input.
Lines:\n${slice.map((s, i) => `${i + 1}. ${s.orig}`).join('\n')}`, { bulk: true, temperature: 0.5, onRetry: retryNote(b) });
          (d.lines || []).forEach((t, i) => { if (slice[i]) slice[i].dub = String(t || ''); });
          prevErr = null;
        } catch (err) { prevErr = err; throw err; }
        prog.setFraction((c + slice.length) / dubSegs.length);
      }
      if (dubSegs.some(s => !s.dub)) dubSegs.forEach(s => { if (!s.dub) s.dub = s.orig; });
      // Voice every line, paced; a failed line keeps its text and shows why.
      prog.setStep(1);
      let vprev = null, voiced = 0;
      for (let i = 0; i < dubSegs.length; i++) {
        if (i > 0) await breather(vprev);
        try {
          const blob = await geminiTTS(dubSegs[i].dub, voice, { onRetry: retryNote(b) });
          dubSegs[i].audioUrl = URL.createObjectURL(blob);
          vprev = null; voiced++;
        } catch (err) { vprev = err; dubSegs[i].audioErr = err.message; }
        prog.setFraction((i + 1) / dubSegs.length);
      }
      prog.setStep(2);
      const srt = cuesToSrt(buildCues(dubSegs.map(s => ({ start: s.start, end: s.end, text: s.dub })), 'clean'));
      const md = `# Dub pack — ${lang}\nVoice: ${voice} · Style: ${style === 'narrator' ? 'Narrator' : 'Natural dub'}\n\n${dubSegs.map((s, i) => `## Line ${i + 1} · ${fmt(s.start)} – ${fmt(s.end)}\n- Original: ${s.orig}\n- ${lang}: ${s.dub}`).join('\n\n')}`;
      out('dresult', `<div class="outcard"><div class="spread"><b>Dub pack ready — ${esc(lang)}</b><span class="tag y">${voiced}/${dubSegs.length} lines voiced</span></div>
        <p class="small dim mt">Voice: ${esc(voice)}. Every line below has its own audio — play it, or download it line by line. The .srt carries the same lines with the original timing.</p>
        <div class="btns two mt"><button class="btn sm" id="ddlsrt">Download dub .srt (${esc(lang)})</button><button class="btn dark sm" id="ddlmd">Download lines sheet (.md)</button></div></div>
        ${dubSegs.map((s, i) => `<div class="outcard"><div class="spread"><b>Line ${i + 1}</b><span class="tag y">${esc(fmt(s.start))} – ${esc(fmt(s.end))}</span></div>
          <p class="small dim mt">Original: ${esc(s.orig)}</p>
          <p class="small mt"><b>${esc(lang)}:</b> ${esc(s.dub)}</p>
          ${s.audioUrl ? `<audio controls src="${s.audioUrl}" style="width:100%" class="mt"></audio><a class="btn dark sm mt" href="${s.audioUrl}" download="dub-line-${i + 1}.wav">Download line ${i + 1} audio (.wav)</a>` : `<p class="small mt" style="color:var(--red)">Voice failed for this line — ${esc(s.audioErr || 'try generating again')}</p>`}
        </div>`).join('')}
        <div class="note mt"><div><b>The render step finishes it.</b><div class="small dim">Mixing this dub onto the video itself — replacing the original voice track with these lines at these times — is the render step. Today you get the complete timed dub pack: the translated script as .srt, the lines sheet, and every line's audio, ready for that step or for any video editor.</div></div></div>`);
      on('ddlsrt', 'click', () => download(`dub-${lang.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.srt`, srt, 'text/plain'));
      on('ddlmd', 'click', () => download('dub-lines.md', md, 'text/markdown'));
      dubDone = true;
      prog.done();
      toast(`Dub pack ready — ${voiced} of ${dubSegs.length} lines voiced.`);
    } catch (err) { prog.fail(err.message); toast('Dub failed: ' + err.message, true); }
    busy(b, false, 'Generate the dub');
  });
}
