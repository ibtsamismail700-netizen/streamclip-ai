// StreamClip AI — tool logic. All AI runs in the browser on the visitor's key.
import { requireKey, hasKey, geminiText, geminiJson, geminiImage, geminiParts, geminiPartsJson, geminiYouTubeJson, geminiTTS, GEMINI_VOICES, fileToInline, esc } from './gemini.js';
import { toast, saveWork, workFor } from './site.js';
import { initEditor } from './editor.js';

const $ = (id) => document.getElementById(id);
const tool = document.body.dataset.tool;
const busy = (btn, on, label) => { btn.disabled = on; btn.innerHTML = on ? '<span class="spin"></span> Working…' : label; };
// Visible retry progress: when every free pair is resting after a 429,
// gemini.js waits ONCE for the earliest quota reset — this callback makes
// that wait VISIBLE on the busy button (and a status line, when the tool
// has one) instead of a silent spinner. gemini.js sends the exact line in
// `message` ("All free limits are resting — continuing in Ns…").
const retryMsg = (info) => info?.message || `Google is busy — retrying (${info?.attempt}/${info?.total})…`;
const retryNote = (btn, el) => (info) => {
  const msg = retryMsg(info);
  if (btn) btn.innerHTML = `<span class="spin"></span> ${msg}`;
  if (el) el.textContent = msg;
};
/* ----- AlphaPost-pattern pacing -----
 * AlphaPost keeps one free key happy by making FEW, SPACED calls inside
 * slow background jobs. Our heavy loops do the same: a short breather
 * (~2s) between sequential Gemini calls, and a longer one (~8s) after a
 * call that hit the free limit — so bursts never slam the per-minute
 * quota, and after a 429 the next loop call lands on a DIFFERENT pair
 * (the exhausted one is cooling and gets skipped). The first call of a
 * task is never paced — it fires instantly — and the progress ring keeps
 * advancing, so the breather reads as steady work, not a hang. */
const pace = (ms) => new Promise((r) => setTimeout(r, ms));
const hitLimit = (e) => !!e && /free limit|limit reached|quota|429|rate/i.test(e.message || '');
const breather = (prevErr) => pace(prevErr && hitLimit(prevErr) ? 8000 : 2000);
/* ---------- Job progress ring (shared, AlphaPost-style) ----------
 * Honest progress only: the % is steps completed plus a within-step
 * fraction ONLY where the code truly knows it (scan windows done, versions
 * made, slides voiced). Nothing here creeps forward on a timer. */
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
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
function roundRect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
function wrapText(x, text, a, b, maxW, lh, maxLines = 4) {
  const words = String(text).split(/\s+/); let line = '', y = b, lines = 0;
  for (const w of words) { const test = line ? line + ' ' + w : w; if (x.measureText(test).width > maxW && line) { x.fillText(line, a, y); line = w; y += lh; if (++lines >= maxLines) return y; } else line = test; }
  if (line) x.fillText(line, a, y);
  return y;
}
function copyText(t, msg = 'Copied.') { navigator.clipboard.writeText(t).then(() => toast(msg)).catch(() => toast('Copy failed — select the text manually.', true)); }
// Finished clips are remembered (title + a small poster frame) so the home
// page's "Your shorts" grid can show them. Video files themselves are NOT
// stored — they are downloaded at export time and are far too big for
// localStorage.
const SHORTS_LS = 'sc_shorts_v1';
function saveShort(title, videoEl, toolPage = 'upload-video') {
  try {
    let thumb = '';
    if (videoEl && videoEl.videoWidth) {
      const cv = document.createElement('canvas'); cv.width = 270; cv.height = 480;
      const x = cv.getContext('2d');
      const sc = Math.max(270 / videoEl.videoWidth, 480 / videoEl.videoHeight);
      x.fillStyle = '#000'; x.fillRect(0, 0, 270, 480);
      x.drawImage(videoEl, (270 - videoEl.videoWidth * sc) / 2, (480 - videoEl.videoHeight * sc) / 2, videoEl.videoWidth * sc, videoEl.videoHeight * sc);
      thumb = cv.toDataURL('image/jpeg', 0.72);
    }
    const arr = JSON.parse(localStorage.getItem(SHORTS_LS) || '[]');
    arr.unshift({ title: title || 'Untitled short', thumb, when: Date.now(), tool: toolPage });
    localStorage.setItem(SHORTS_LS, JSON.stringify(arr.slice(0, 12)));
  } catch {}
}
function chunkText(text, size = 5000) {
  const blocks = text.split(/\n\s*\n/); const chunks = []; let cur = '';
  for (const b of blocks) { if ((cur + '\n\n' + b).length > size && cur) { chunks.push(cur); cur = b; } else cur = cur ? cur + '\n\n' + b : b; }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [text];
}
/** Split a batched designer-briefs reply into per-style briefs (null when
 * unusable). Top-level (not nested in the thumbnail block) so the
 * regression suite in tests/ can exercise it directly. */
function parseBriefBatch(d, names) {
  if (!d || typeof d !== 'object') return null;
  const out = {};
  for (const name of names) {
    const v = d[name];
    if (typeof v === 'string' && v.trim()) out[name] = v.trim();
  }
  return Object.keys(out).length ? out : null;
}

/* ---------- Student Mode: shared lecture source (YouTube / PDF / text) ----------
 * Every student tool starts from the same source step. Students have either
 * a YouTube lecture or a PDF (or pasted text). Analysing a source prepares it
 * once; every output on the page — and, via a localStorage handoff, every
 * other student tool — then works from that same material without rescanning.
 */
const STUDENT_TOOLS = ['notes', 'flashcards', 'presentation', 'lecture-clips', 'examprep'];
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
/** JSON generation from whichever source is prepared. */
async function sourceJson(prompt, opts = {}) {
  if (!srcReady()) throw new Error('Add your lecture source first (Step 1).');
  if (SRC.type === 'youtube') return geminiPartsJson([srcPart(), { text: prompt }], { temperature: 0.5, timeoutMs: 240000, ...opts });
  return geminiJson(`${prompt}\n\n--- THE MATERIAL ---\n${String(SRC.text || '').slice(0, 60000)}`, opts);
}
/** Plain-text generation from whichever source is prepared. */
async function sourceText(prompt, opts = {}) {
  if (!srcReady()) throw new Error('Add your lecture source first (Step 1).');
  if (SRC.type === 'youtube') return geminiParts([srcPart(), { text: prompt }], { temperature: 0.5, timeoutMs: 240000, ...opts });
  return geminiText(`${prompt}\n\n--- THE MATERIAL ---\n${String(SRC.text || '').slice(0, 60000)}`, opts);
}
function paintNeedSrc() { const ns = $('needsrc'); if (ns) ns.classList.toggle('hidden', srcReady()); }
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
  paintNeedSrc();
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
  try { window.dispatchEvent(new CustomEvent('sc-src-ready')); } catch { /* event is best-effort */ }
}
function setSource(src) {
  SRC = src;
  renderSrcSummary();
  saveHandoff();
}
function clearSource() {
  SRC = null;
  try { localStorage.removeItem(SRC_LS); } catch { /* ignore */ }
  renderSrcSummary();
  const mt = $('moretools'); if (mt) mt.classList.add('hidden');
  const note = $('srcnote'); if (note) note.classList.add('hidden');
}
if (STUDENT_TOOLS.includes(tool)) {
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
  // --- Analyse a YouTube lecture: Gemini watches the whole video once ---
  on('scanbtn', 'click', async (e) => {
    if (!requireKey()) return;
    const link = $('srclink').value.trim();
    const id = srcYtId(link);
    if (!id) { toast('Paste a proper YouTube lecture link first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Reading the source', 'Analysing the lecture', 'Ready']);
    try {
      prog.setStep(1, 'Gemini is watching the whole lecture…');
      const d = await geminiPartsJson([{ fileData: { fileUri: link, mimeType: 'video/*' } }, { text: `Watch this whole lecture video carefully. Return JSON only: {"title":"...","durationSec":0,"chapters":[{"title":"...","startSec":0}]}
title: the lecture's real title. durationSec: its total length in seconds (0 only if you truly cannot tell). chapters: the main topics in the EXACT order they are taught (never reshuffled), each with startSec = the second from the video start where that topic begins. Up to 12 chapters.` }], { temperature: 0.3, timeoutMs: 240000, onRetry: (info) => prog.setStep(1, retryMsg(info)) });
      const chapters = (d.chapters || []).map(c => ({ title: String(c.title || 'Topic'), startSec: parseTs(c.startSec) })).filter(c => c.title);
      setSource({ type: 'youtube', link, videoId: id, title: d.title || '', durationSec: Number(d.durationSec) || 0, chapters, ready: true });
      prog.done();
      toast('Lecture analysed — now choose your options below.');
    } catch (err) { prog.fail(err.message); toast('Analyse failed: ' + err.message, true); }
    busy(b, false, 'Analyse lecture');
  });
  // --- Analyse a PDF: Gemini extracts its full content once ---
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
    const st = $('pdfstatus');
    try {
      const part = await fileToInline(pendingPdf); // PDF goes to Google as an inlineData part
      prog.setStep(1, 'Gemini is extracting the full text…');
      const d = await geminiPartsJson([part, { text: `Extract the content of this PDF document for a student. Return JSON only: {"text":"...","sections":["..."],"pageCount":0}
text: the FULL text of the document in reading order — do not summarise, skip or shorten it; keep headings on their own lines. sections: the main section headings, in the document's own order. pageCount: the number of pages in this PDF if you can tell, otherwise 0.` }], { temperature: 0.2, timeoutMs: 240000, onRetry: (info) => prog.setStep(1, retryMsg(info)) });
      const text = String(d.text || '').trim();
      if (text.length < 80) throw new Error('No readable text came out of this PDF. If it is scanned images, paste the text instead.');
      const pages = Number(d.pageCount) || 0;
      if (st) st.textContent = pages > 0 ? `PDF read — ${pages} pages of content ready.` : 'PDF read — content ready.';
      setSource({ type: 'pdf', text, pdfName: pendingPdf.name, title: '', durationSec: 0, chapters: (d.sections || []).map(s => ({ title: String(s), startSec: null })), ready: true });
      prog.done();
      toast('PDF analysed — now choose your options below.');
    } catch (err) { prog.fail(err.message); if (st) st.textContent = ''; toast('Analyse failed: ' + err.message, true); }
    busy(b, false, 'Analyse PDF');
  });
  // --- Pasted text ---
  on('usetext', 'click', () => {
    const text = $('srctext').value.trim();
    if (text.length < 120) { toast('Paste a longer text first (at least a few paragraphs).', true); return; }
    setSource({ type: 'text', text, title: '', durationSec: 0, chapters: [], ready: true });
    toast('Text ready — now choose your options below.');
  });
  // --- Restore a source another student tool already analysed (handoff) ---
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

/* ---------- Designed notes sheet: data-driven renderer + 6 themes ----------
 * One anatomy, six looks (like the Pinterest study-notes references):
 * centred title + one-line subtitle, numbered sections with pastel heading
 * chips in rotation, short bullets, a "Key idea" box per section, formulas
 * in their own bordered boxes, definitions in small boxes, an Examples box,
 * an "Important" box for exam-critical points, and a bold Remember strip.
 */
const SHEET_THEMES = [
  ['sticky', 'Sticky Notes'], ['notebook', 'Notebook Classic'], ['pastel', 'Pastel Laws'],
  ['mint', 'Mint Fresh'], ['sky', 'Sky Minimal'], ['peach', 'Peach Warm'],
];
const SHEET_ROT_LS = 'sc_sheet_rot_v1';
function sheetWatch(sec) {
  if (!SRC || SRC.type !== 'youtube' || !SRC.videoId || sec == null) return '';
  return `https://www.youtube.com/watch?v=${SRC.videoId}&t=${Math.max(0, Math.floor(sec))}s`;
}
function sheetHTML(d, theme) {
  const secs = (d.sections || []).map((s, i) => {
    const w = sheetWatch(s.startSec);
    return `<div class="sheet-sec"><div class="sheet-sec-head"><span class="sheet-num">${i + 1}</span><span class="sheet-chip pc${i % 6}">${esc(s.heading || 'Section')}</span>${w ? `<a class="sheet-time" href="${w}" target="_blank" rel="noopener">▶ ${fmt(s.startSec)}</a>` : ''}</div>
    ${s.body ? `<p class="body">${esc(s.body)}</p>` : ''}
    ${(s.points || []).length ? `<ul>${s.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    ${s.keyIdea ? `<div class="sheet-key"><b>Key idea</b>${esc(s.keyIdea)}</div>` : ''}
    ${(s.formulas || []).length ? `<div class="sheet-fmls">${s.formulas.map(f => `<span class="sheet-fml">${esc(f)}</span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
  const allFormulas = [...(d.formulas || []), ...(d.sections || []).flatMap(s => s.formulas || [])];
  return `<div class="sheet th-${theme}">
  <div class="sheet-head"><div class="sheet-kicker">StreamClip AI · Study notes</div><h3>${esc(d.title || 'Lecture notes')}</h3>${d.subtitle ? `<p class="sheet-sub">${esc(d.subtitle)}</p>` : ''}</div>
  <div class="sheet-body">${secs}
  ${allFormulas.length ? `<h4 class="sheet-h">Formulas &amp; exact facts</h4><div class="sheet-fmls">${allFormulas.map(f => `<span class="sheet-fml">${esc(f)}</span>`).join('')}</div>` : ''}
  ${(d.definitions || []).length ? `<h4 class="sheet-h">Key definitions</h4><div class="sheet-defs">${d.definitions.map(x => `<div class="sheet-def"><b>${esc(x.term)}</b><span>${esc(x.meaning)}</span></div>`).join('')}</div>` : ''}
  ${(d.examples || []).length ? `<div class="sheet-box"><h5>Examples</h5><ul>${d.examples.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
  ${(d.important || []).length ? `<div class="sheet-box sheet-imp"><h5>Important — exam favourites</h5><ul>${d.important.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
  ${(d.questions || []).length ? `<div class="sheet-box"><h5>Likely exam questions</h5><ul>${d.questions.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
  ${(d.remember || []).length ? `<div class="sheet-take"><b>★ Remember</b><ul>${d.remember.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}
  </div></div>`;
}
function sheetMd(d) {
  const L = [`# ${d.title || 'Lecture notes'}`, d.subtitle ? `\n${d.subtitle}` : ''];
  (d.sections || []).forEach((s, i) => {
    L.push(`\n## ${i + 1}. ${s.heading}${s.startSec != null && SRC && SRC.type === 'youtube' ? ` (${fmt(s.startSec)} — ${sheetWatch(s.startSec)})` : ''}`);
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
  if ((d.questions || []).length) L.push(`\n## Likely exam questions\n${d.questions.map(x => `- ${x}`).join('\n')}`);
  if ((d.remember || []).length) L.push(`\n## Remember\n${d.remember.map(r => `- ${r}`).join('\n')}`);
  return L.join('\n');
}
async function sheetToPng(sheetEl, name) {
  if (!window.html2canvas) { toast('Image download could not run in this browser — use Print, then "Save as PDF", instead.', true); return; }
  try {
    toast('Making the picture — one moment…');
    const cv = await window.html2canvas(sheetEl, { scale: 2, backgroundColor: '#f8f4e9', useCORS: true, logging: false });
    const a = document.createElement('a'); a.download = `${name}.png`; a.href = cv.toDataURL('image/png'); a.click();
    toast('Notes picture downloaded.');
  } catch { toast('Image download failed in this browser — use Print, then "Save as PDF", instead.', true); }
}
function sheetPrint(sheetEl) {
  document.querySelectorAll('.sheet.picked').forEach(s => s.classList.remove('picked'));
  sheetEl.classList.add('picked');
  document.body.classList.add('printmode');
  const clean = () => { document.body.classList.remove('printmode'); sheetEl.classList.remove('picked'); window.removeEventListener('afterprint', clean); };
  window.addEventListener('afterprint', clean);
  setTimeout(clean, 60000);
  window.print();
}
/** Mount a sheet (design switcher + sheet + actions) into a host element. */
function mountSheet(host, data, baseName) {
  if (!host) return;
  host._data = data;
  if (!host._design) host._design = 'auto';
  if (host._design === 'auto') {
    let n = 0; try { n = Number(localStorage.getItem(SHEET_ROT_LS) || 0) || 0; localStorage.setItem(SHEET_ROT_LS, String(n + 1)); } catch { /* ignore */ }
    host._theme = SHEET_THEMES[n % SHEET_THEMES.length][0];
  } else host._theme = host._design;
  const paint = () => {
    const sh = host.querySelector('.sheethost');
    if (sh) sh.innerHTML = sheetHTML(host._data, host._theme);
    host.querySelectorAll('[data-design]').forEach(c => c.classList.toggle('on', c.dataset.design === host._design));
  };
  host.innerHTML = `<div class="chips designchips"><span class="small dim" style="align-self:center"><b>Design:</b></span>
    <button class="chip" data-design="auto">Auto</button>${SHEET_THEMES.map(([id, name]) => `<button class="chip" data-design="${id}">${name}</button>`).join('')}</div>
    <div class="sheethost"></div>
    <div class="btns three mt"><button class="btn sm" data-act="png">Download picture (PNG)</button><button class="btn dark sm" data-act="print">Print sheet</button><button class="btn dark sm" data-act="md">Download notes (.md)</button></div>`;
  paint();
  host.querySelectorAll('[data-design]').forEach(c => c.addEventListener('click', () => {
    host._design = c.dataset.design;
    if (host._design !== 'auto') host._theme = host._design;
    else { let n = 0; try { n = Number(localStorage.getItem(SHEET_ROT_LS) || 0) || 0; } catch { /* ignore */ } host._theme = SHEET_THEMES[n % SHEET_THEMES.length][0]; }
    paint();
    toast(host._design === 'auto' ? 'Design: Auto — new notes rotate through all six looks.' : 'Design changed — same notes, new look. No new AI call was made.');
  }));
  const sheetEl = () => host.querySelector('.sheet');
  host.querySelector('[data-act="png"]').addEventListener('click', () => sheetToPng(sheetEl(), baseName));
  host.querySelector('[data-act="print"]').addEventListener('click', () => sheetPrint(sheetEl()));
  host.querySelector('[data-act="md"]').addEventListener('click', () => download(`${baseName}.md`, sheetMd(host._data), 'text/markdown'));
}
/** One-page revision sheet data, from the prepared source. Shared by Notes + Exam Prep. */
async function revisionSheetData(onRetry) {
  const d = await sourceJson(`Compress the WHOLE attached lecture material into a ONE-PAGE revision sheet. Return JSON only: {"title":"...","subtitle":"one line that sums up the topic","sections":[{"heading":"...","startSec":0,"points":["..."],"body":"","keyIdea":"","formulas":["..."]}],"definitions":[{"term":"...","meaning":"..."}],"examples":["..."],"important":["..."],"remember":["..."]}
Keep it to one page: at most 4 sections with at most 4 short points each, at most 6 definitions, at most 2 examples. Sections stay in the material's own order — never reshuffled. startSec: ${SRC && SRC.type === 'youtube' ? 'the second where the section begins in the video' : 'always null'}. Write in simple, easy words. Formulas, dates and exact facts go in "formulas" lists, never buried in points. "remember": 1-2 lines a student must not forget.`, { temperature: 0.4, onRetry });
  if (!d || !Array.isArray(d.sections)) throw new Error('The AI reply could not be read. Try again.');
  return d;
}

/* ---------- Hooks + Title Generator ---------- */
if (tool === 'hooks') {
  let toneVal = 'Exciting';
  document.querySelectorAll('[data-tone]').forEach(c => c.addEventListener('click', () => { toneVal = c.dataset.tone; document.querySelectorAll('[data-tone]').forEach(x => x.classList.toggle('on', x === c)); }));
  on('sampletopic', 'click', (e) => { e.preventDefault(); $('topic').value = 'I beat the hardest boss in the game with no armour — it took 57 tries'; $('topic').focus(); toast('Sample topic filled — tap Generate to try it.'); });
  // Packs accumulate: each generation adds a new round ABOVE the previous
  // ones (the guide advises "generate twice and mix the best" — replacing
  // the pack made that impossible). The newest pack is saved to Your Work
  // and restored when the page opens again.
  let rounds = [];
  function renderRounds() {
    const host = $('result'); if (!host) return;
    host.innerHTML = rounds.map((p, ri) => {
      const label = p.restored ? `Restored — your last pack (${new Date(p.t).toLocaleString()})` : (rounds.length > 1 ? `Round ${rounds.length - ri}` : 'Your pack');
      return `<div class="spread mt2"><h3>${label}</h3><span class="tag">${esc(p.topic || '')}</span></div>
      <div class="outcard"><div class="spread"><b>Hooks — say one in the first 2 seconds</b><button class="chip" data-cp="hooks" data-r="${ri}">Copy hooks</button></div><ol>${p.hooks.map(h => `<li>${esc(h)}</li>`).join('')}</ol></div>
      <div class="outcard"><div class="spread"><b>Titles</b><button class="chip" data-cp="titles" data-r="${ri}">Copy titles</button></div><ol>${p.titles.map(t => `<li>${esc(t)}</li>`).join('')}</ol></div>
      <div class="outcard"><div class="spread"><b>Hashtags</b><button class="chip" data-cp="tags" data-r="${ri}">Copy hashtags</button></div><p class="out mt">${p.tags.map(esc).join(' ')}</p></div>
      <button class="btn dark block mt" data-cp="all" data-r="${ri}">Copy everything</button>`;
    }).join('');
    host.querySelectorAll('[data-cp]').forEach(btn => btn.addEventListener('click', () => {
      const p = rounds[Number(btn.dataset.r)]; if (!p) return;
      if (btn.dataset.cp === 'hooks') copyText(p.hooks.join('\n'), 'Hooks copied.');
      else if (btn.dataset.cp === 'titles') copyText(p.titles.join('\n'), 'Titles copied.');
      else if (btn.dataset.cp === 'tags') copyText(p.tags.join(' '), 'Hashtags copied.');
      else copyText(`HOOKS\n${p.hooks.join('\n')}\n\nTITLES\n${p.titles.join('\n')}\n\n${p.tags.join(' ')}`, 'Everything copied.');
    }));
  }
  const savedPack = workFor('hooks');
  if (savedPack && savedPack.payload && Array.isArray(savedPack.payload.hooks)) { rounds = [{ ...savedPack.payload, restored: true, t: savedPack.t }]; renderRounds(); }
  // Handoff: Keyword Finder's "Use in a title" arrives as ?topic=…
  try {
    const qt = new URLSearchParams(location.search).get('topic');
    if (qt && $('topic') && !$('topic').value) { $('topic').value = qt; toast('Keyword filled in — tap Generate.'); }
  } catch {}
  on('go', 'click', async (e) => {
    if (!requireKey()) return;
    const topic = $('topic').value.trim();
    if (!topic) { toast('Write your topic first.', true); return; }
    const n = Number($('hcount').value);
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Writing hooks', 'Writing titles & hashtags', 'Ready']);
    try {
      const d = await geminiJson(`You are a viral short-form content strategist. Topic: "${topic}". Platform: ${$('platform').value}. Tone: ${toneVal}. Hook style: ${$('hstyle').value}. Language: ${$('hlang').value}.
Return JSON only: {"hooks":["..."],"titles":["..."],"hashtags":["..."]}
Give exactly ${n} hooks (3-7 punchy words each, all in the chosen hook style, no emojis), ${Math.max(4, n - 2)} titles (max 60 characters each), ${n} hashtags (no # symbol, single words or short phrases). Write hooks and titles in the chosen language.`, { bulk: true, onRetry: (info) => prog.setStep(0, retryMsg(info)) });
      prog.setStep(1);
      const pack = { topic, hooks: d.hooks || [], titles: d.titles || [], tags: (d.hashtags || []).map(h => '#' + String(h).replace(/\s+/g, '')) };
      rounds.unshift(pack);
      renderRounds();
      saveWork('hooks', topic, pack);
      prog.done();
    } catch (err) { prog.fail(err.message); toast(err.message, true); }
    busy(b, false, 'Generate hooks & titles');
  });
}

/* ---------- Caption Translation ---------- */
if (tool === 'translate') {
  let mkOn = false;
  const mkSwitch = $('mktitle');
  if (mkSwitch) mkSwitch.addEventListener('click', () => { mkOn = !mkOn; mkSwitch.classList.toggle('on', mkOn); });
  const SRT_STYLE = {
    'Clean full lines': 'Keep each caption line whole and natural.',
    'Short lines — max 7 words': 'Break the translation into SHORT caption lines of at most 7 words each, keeping every timestamp attached to its first line.',
    'Word-by-word (karaoke)': 'Output the translation word by word — one word per line in reading order — keeping each timestamp at the start of its phrase.',
  };
  // Upload an .srt/.txt file straight into the caption box.
  on('srcfile', 'change', async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { $('src').value = await f.text(); toast(`Loaded ${f.name} into the caption box — pick your language and translate.`); }
    catch { toast('That file could not be read — paste the captions instead.', true); }
  });
  function renderTranslation(p) {
    const mkHtml = p.mkText
      ? `<div class="outcard"><b>Title + description (${esc(p.lang)})</b><p class="out mt">${esc(p.mkText)}</p><button class="btn dark sm mt" id="copymk">Copy title + description</button></div>`
      : (p.mkWanted ? '<div class="outcard"><b>Title + description</b><p class="small dim mt">That extra step did not answer — your translation above is complete without it.</p></div>' : '');
    out('result', `${p.restored ? `<p class="small dim mt">Restored — your last translation (${new Date(p.t).toLocaleString()}).</p>` : ''}<div class="outcard"><div class="spread"><b>Translated captions (${esc(p.lang)})</b><span class="tag y">${p.chunks} part${p.chunks > 1 ? 's' : ''}</span></div><p class="out mt">${esc(p.r)}</p>
      <div class="btns two mt"><button class="btn dark sm" id="copytr">Copy translation</button><button class="btn sm" id="dltr">Download (.srt)</button></div></div>
      <div class="outcard"><b>Companion note</b><p class="small dim mt">${esc(p.note)}</p><button class="chip mt" id="copynote">Copy note</button></div>
      ${mkHtml}`);
    on('copytr', 'click', () => copyText(p.r, 'Translation copied.'));
    on('copynote', 'click', () => copyText(p.note, 'Note copied.'));
    if (p.mkText) on('copymk', 'click', () => copyText(p.mkText, 'Title + description copied.'));
    on('dltr', 'click', () => download(`translated-captions-${p.styleName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.srt`, p.r, 'text/plain'));
  }
  const savedTr = workFor('translate');
  if (savedTr && savedTr.payload && savedTr.payload.r) renderTranslation({ ...savedTr.payload, restored: true, t: savedTr.t });
  on('go', 'click', async (e) => {
    if (!requireKey()) return;
    const text = $('src').value.trim();
    if (!text) { toast('Paste your captions first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    const st = $('tstatus');
    const prog = makeProgress($('prog'), ['Translating captions', 'Writing the title + description', 'Ready']);
    let mkText = '';
    try {
      const chunks = chunkText(text, 4500);
      const parts = [];
      for (let i = 0; i < chunks.length; i++) {
        if (i > 0) await breather(null); // pacing: space the chunk calls out
        if (st) st.textContent = chunks.length > 1 ? `Translating part ${i + 1} of ${chunks.length}…` : 'Translating…';
        prog.setStep(0, chunks.length > 1 ? `Translating part ${i + 1} of ${chunks.length}` : 'Translating captions');
        parts.push(await geminiText(`Translate these video captions from ${$('sfrom').value} into ${$('lang').value}. Style: ${$('tstyle').value}. Caption formatting: ${SRT_STYLE[$('srtstyle').value] || SRT_STYLE['Clean full lines']} Keep every timestamp exactly as it is. Translate only the spoken words. Do not add explanations, do not wrap in code fences.\n\n${chunks[i]}`, { bulk: true, temperature: 0.3, onRetry: retryNote(b, st) }));
        prog.setFraction((i + 1) / chunks.length);
      }
      const r = parts.join('\n\n');
      const styleName = $('srtstyle').value;
      const lineCount = r.split('\n').filter(l => l.trim()).length;
      const note = `Companion note — captions translated to ${$('lang').value} in "${styleName}" style (${lineCount} lines, from ${$('sfrom').value}). Keep this note with the .srt file so you remember which style and language it uses.`;
      if (mkOn) {
        prog.setStep(1);
        if (st) st.textContent = 'Writing the title + description…';
        try {
          mkText = await geminiText(`Write a YouTube title (max 70 characters) and a 2-3 line description in ${$('lang').value} for a video whose captions begin like this:\n${text.slice(0, 1500)}\nReturn exactly in this shape:\nTITLE: ...\nDESCRIPTION: ...`, { temperature: 0.6, onRetry: retryNote(b, st) });
        } catch { mkText = ''; }
      }
      if (st) st.textContent = 'Done — translation ready below.';
      const payload = { r, lang: $('lang').value, styleName, chunks: chunks.length, note, mkText, mkWanted: mkOn };
      renderTranslation(payload);
      saveWork('translate', `Captions → ${payload.lang}`, payload);
      prog.done();
    } catch (err) { prog.fail(err.message); toast(err.message, true); if (st) st.textContent = ''; }
    busy(b, false, 'Translate captions');
  });
}

/* ---------- Lecture to Notes ---------- */
if (tool === 'notes') {
  let easyOn = true; // "Explain in easy language" — default ON (user's emphasis)
  const easyEl = $('neasy');
  if (easyEl) easyEl.addEventListener('click', () => { easyOn = !easyOn; easyEl.classList.toggle('on', easyOn); });
  const LEN_GUIDE = {
    'Short revision': 'Keep it tight: at most 6 sections, 3-4 short points each — only what a student revises the night before.',
    'Full notes': 'Cover the whole lecture properly: every main topic becomes a section, 4-7 points each.',
    'Detailed chapter-wise': 'Be exhaustive: one section per chapter/topic, 6-10 points each, with sub-details and the reasoning, not just conclusions.',
  };
  const STYLE_GUIDE = {
    'Bullet points': 'Write every section as short bullet "points"; leave "body" empty.',
    'Headings + paragraphs': 'Write each section mainly as a short flowing paragraph in "body", plus at most 3 "points" carrying the sharpest facts.',
    'Exam-focused': 'Weight everything toward the exam: phrase points as answers to likely questions, put traps and examiner favourites in "important", and also return "questions": the likely exam questions from this material.',
  };
  async function notesData({ easy, lang, len, style }, onRetry) {
    const isYt = SRC && SRC.type === 'youtube';
    const prompt = `You are a study-notes writer making designed notes from the attached lecture material.
Return JSON only: {"title":"...","subtitle":"one line that sums up the whole topic","sections":[{"heading":"...","startSec":0,"points":["..."],"body":"","keyIdea":"","formulas":["..."]}],"definitions":[{"term":"...","meaning":"..."}],"examples":["..."],"important":["..."],"remember":["..."]}
ORDER RULE (important): the sections MUST follow the exact order the material teaches the topics — the same sequence from start to finish. Never reshuffle, group or reorder topics.
${isYt ? 'startSec: the second (from the video start) where that section of the lecture begins.' : 'startSec: always null — use the material\'s own section headings as the section headings.'}
LENGTH: ${LEN_GUIDE[len] || LEN_GUIDE['Full notes']}
STYLE: ${STYLE_GUIDE[style] || STYLE_GUIDE['Bullet points']}
${easy ? 'EASY LANGUAGE (important): explain everything in very simple, easy words — short sentences and everyday examples — so even a weak student understands every point word by word. Avoid hard words; when a technical term is needed, explain it in simple words in brackets right there.' : ''}
LANGUAGE: write all the notes in ${lang}. Keep technical terms in English.
keyIdea: fill it only when the section has ONE clear takeaway a student must not miss; otherwise "".
formulas: every formula, equation, date or exact fact belongs in a "formulas" list (shown in boxes), never buried inside points.
examples: only real examples that are IN the material — never invent new ones; [] if the material has none.
important: exam-critical points, likely-question areas and traps from the material; [] if none stand out.
remember: 1-2 short lines — the must-not-forget summary of the whole lecture.
definitions: the key terms, each with a one-line meaning in the notes language.`;
    try {
      const d = await sourceJson(prompt, { temperature: 0.45, onRetry });
      if (!d || !Array.isArray(d.sections) || !d.sections.length) throw new Error('bad shape');
      return d;
    } catch {
      // Graceful fallback: the older, simpler notes schema, mapped onto the sheet.
      const d = await sourceJson(`You are a study-notes writer. From the attached lecture material, make clean revision notes. Write in ${lang}.${easy ? ' Use very simple, easy words throughout.' : ''}
Return JSON only: {"title":"...","summary":"...","keyPoints":["..."],"definitions":[{"term":"...","meaning":"..."}],"formulas":["..."],"examTraps":["..."],"remember":["..."]}
Keep points short and exact to the material, in the material's own order.`, { temperature: 0.45, onRetry });
      return {
        title: d.title || 'Lecture notes', subtitle: d.summary || '',
        sections: [{ heading: 'Key points', startSec: null, points: d.keyPoints || [], body: '', keyIdea: '', formulas: [] }],
        definitions: d.definitions || [], formulas: d.formulas || [], examples: [],
        important: d.examTraps || [], remember: d.remember || [],
      };
    }
  }
  async function makeNotes(overrides, btn) {
    if (!requireKey() || !requireSource()) return;
    const opts = {
      easy: overrides.easy != null ? overrides.easy : easyOn,
      lang: overrides.lang || $('nlang').value,
      len: $('nlen').value,
      style: $('nstyle').value,
    };
    busy(btn, true);
    const prog = makeProgress($('prog'), ['Reading the source', 'Analysing the lecture', 'Writing your notes', 'Designing the sheet', 'Ready']);
    prog.setStep(1);
    try {
      const d = await notesData(opts, retryNote(btn));
      prog.setStep(3);
      mountSheet($('result'), d, 'lecture-notes');
      const host = $('result');
      const extra = document.createElement('div');
      extra.innerHTML = `<div class="btns two mt"><label class="field"><span>Explain language</span><select class="input" id="explang"><option>English</option><option>Urdu</option><option>Hindi</option></select><span class="small dim">For the simple-words version.</span></label>
      <div class="field"><span>&nbsp;</span><button class="btn dark block" id="explain">Explain in simple words</button><span class="small dim">Regenerates these notes in easy language.</span></div></div>`;
      host.appendChild(extra);
      on('explain', 'click', (ev) => makeNotes({ easy: true, lang: $('explang').value }, ev.currentTarget));
      saveWork('notes', d.title || 'Lecture notes', { data: d });
      prog.done();
      toast('Notes ready — pick a design above the sheet, or download the picture.');
    } catch (err) { prog.fail(err.message); toast('Notes failed: ' + err.message, true); }
    busy(btn, false, 'Make my notes');
  }
  on('go', 'click', (e) => makeNotes({}, e.currentTarget));
  // Restore the last notes + revision sheet made on this device.
  const savedNotes = workFor('notes');
  if (savedNotes && savedNotes.payload && savedNotes.payload.data) mountSheet($('result'), savedNotes.payload.data, 'lecture-notes');
  const savedSheet = workFor('notes-sheet');
  if (savedSheet && savedSheet.payload && savedSheet.payload.data) mountSheet($('sheetresult'), savedSheet.payload.data, 'revision-sheet');
  on('sheetgo', 'click', async (e) => {
    if (!requireKey() || !requireSource()) return;
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Reading the source', 'Writing the sheet', 'Designing the sheet', 'Ready']);
    prog.setStep(1);
    try {
      const d = await revisionSheetData(retryNote(b));
      prog.setStep(2);
      mountSheet($('sheetresult'), d, 'revision-sheet');
      saveWork('notes-sheet', d.title || 'Revision sheet', { data: d });
      prog.done();
      toast('Revision sheet ready — one page, everything that matters.');
    } catch (err) { prog.fail(err.message); toast('Revision sheet failed: ' + err.message, true); }
    busy(b, false, 'Make my revision sheet');
  });
}

/* ---------- Flashcards + Quiz ---------- */
if (tool === 'flashcards') {
  let cards = [], ci = 0, flipped = false, quizData = [], answered = 0, score = 0;
  const mastered = new Set(); // indices of cards the student marked "Got it"
  function renderDeck(restoredNote) {
    out('result', `${restoredNote ? `<p class="small dim mt">${restoredNote}</p>` : ''}${cards.length ? `<h3 class="mt2">Flashcards — tap a card to flip</h3><div class="flashcard" id="fc"></div>
      <div class="btns three mt"><button class="btn dark" id="prev">Previous</button><button class="btn dark" id="gotit">Got it ✓</button><button class="btn dark" id="next">Next</button></div>
      <p class="small dim mt" id="fcn"></p>
      <div class="btns two mt"><button class="btn dark sm" id="shuf">Shuffle deck</button><button class="btn sm" id="dldeck">Download deck (.txt)</button></div>` : ''}
      ${quizData.length ? `<h3 class="mt2">Quiz — tap an answer</h3><div class="outcard spread"><b>Your score</b><span class="tag y" id="qscore">0 / ${quizData.length}</span></div>
      ${quizData.map((q, qi) => `<div class="outcard"><b>Q${qi + 1}. ${esc(q.q)}</b>
      <div class="chips mt">${q.options.map((o, oi) => `<button class="chip" data-q="${qi}" data-o="${oi}">${esc(o)}</button>`).join('')}</div>
      <p class="small dim mt hidden" id="why-${qi}"></p></div>`).join('')}
      <p class="small dim mt" id="qfinal"></p>
      <button class="btn dark sm" id="qrestart">Restart quiz</button>` : ''}`);
    const draw = () => {
      if (!cards.length) return;
      $('fc').textContent = flipped ? cards[ci].back : cards[ci].front;
      $('fcn').textContent = `Card ${ci + 1} of ${cards.length} — ${flipped ? 'answer' : 'question'} side${mastered.has(ci) ? ' · ✓ mastered' : ''} · ${mastered.size} of ${cards.length} mastered`;
      const g = $('gotit'); if (g) g.textContent = mastered.has(ci) ? '✓ Got it (tap to undo)' : 'Got it ✓';
    };
    if (cards.length) {
      draw();
      on('fc', 'click', () => { flipped = !flipped; draw(); });
      on('prev', 'click', () => { ci = (ci - 1 + cards.length) % cards.length; flipped = false; draw(); });
      on('next', 'click', () => { ci = (ci + 1) % cards.length; flipped = false; draw(); });
      on('gotit', 'click', () => { if (mastered.has(ci)) mastered.delete(ci); else mastered.add(ci); draw(); if (mastered.size === cards.length) toast('Whole deck mastered — exam ready.'); });
      on('shuf', 'click', () => { for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; } ci = 0; flipped = false; mastered.clear(); draw(); toast('Deck shuffled.'); });
      on('dldeck', 'click', () => download('flashcards.txt', cards.map((c, i) => `CARD ${i + 1}\nQ: ${c.front}\nA: ${c.back}`).join('\n\n'), 'text/plain'));
    }
    if (quizData.length) {
      answered = 0; score = 0;
      document.querySelectorAll('[data-q]').forEach(btn => btn.addEventListener('click', () => {
        const qi = Number(btn.dataset.q), q = quizData[qi];
        const card = btn.closest('.outcard');
        if (card.dataset.done) return;
        card.dataset.done = '1'; answered++;
        const ok = Number(btn.dataset.o) === Number(q.answer);
        if (ok) score++;
        btn.classList.add('on'); btn.style.background = ok ? 'var(--green)' : 'var(--red)';
        card.querySelectorAll('[data-q]').forEach(x => { if (Number(x.dataset.o) === Number(q.answer)) x.style.outline = '2px solid var(--green)'; x.disabled = true; });
        const w = $(`why-${qi}`); if (w) { w.classList.remove('hidden'); w.textContent = (ok ? 'Correct. ' : `Not quite — the answer is "${q.options[q.answer]}". `) + (q.why || ''); }
        const sc = $('qscore'); if (sc) sc.textContent = `${score} / ${quizData.length}`;
        if (answered === quizData.length) { const f = $('qfinal'); if (f) f.textContent = `Quiz finished — you scored ${score} out of ${quizData.length} (${Math.round(score / quizData.length * 100)}%). ${score === quizData.length ? 'Perfect — exam ready.' : 'Review the red ones above, then restart the quiz or regenerate for a fresh round.'}`; }
      }));
      on('qrestart', 'click', () => { renderDeck(); toast('Quiz restarted — same questions, clean slate.'); });
    }
  }
  const savedDeck = workFor('flashcards');
  if (savedDeck && savedDeck.payload && (savedDeck.payload.cards || []).length) {
    cards = savedDeck.payload.cards || []; quizData = savedDeck.payload.quiz || []; ci = 0; flipped = false;
    renderDeck(`Restored — your last deck & quiz (${new Date(savedDeck.t).toLocaleString()}).`);
  }
  on('go', 'click', async (e) => {
    if (!requireKey() || !requireSource()) return;
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Reading your material', 'Making flashcards', 'Making the quiz', 'Ready']);
    prog.setStep(1);
    try {
      const nc = Number($('fccount').value), nq = Number($('fqcount').value);
      const d = await sourceJson(`Make study material from the attached lecture material ONLY. Difficulty: ${$('fdiff').value}. Return JSON only:
{"flashcards":[{"front":"question or term","back":"answer"}],"quiz":[{"q":"...","options":["a","b","c","d"],"answer":0,"why":"one line"}]}
Exactly ${nc} flashcards and ${nq} quiz questions. Stay exact to the material — invent nothing.`, { temperature: 0.5, onRetry: retryNote(b) });
      cards = d.flashcards || []; quizData = d.quiz || []; ci = 0; flipped = false; mastered.clear();
      renderDeck();
      saveWork('flashcards', 'Flashcards + Quiz', { cards, quiz: quizData });
      prog.done();
    } catch (err) { prog.fail(err.message); toast(err.message, true); }
    busy(b, false, 'Make flashcards & quiz');
  });
}

/* ---------- Video Presentation Maker ---------- */
if (tool === 'presentation') {
  // Populate the Gemini voice picker.
  const vsel = $('pvoice');
  if (vsel) vsel.innerHTML = GEMINI_VOICES.map(v => `<option${v === 'Kore' ? ' selected' : ''}>${v}</option>`).join('');
  /* ----- Optional professor's Reference PDF -----
   * The student uploads the reference PDF their professor gave them; Gemini
   * extracts it (same inlineData path as the other student tools) and lists
   * its topics on the page FIRST, so the student sees what will be covered.
   * When present, the PDF leads the slide plan (the typed topic still leads
   * as the subject; empty topic = subject taken from the PDF). */
  let refFile = null, refPdf = null; // refPdf: {text, topics[]}
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
      const part = await fileToInline(refFile); // PDF goes to Google as an inlineData part
      const d = await geminiPartsJson([part, { text: `Read this reference PDF a professor gave a student for a presentation. Return JSON only: {"text":"...","topics":["..."]}
text: the FULL text of the document in reading order — do not summarise or shorten it; keep headings on their own lines. topics: the document's topics/structure as a short list (up to 12), in the document's own order, each one line.` }], { temperature: 0.2, timeoutMs: 240000, onRetry: retryNote(b, st) });
      const text = String(d.text || '').trim();
      if (text.length < 80) throw new Error('No readable text came out of this PDF.');
      refPdf = { text, topics: (d.topics || []).map(t => String(t)).filter(Boolean) };
      if (st) st.textContent = 'Reference PDF read — its topics are below. Now plan your presentation.';
      out('reftopics', `<div class="outcard"><b>Topics found in your PDF</b>${refPdf.topics.length ? `<ul class="mt">${refPdf.topics.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="small dim mt">No clear topic list came back, but the full text was read and will still guide the slides.</p>'}<p class="small dim mt">Your slides will follow these topics, in this order.</p></div>`);
      prog.done();
      toast('Reference PDF read — topics listed below.');
    } catch (err) { prog.fail(err.message); if (st) st.textContent = ''; toast('Reference PDF failed: ' + err.message, true); }
    busy(b, false, 'Read reference PDF');
  });
  /* ----- Deck downloads: genuine .pptx + print-route PDF -----
   * The final deck (whichever source built it) is kept in `deck`.
   * PPTX is a real PowerPoint file built in the browser with PptxGenJS.
   * PDF uses a print-optimised slide view (one slide per page) instead of
   * jsPDF, whose built-in fonts cannot render Urdu/Hindi text — the
   * browser's own "Save as PDF" renders every language correctly. */
  let deck = null;
  async function downloadPptx() {
    const errEl = $('dlerr');
    const libFail = () => { if (errEl) { errEl.textContent = 'The download library couldn\'t load — check your connection and reload the page, then try again.'; errEl.classList.remove('hidden'); } };
    if (!window.PptxGenJS) { libFail(); return; }
    if (!deck) return;
    try {
      const pptx = new window.PptxGenJS();
      pptx.defineLayout({ name: 'W16x9', width: 13.33, height: 7.5 });
      pptx.layout = 'W16x9';
      const RECT = (pptx.shapes && pptx.shapes.RECTANGLE) || 'rect';
      const DARK = '12100C', YEL = 'FFC81F', WHITE = 'FFFFFF', DIMC = 'CFC8B8';
      const t = pptx.addSlide(); t.background = { color: DARK };
      t.addShape(RECT, { x: 0.7, y: 2.15, w: 1.1, h: 0.12, fill: { color: YEL } });
      t.addText(deck.title || 'Presentation', { x: 0.7, y: 2.45, w: 11.9, h: 1.9, fontSize: 40, bold: true, color: WHITE, fontFace: 'Arial' });
      if (deck.topic && deck.topic !== deck.title) t.addText(deck.topic, { x: 0.7, y: 4.45, w: 11.9, h: 0.6, fontSize: 18, color: YEL, fontFace: 'Arial' });
      t.addText('Made with StreamClip AI', { x: 0.7, y: 6.75, w: 11.9, h: 0.4, fontSize: 12, color: DIMC, fontFace: 'Arial' });
      for (const s of deck.slides) {
        const sl = pptx.addSlide(); sl.background = { color: DARK };
        sl.addShape(RECT, { x: 0, y: 0, w: 13.33, h: 0.14, fill: { color: YEL } });
        sl.addText(s.title || '', { x: 0.7, y: 0.55, w: 11.9, h: 1.0, fontSize: 30, bold: true, color: WHITE, fontFace: 'Arial' });
        sl.addText((s.bullets || []).map(bt => ({ text: String(bt), options: { bullet: true, breakLine: true } })), { x: 0.7, y: 1.8, w: 11.9, h: 4.6, fontSize: 19, color: WHITE, fontFace: 'Arial', lineSpacingMultiple: 1.25 });
        if (s.narration) sl.addNotes(String(s.narration));
      }
      const fname = (deck.title || 'presentation').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'presentation';
      await pptx.writeFile({ fileName: `${fname}.pptx` });
      toast('PPT downloaded — your narration is in each slide\'s speaker notes.');
    } catch (err) { toast('PPT failed: ' + err.message, true); }
  }
  function downloadPdf() {
    if (!deck) return;
    document.querySelectorAll('.deckprint').forEach(x => x.remove());
    const host = document.createElement('div'); host.className = 'deckprint';
    host.innerHTML = `<div class="pslide title"><div class="bar"></div><h2>${esc(deck.title || 'Presentation')}</h2><p>${esc(deck.topic || '')}</p></div>`
      + deck.slides.map(s => `<div class="pslide"><div class="bar"></div><h2>${esc(s.title || '')}</h2><ul>${(s.bullets || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul><p class="narr"><b>Speaker notes:</b> ${esc(s.narration || '')}</p></div>`).join('');
    document.body.appendChild(host);
    document.body.classList.add('printdeck');
    const clean = () => { document.body.classList.remove('printdeck'); window.removeEventListener('afterprint', clean); };
    window.addEventListener('afterprint', clean);
    setTimeout(clean, 60000);
    toast('In the print window, choose "Save as PDF" — one slide per page.');
    window.print();
  }
  function renderDeck(restoredNote) {
    if (!deck) return;
    const d = deck;
    const script = (d.slides || []).map((s, i) => `SLIDE ${i + 1}: ${s.title}\n${s.narration}`).join('\n\n');
    out('result', `${restoredNote ? `<p class="small dim mt">${restoredNote}</p>` : ''}<div class="outcard"><h3>${esc(d.title || d.topic || '')}</h3><p class="small dim mt">Voice for playback: <b>${esc(vsel ? vsel.value : 'Kore')}</b> (change it above and re-play any slide). Play uses Gemini's AI voice on your key.</p></div>
      ${(d.slides || []).map((s, i) => `<div class="outcard slidecard"><b>Slide ${i + 1} — ${esc(s.title)}</b>
        <ul>${(s.bullets || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <p class="small dim mt"><b>Voice script:</b> ${esc(s.narration)}</p>
        <div class="btns two mt"><button class="btn sm" data-tts="${i}">▶ Play AI voice</button><button class="btn dark sm" data-dla="${i}">Download voice (.wav)</button></div>
        <div id="aud-${i}" class="mt"></div></div>`).join('')}
      <div class="outcard"><b>Download your presentation</b>
        <p class="small dim mt">The real files students submit: a PowerPoint with your narration in each slide's speaker notes, and a PDF with one slide per page. Deck quality: <b>${esc(deck.quality || '1080p')}</b> — saved with the deck for the render step; the PPT/PDF downloads don't use it.</p>
        <div class="btns two mt"><button class="btn sm" id="dlpptx">Download PPT (.pptx)</button><button class="btn dark sm" id="dlpdf">Download PDF</button></div>
        <p class="small dim mt hidden" id="dlerr"></p></div>
      <div class="btns two mt"><button class="btn sm" id="dls">Download voice script (.txt)</button><button class="btn dark sm" id="playall">▶ Play all slides with voice</button></div>`);
    on('dlpptx', 'click', downloadPptx);
    on('dlpdf', 'click', downloadPdf);
    on('dls', 'click', () => download('presentation-script.txt', `${d.title || d.topic}\n\n${script}`, 'text/plain'));
    const speak = async (i, dl) => {
      const s = (deck.slides || [])[i]; if (!s) return;
      try {
        toast('Generating the AI voice…');
        const blob = await geminiTTS(s.narration, vsel ? vsel.value : 'Kore', { onRetry: (info) => { const host = $(`aud-${i}`); if (host) host.textContent = info.message || `Google is busy — retrying the voice (${info.attempt}/${info.total})…`; } });
        const url = URL.createObjectURL(blob);
        if (dl) { const a = document.createElement('a'); a.href = url; a.download = `slide-${i + 1}-voice.wav`; a.click(); }
        else { const host = $(`aud-${i}`); if (host) host.innerHTML = `<audio controls autoplay src="${url}" style="width:100%"></audio>`; }
        return url;
      } catch (err) { toast('Voice failed: ' + err.message, true); return null; }
    };
    document.querySelectorAll('[data-tts]').forEach(x => x.addEventListener('click', () => speak(Number(x.dataset.tts), false)));
    document.querySelectorAll('[data-dla]').forEach(x => x.addEventListener('click', () => speak(Number(x.dataset.dla), true)));
    on('playall', 'click', async (e) => {
      if (!requireKey()) return;
      const b = e.currentTarget; let stop = false;
      b.disabled = false; b.textContent = '⏹ Playing — tap to stop';
      const stopH = () => { stop = true; };
      b.addEventListener('click', stopH);
      try {
        for (let i = 0; i < (deck.slides || []).length && !stop; i++) {
          const url = await speak(i, false);
          if (!url) break;
          b.textContent = `▶ Playing slide ${i + 1} of ${deck.slides.length} — tap to stop`;
          const host = $(`aud-${i}`); const au = host ? host.querySelector('audio') : null;
          if (au) await new Promise(res => { au.addEventListener('ended', res, { once: true }); au.addEventListener('error', res, { once: true }); const iv = setInterval(() => { if (stop) { au.pause(); clearInterval(iv); res(); } }, 250); });
        }
      } finally { b.removeEventListener('click', stopH); b.textContent = '▶ Play all slides with voice'; }
    });
  }
  const savedDeckW = workFor('presentation');
  if (savedDeckW && savedDeckW.payload && savedDeckW.payload.deck && (savedDeckW.payload.deck.slides || []).length) { deck = savedDeckW.payload.deck; renderDeck(`Restored — your last presentation (${new Date(savedDeckW.t).toLocaleString()}). Voices generate again on tap.`); }
  on('go', 'click', async (e) => {
    if (!requireKey()) return;
    const topic = $('topic').value.trim();
    const fromSrc = srcReady();
    if (!refPdf && !fromSrc && !topic) { toast('Add a lecture source in Step 1, read a reference PDF, or write your presentation topic.', true); return; }
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Reading your material', 'Writing the script', 'Building the slides', 'Ready']);
    prog.setStep(1);
    try {
      const shape = `Slides: ${$('slides').value}. Audience level: ${$('level').value}. Narration language: ${$('plang').value}. Speaking tone: ${$('ptone').value}.
Return JSON only: {"title":"...","slides":[{"title":"...","bullets":["..."],"narration":"..."}]}
Narration per slide: 2-4 natural spoken sentences in the chosen language and tone, written to be read aloud by an AI voice. No greetings on every slide.`;
      const d = refPdf
        ? await geminiJson(`Plan a student class-presentation video. The student has a professor's REFERENCE PDF — its content is below. ${topic ? `The presentation subject, as typed by the student, is: "${topic}" — lead with it as the subject.` : 'The student typed no topic — take the presentation subject from the PDF itself.'} Build the slides following the PDF's topics and structure, in its own order, and use its tips and content. Points the student must cover: "${$('points').value.trim()}". ${shape}\n\n--- REFERENCE PDF CONTENT ---\n${refPdf.text.slice(0, 60000)}`, { temperature: 0.55, onRetry: retryNote(b) })
        : fromSrc
          ? await sourceJson(`Plan a student class-presentation video from the attached lecture material.${topic ? ` Focus the presentation on: "${topic}".` : ''} Points the student must cover: "${$('points').value.trim()}". Build the slides from the material itself, in the material's own order. ${shape}`, { temperature: 0.55, onRetry: retryNote(b) })
          : await geminiJson(`Plan a student class-presentation video. Topic: "${topic}". Extra points from the student: "${$('points').value.trim()}". ${shape}`, { onRetry: retryNote(b) });
      deck = { title: d.title || topic, topic, quality: $('pquality') ? $('pquality').value : '1080p', slides: d.slides || [] };
      prog.setStep(2);
      renderDeck();
      saveWork('presentation', deck.title || 'Presentation', { deck });
      prog.done();
    } catch (err) { prog.fail(err.message); toast(err.message, true); }
    busy(b, false, 'Plan my presentation');
  });
}

/* ---------- Thumbnail Creator / Redesigner ---------- */
if (tool === 'thumbnail') {
  // Output sizes, named by platform. ONE source of truth (sizeId) shared by
  // both tabs; every generation run snapshots it ONCE via snapSize() and
  // the snapshot drives the canvas, the card labels, the model aspect and
  // the download names. (Before this, one mutable variable was captured
  // once for labels but re-read live by the painter, the model-aspect
  // helper and the download names — and it was silently shared across
  // tabs — so a size could desync mid-run: 16:9 selected, 1.91:1 made.)
  const SIZES = {
    youtube:    { name: 'YouTube Thumbnail',    px: [1280, 720],  model: '16:9' },
    shorts:     { name: 'Shorts / Reel / Story', px: [1080, 1920], model: '9:16' },
    igpost:     { name: 'Instagram Post',       px: [1080, 1080], model: '1:1' },
    igportrait: { name: 'Instagram Portrait',   px: [1080, 1350], model: '4:5' },
    fbpost:     { name: 'Facebook Post',        px: [1200, 630],  model: '16:9' },
    fbad:       { name: 'Facebook Ad',          px: [1200, 628],  model: '16:9' },
    fbcover:    { name: 'Facebook Cover',       px: [1640, 924],  model: '16:9' },
    classic:    { name: 'Classic',              px: [1280, 960],  model: '4:3' },
  };
  // The image model has no settings for the Facebook sizes (≈1.91:1) or the
  // cover (≈16:9): ask it for 16:9 and let the exact-pixel canvas crop.
  let sizeId = 'youtube';
  const snapSize = () => { const s = SIZES[sizeId] || SIZES.youtube; return { id: sizeId in SIZES ? sizeId : 'youtube', name: s.name, W: s.px[0], H: s.px[1], model: s.model }; };
  const sizeTag = (s) => `${s.name} · ${s.W}×${s.H}`;
  let file = null, analysis = null, analysisText = '';
  // Tabs
  const setTab = (which) => {
    $('tab-creator').classList.toggle('on', which === 'creator');
    $('tab-redesigner').classList.toggle('on', which === 'redesigner');
    $('panel-creator').classList.toggle('hidden', which !== 'creator');
    $('panel-redesigner').classList.toggle('hidden', which !== 'redesigner');
    paintRatios(); // the panel you land on always shows the true shared size
  };
  on('tab-creator', 'click', () => setTab('creator'));
  on('tab-redesigner', 'click', () => setTab('redesigner'));
  // Size chips (both panels share the one sizeId state; the highlighted
  // chip is always repainted from that state, never tracked separately)
  const paintRatios = () => { document.querySelectorAll('[data-size]').forEach(c => c.classList.toggle('on', c.dataset.size === sizeId)); const rl = $('ratiolabel'); if (rl) rl.textContent = sizeTag(snapSize()); };
  document.querySelectorAll('[data-size]').forEach(c => c.addEventListener('click', () => { sizeId = c.dataset.size; paintRatios(); }));
  paintRatios();
  on('plusbtn', 'click', () => $('ratiopop').classList.toggle('hidden'));
  // Text colour swatches
  let inkColor = '#ffffff';
  document.querySelectorAll('[data-ink]').forEach(c => c.addEventListener('click', () => { inkColor = c.dataset.ink; document.querySelectorAll('[data-ink]').forEach(x => x.classList.toggle('on', x === c)); }));
  // Upload for redesign
  on('tfile', 'change', async (e) => {
    file = e.target.files?.[0] || null;
    analysis = null;
    if (file) { const u = URL.createObjectURL(file); $('tprev').src = u; $('tprev').classList.remove('hidden'); }
  });
  on('analyse', 'click', async (e) => {
    if (!requireKey()) return;
    if (!file) { toast('Upload a thumbnail first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const part = await fileToInline(file);
      const d = await geminiPartsJson([part, { text: `Analyse this YouTube thumbnail like a top thumbnail designer. Return JSON only:
{"topic":"what the video is about","textOnThumbnail":"ALL the text written on the thumbnail, word for word","headlineLines":["ONLY the 1-3 MAIN headline lines — the biggest, boldest words a viewer reads first, each line exactly as written"],"otherText":"every other word on the thumbnail that is NOT part of the headline (small print, form labels, button text, codes), or an empty string","subject":"the main subject/face/object","works":["what works, short"],"weak":["what is weak, short"],"directions":["4 redesign directions that look completely different from each other but keep the SAME headline text"]}` }], { temperature: 0.4, onRetry: retryNote(b) });
      analysis = d;
      for (const k of Object.keys(briefCache)) delete briefCache[k]; // new analysis — old designer briefs no longer apply
      briefBatchFor = null; // the batched briefs are refetched for the new analysis
      briefsBroken = false; // and brief generation gets a fresh chance
      // The text field defaults to the HEADLINE lines only (1-3 short
      // lines). The rest of the thumbnail's text is analysis information,
      // not thumbnail copy — dumping it all in produced unusable walls of
      // text on the new versions.
      const headLines = Array.isArray(d.headlineLines) ? d.headlineLines.map(s => String(s).trim()).filter(Boolean).slice(0, 3) : [];
      analysisText = headLines.length ? headLines.join(', ') : (d.textOnThumbnail || '');
      if (analysisText && !$('ttext').value.trim()) $('ttext').value = analysisText;
      out('aresult', `<div class="outcard"><b>Analysis</b>
        <p class="out mt"><b>Topic:</b> ${esc(d.topic || '')}\n<b>Headline (goes on the new versions):</b> ${esc(headLines.length ? headLines.join(' · ') : (d.textOnThumbnail || '(none found)'))}\n<b>Other text on it (not copied):</b> ${esc(d.otherText || '(none)')}\n<b>Main subject:</b> ${esc(d.subject || '')}</p>
        ${(d.works || []).length ? `<b style="display:block" class="mt">What works</b><ul>${d.works.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        ${(d.weak || []).length ? `<b style="display:block" class="mt">What is weak</b><ul>${d.weak.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        ${(d.directions || []).length ? `<b style="display:block" class="mt">Redesign directions (used below)</b><ul>${d.directions.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        <p class="small dim mt">The text box below now holds only the main headline lines — every version keeps those word for word. The smaller text from your thumbnail is listed above and is not copied into the redesigns.</p></div>`);
    } catch (err) {
      toast(err.message, true);
      // The failure must be visible where the analysis would have been —
      // and the path forward stated: the text field still works by hand.
      out('aresult', `<div class="outcard"><b>Analysis did not run</b><p class="out mt">${esc(err.message)}</p><p class="small dim mt">You can still type the thumbnail text yourself in the box below and generate versions — the versions will design from your text alone.</p></div>`);
    }
    busy(b, false, 'Analyse thumbnail');
  });
  // Canvas fallback painter: designed background + the text ONLY, laid out
  // like a thumbnail — never a text wall. The first line is the headline
  // (very large), at most 2 supporting lines sit under it (smaller), and
  // everything keeps real margins: nothing runs edge to edge. It never
  // draws the uploaded thumbnail — a redesign must be a new design.
  function paintThumb(cv, st, text, size) {
    const { W, H } = size; cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, st.bg[0]); g.addColorStop(1, st.bg[1]);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // Split the field into lines (analyse joins headline lines with ", ").
    // Only the first 3 lines are ever painted, however much text is there.
    const segs = String(text).split(/[,•\n]+/).map(s => s.trim()).filter(Boolean);
    const raw = segs.length ? segs : [String(text).trim()];
    const head = (raw[0] || '').toUpperCase();
    const support = raw.slice(1, 3);
    const mx = W * 0.07, maxW = W - mx * 2; // 7% margin on both sides
    const fitFs = (txt, weight, start, min) => {
      let fs = start;
      x.font = `${weight} ${fs}px Poppins, Arial, sans-serif`;
      while (fs > min && x.measureText(txt).width > maxW) { fs -= 4; x.font = `${weight} ${fs}px Poppins, Arial, sans-serif`; }
      return fs;
    };
    const wrapAt = (txt, weight, fs, maxLines) => {
      x.font = `${weight} ${fs}px Poppins, Arial, sans-serif`;
      const words = txt.split(/\s+/); const lines = []; let line = '';
      for (const w of words) { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
      if (line) lines.push(line);
      return lines.slice(0, maxLines);
    };
    // Headline: shrink to fit on one line; wrap to two only at the floor size.
    const headFs = fitFs(head, 900, Math.round(W * 0.13), Math.round(W * 0.045));
    x.font = `900 ${headFs}px Poppins, Arial, sans-serif`;
    const headLines = x.measureText(head).width <= maxW ? [head] : wrapAt(head, 900, headFs, 2);
    const supFs = Math.max(16, Math.round(headFs * 0.42));
    const supLines = [];
    for (const s of support) for (const ln of wrapAt(s, 800, supFs, 2)) { if (supLines.length < 2) supLines.push(ln); }
    const lh = headFs * 1.1, slh = supFs * 1.18;
    const barH = Math.max(10, H * 0.018), gap = H * 0.035, barW = Math.min(280, maxW * 0.42);
    const blockH = barH + gap + headLines.length * lh + (supLines.length ? gap * 0.8 + supLines.length * slh : 0) + gap + barH;
    let yy = Math.max(H * 0.04, (H - blockH) / 2);
    x.textAlign = 'left'; x.textBaseline = 'middle';
    x.fillStyle = st.accent; x.fillRect(mx, yy, barW, barH);
    yy += barH + gap;
    x.fillStyle = inkColor; x.strokeStyle = 'rgba(0,0,0,.85)'; x.lineWidth = Math.max(6, W * 0.008); x.lineJoin = 'round';
    x.font = `900 ${headFs}px Poppins, Arial, sans-serif`;
    for (const ln of headLines) { x.strokeText(ln, mx, yy + lh / 2); x.fillText(ln, mx, yy + lh / 2); yy += lh; }
    if (supLines.length) {
      yy += gap * 0.8;
      x.font = `800 ${supFs}px Poppins, Arial, sans-serif`; x.lineWidth = Math.max(4, W * 0.005);
      for (const ln of supLines) { x.strokeText(ln, mx, yy + slh / 2); x.fillText(ln, mx, yy + slh / 2); yy += slh; }
    }
    yy += gap;
    x.fillStyle = st.accent; x.fillRect(mx, yy, barW, barH);
    return cv;
  }
  const varStyles = [
    { name: 'Bold Yellow', bg: ['#ffc81f', '#e3a500'], accent: '#e02c2c', pos: 'left', dir: 'explosive bright-yellow background, huge chunky lettering, high-energy viral YouTube style' },
    { name: 'Dark Neon', bg: ['#0b1026', '#23307a'], accent: '#4aa8ff', pos: 'right', dir: 'dark midnight-blue scene with glowing neon-blue rim light, futuristic gaming mood' },
    { name: 'Red Alert', bg: ['#3a0d0d', '#a8231b'], accent: '#ffe46b', pos: 'left', dir: 'dramatic deep-red background, urgent breaking-news energy, strong shadows' },
    { name: 'Clean Mint', bg: ['#06281a', '#157a45'], accent: '#ffe46b', pos: 'right', dir: 'fresh green gradient, clean modern minimal tech look, lots of breathing room' },
    { name: 'Purple Pop', bg: ['#2a0a4a', '#7b2ff7'], accent: '#ffe46b', pos: 'left', dir: 'vibrant purple gradient, playful pop-art energy, bold shapes' },
    { name: 'Mono Contrast', bg: ['#0a0a0a', '#2e2e2e'], accent: '#ffffff', pos: 'right', dir: 'stark black-and-white high-contrast minimal design, one bold accent' },
  ];
  // Redesign prompt: built ONLY from the written analysis (topic, exact text,
  // subject, direction). The uploaded image itself is never sent to the image
  // model, so every version is a genuinely new design.
  // Redesigner parity with the Creator: its own text style / colour
  // scheme / subject / version-count controls, wired into the prompts
  // exactly like the Creator's (values feed the brief batch + direct
  // prompts below; the version count trims the style list).
  let rTStyle = 'Bold outline', rScheme = 'Auto', rSubject = 'Auto', rVers = 6;
  const redesignPrompt = (st, i, text) => {
    const extra = (analysis?.directions || [])[i] || '';
    return `Design a COMPLETELY NEW, original YouTube thumbnail — invent a fresh composition and layout from scratch, full-frame artwork edge to edge. Do not copy, trace or reuse the layout of any existing thumbnail.
${analysis?.topic ? `Video topic: ${analysis.topic}.` : ''}
${analysis?.subject ? `Main subject to feature prominently: ${analysis.subject}.` : ''}
Art direction: ${st.dir}.${extra ? ` Creative direction: ${extra}.` : ''}
Text style: ${rTStyle}. Colour direction: ${rScheme === 'Auto' ? 'colours that fit the topic best' : rScheme}.${rSubject !== 'Auto' ? ` Main subject emphasis: ${rSubject}.` : ''}
The thumbnail must show this EXACT text, word for word, spelled exactly, in huge bold letters that dominate the design: "${text}"
High contrast, dramatic, instantly readable at small size, professional YouTube thumbnail style, no watermark.`;
  };
  // Designer briefs: before any image is generated, ONE text call writes a
  // proper graphic-designer brief for EVERY version at once (scene, subject,
  // palette, composition, text placement + hierarchy per style) from the
  // stored analysis, and the image model then designs to its brief. The old
  // flow spent one text call PER version — six calls before the first image
  // existed — which burned a free key's per-minute quota for nothing. One
  // batched call (on a lite model, via bulk) now does the whole set. Briefs
  // are cached per analysis + text, so regenerating versions redoes nothing.
  const briefCache = {}; // style name -> brief text
  // If the brief call fails or stalls once, briefs are skipped for the rest
  // of the run: a slow text call must never eat the time and quota the
  // actual image generation needs.
  let briefsBroken = false;
  let briefBatchFor = null; // analysis+text key the batched briefs were fetched for
  async function ensureBriefs(text) {
    const bk = `${text}|${analysis?.topic || ''}|${(analysis?.directions || []).join('~')}|${rTStyle}|${rScheme}|${rSubject}`;
    if (briefBatchFor === bk) return; // already attempted for this analysis + text + designer choices
    briefBatchFor = bk;
    try {
      const list = varStyles.map((st, i) => {
        const extra = (analysis?.directions || [])[i] || '';
        return `- "${st.name}": ${st.dir}${extra ? ` Creative direction: ${extra}.` : ''}`;
      }).join('\n');
      // Hard 30s ceiling on the one batch call: if it fails or stalls,
      // generation proceeds with the direct prompts instead.
      const d = await Promise.race([
        geminiJson(`You are a senior graphic designer. For EACH of the ${varStyles.length} versions below of a YouTube thumbnail for the same video, write a short DESIGNER BRIEF (5-7 lines, plain text, no headings, no bullet points inside a brief). Each brief must cover exactly: the scene/background, the main visual subject and how it is shown, the colour palette (name 3-4 colours), the composition/layout, and where the big text sits with its hierarchy (which words are biggest). Every design must be a completely new, original composition — never a copy of any existing thumbnail's layout.
Video topic: ${analysis?.topic || 'not specified'}
Main subject: ${analysis?.subject || 'the topic itself'}
Designer choices to apply in every brief: text style "${rTStyle}"; colour direction "${rScheme}";${rSubject !== 'Auto' ? ` main subject emphasis "${rSubject}";` : ''}
Exact text that will appear on every thumbnail: "${text}"
Versions:
${list}
Return JSON only, keyed by the exact version names: {${varStyles.map(st => `"${st.name}": "brief…"`).join(', ')}}`, { bulk: true, temperature: 0.7 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('brief timeout')), 30000)),
      ]);
      const briefs = parseBriefBatch(d, varStyles.map(st => st.name));
      if (!briefs) throw new Error('brief batch unreadable');
      for (const st of varStyles) if (briefs[st.name]) briefCache[st.name] = briefs[st.name];
    } catch { briefsBroken = true; } // one failure ends briefs for this run
  }
  async function versionPrompt(st, i, text) {
    if (!briefsBroken) {
      await ensureBriefs(text); // one batched call on the first version, then cache
      const brief = briefCache[st.name];
      if (brief) return `Design this YouTube thumbnail exactly to the following designer brief:\n${brief}\n\nThe thumbnail must show this EXACT text, word for word, spelled exactly, in huge bold letters that dominate the design: "${text}"\nProfessional YouTube thumbnail designed by a graphic designer — bold, high contrast, instantly readable at small size, full-frame original artwork edge to edge, no watermark.`;
    }
    return redesignPrompt(st, i, text); // the brief is an enhancement — never block generation
  }
  on('makevars', 'click', async (e) => {
    if (!requireKey()) return;
    const text = $('ttext').value.trim();
    if (!text) { toast('Write the thumbnail text first (analyse fills it automatically).', true); return; }
    const b = e.currentTarget; busy(b, true);
    const host = $('vars'); host.innerHTML = '';
    const prog = makeProgress($('varprog'), ['Writing designer briefs', 'Creating the versions', 'Ready']);
    // Snapshot the size ONCE for the whole run: canvas, labels, model
    // aspect and download names all read this snapshot, so the run can
    // never desync from the size the user picked.
    const size = snapSize();
    const { W, H } = size;
    const runStyles = varStyles.slice(0, rVers);
    const savedVers = [];
    let made = 0, designed = 0, prevErr = null;
    try {
      for (let i = 0; i < runStyles.length; i++) {
        if (i > 0) await breather(prevErr); // pacing between versions (longer after a limit hit)
        const st = runStyles[i];
        const card = document.createElement('div'); card.className = 'outcard';
        card.innerHTML = `<div class="spread"><b>Version ${i + 1} — ${st.name}</b><span class="tag y">${sizeTag(size)}</span></div><p class="small dim mt stline">Creating a brand-new design…</p>`;
        host.appendChild(card);
        const cv = document.createElement('canvas'); cv.className = 'thumbcv';
        let note = '';
        try {
          // Text-only generation: the uploaded thumbnail is NOT passed to the
          // image model — the new design comes from the analysis alone.
          // First a designer brief is written for this version (cached), so
          // the image model designs like a graphic designer, not a guesser.
          const stline = card.querySelector('.stline');
          if (stline) stline.textContent = i === 0 ? 'Writing the designer briefs (one call for all versions)…' : 'Creating a brand-new design…';
          if (i === 0) prog.setStep(0);
          const prompt = await versionPrompt(st, i, text);
          prog.setStep(1, `Creating version ${i + 1} of ${runStyles.length}`);
          if (stline) stline.textContent = 'Creating a brand-new design…';
          const url = await geminiImage(prompt, null, size.model, { onRetry: retryNote(b) });
          const img = await loadImg(url);
          cv.width = W; cv.height = H;
          const x = cv.getContext('2d');
          const sc = Math.max(W / img.width, H / img.height);
          x.drawImage(img, (W - img.width * sc) / 2, (H - img.height * sc) / 2, img.width * sc, img.height * sc);
          made++;
          prevErr = null;
        } catch (err) {
          prevErr = err;
          // Fallback — only after every image model was really tried, and
          // the card shows Google's REAL error, not a generic shrug.
          paintThumb(cv, st, text, size);
          designed++;
          note = `<p class="small dim mt">${esc(err.message)}<br>This version fell back to a designed background with your headline text.</p>`;
        }
        card.querySelector('.stline')?.remove();
        card.appendChild(cv);
        if (note) card.insertAdjacentHTML('beforeend', note);
        // Keep a small copy of each version so a refresh restores them
        // (JPEG keeps 6 versions light enough for browser storage).
        try { const small = cv.toDataURL('image/jpeg', 0.85); if (small.length < 700000) savedVers.push({ name: st.name, size: sizeTag(size), img: small }); } catch { /* canvas tainted — skip */ }
        const dl = document.createElement('button'); dl.className = 'btn sm mt'; dl.textContent = 'Download this version';
        dl.addEventListener('click', () => { const a = document.createElement('a'); a.download = `thumbnail-${size.id}-v${i + 1}.png`; a.href = cv.toDataURL('image/png'); a.click(); });
        card.appendChild(dl);
        prog.setFraction((i + 1) / runStyles.length);
      }
      if (savedVers.length) saveWork('thumbnail-rd', text, { text, vers: savedVers });
      prog.done();
    } finally {
      busy(b, false, 'Generate different versions');
    }
    toast(designed === 0
      ? `${runStyles.length} brand-new versions made — same text on all, at ${sizeTag(size)}.`
      : `${made} new AI versions + ${designed} designed versions made — same text on all, at ${sizeTag(size)}.`);
  });
  // Creator options: every chip below feeds the design prompt and/or the
  // canvas composition — text style changes how the headline is drawn,
  // scheme changes palette + fallback gradient + glow colour, background
  // style changes the art direction (game = real blur on the artwork),
  // subject directs the main visual, versions makes that many variants.
  let cTStyle = 'outline', cScheme = 'auto', cBg = 'auto', cSubject = 'auto', cVers = 1;
  const wireOpt = (boxId, attr, fn) => { const box = $(boxId); if (!box) return; box.querySelectorAll(`[data-${attr}]`).forEach(c => c.addEventListener('click', () => { box.querySelectorAll(`[data-${attr}]`).forEach(x => x.classList.toggle('on', x === c)); fn(c.dataset[attr]); })); };
  wireOpt('rg-tstyle', 'tstyle', v => cTStyle = v);
  wireOpt('rg-scheme', 'scheme', v => cScheme = v);
  wireOpt('rg-bgstyle', 'bgstyle', v => cBg = v);
  wireOpt('rg-subject', 'subject', v => cSubject = v);
  wireOpt('rg-vers', 'vers', v => cVers = Number(v));
  // Redesigner parity controls (its own state, set above near varStyles).
  wireOpt('rg-rtstyle', 'rtstyle', v => rTStyle = v);
  wireOpt('rg-rscheme', 'rscheme', v => rScheme = v);
  wireOpt('rg-rsubject', 'rsubject', v => rSubject = v);
  wireOpt('rg-rvers', 'rvers', v => rVers = Number(v));
  const SCHEMES = {
    auto: { name: 'Auto', grad: ['#23307a', '#0b1026'], glow: '#ffe46b', palette: 'colours that fit the topic best' },
    yellow: { name: 'Yellow-black', grad: ['#3a2f00', '#100c00'], glow: '#ffd94d', palette: 'electric yellow and black' },
    red: { name: 'Red-black', grad: ['#3d0a0a', '#120303'], glow: '#ff5b4f', palette: 'bold red and black' },
    blue: { name: 'Blue-white', grad: ['#0d2b4d', '#050f1d'], glow: '#4aa8ff', palette: 'clean blue and white' },
    green: { name: 'Green', grad: ['#07301c', '#03130a'], glow: '#35d685', palette: 'fresh green tones' },
    purple: { name: 'Purple', grad: ['#2c0a4d', '#10031f'], glow: '#b98cff', palette: 'rich purple tones' },
  };
  const BG_PHRASE = { auto: '', game: 'Background: a game scene with strong depth-of-field blur behind the subject.', gradient: 'Background: a smooth, bold colour gradient — no scene and no objects in the background.', studio: 'Background: a clean studio backdrop with soft professional lighting.' };
  const SUBJ_PHRASE = { auto: '', face: 'Main subject: one expressive human face in close-up, strong emotion.', character: 'Main subject: stylised character art (game/anime style), dynamic pose.', product: 'Main subject: one hero product or object, large and centred.', none: 'No people and no faces — objects, places and shapes only.' };
  const TSTYLE_NAMES = { outline: 'Bold outline', '3d': '3D pop', neon: 'Neon glow', minimal: 'Clean minimal' };
  const BG_NAMES = { auto: 'Auto background', game: 'Blurred game scene', gradient: 'Gradient', studio: 'Studio' };
  const SUBJ_NAMES = { auto: 'Auto subject', face: 'Face close-up', character: 'Character art', product: 'Product / object', none: 'No person' };
  const VAR_ANGLES = ['wide dramatic angle', 'close-up energy, subject large in frame', 'bold diagonal composition', 'clean centred composition'];
  function wrapLines(x, text, maxW) {
    const words = String(text).toUpperCase().split(/\s+/); const lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    return lines;
  }
  function composeThumb(bg, head, sub, size) {
    const { W, H } = size;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    const sch = SCHEMES[cScheme] || SCHEMES.auto;
    if (bg) {
      const sc = Math.max(W / bg.width, H / bg.height);
      if (cBg === 'game') { x.save(); x.filter = 'blur(6px)'; const s2 = sc * 1.07; x.drawImage(bg, (W - bg.width * s2) / 2, (H - bg.height * s2) / 2, bg.width * s2, bg.height * s2); x.restore(); }
      else x.drawImage(bg, (W - bg.width * sc) / 2, (H - bg.height * sc) / 2, bg.width * sc, bg.height * sc);
    } else { const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, sch.grad[0]); g.addColorStop(1, sch.grad[1]); x.fillStyle = g; x.fillRect(0, 0, W, H); }
    const sh = x.createLinearGradient(0, H * 0.42, 0, H); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.72)');
    x.fillStyle = sh; x.fillRect(0, 0, W, H);
    const drawStyled = (txt, fs, y) => {
      x.font = `${cTStyle === 'minimal' ? 800 : 900} ${fs}px Poppins, Arial, sans-serif`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      if (cTStyle === '3d') {
        x.fillStyle = 'rgba(0,0,0,.85)'; x.fillText(txt, W / 2 + fs * 0.07, y + fs * 0.07);
        x.fillStyle = sch.glow; x.fillText(txt, W / 2 + fs * 0.035, y + fs * 0.035);
        x.fillStyle = inkColor; x.fillText(txt, W / 2, y);
      } else if (cTStyle === 'neon') {
        x.save(); x.shadowColor = sch.glow; x.shadowBlur = fs * 0.55; x.fillStyle = inkColor;
        x.fillText(txt, W / 2, y); x.fillText(txt, W / 2, y); x.restore();
      } else if (cTStyle === 'minimal') {
        x.fillStyle = inkColor; x.fillText(txt, W / 2, y);
      } else {
        x.lineWidth = Math.max(6, fs * 0.16); x.strokeStyle = 'rgba(0,0,0,.9)'; x.lineJoin = 'round'; x.fillStyle = inkColor;
        x.strokeText(txt, W / 2, y); x.fillText(txt, W / 2, y);
      }
    };
    if (head) {
      const fs = Math.round(W * (head.length > 18 ? 0.07 : 0.088));
      x.font = `900 ${fs}px Poppins, Arial, sans-serif`;
      const lines = wrapLines(x, head, W * 0.92).slice(0, 3);
      const lh = fs * 1.12;
      const subFs = Math.round(fs * 0.42);
      const bottom = H - H * 0.055;
      if (sub) {
        x.font = `900 ${subFs}px Poppins, Arial, sans-serif`;
        const subLines = wrapLines(x, sub, W * 0.9).slice(0, 1);
        if (subLines.length) drawStyled(subLines[0], subFs, bottom - lines.length * lh - subFs * 0.85);
      }
      lines.forEach((ln, i) => drawStyled(ln, fs, bottom - (lines.length - i) * lh + lh / 2));
    }
    return cv;
  }
  // Creator: designer-brief-style prompt -> AI background -> styled headline
  // and sub-text composed at the exact ratio size, per chosen version count.
  on('cgo', 'click', async (e) => {
    if (!requireKey()) return;
    const prompt = $('cprompt').value.trim();
    let head = $('chead').value.trim();
    const sub = $('csub').value.trim();
    if (!prompt && !head) { toast('Describe the thumbnail or write its headline text.', true); return; }
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('cprog'), ['Writing the design', 'Creating the versions', 'Ready']);
    try {
      if (!head && prompt) {
        // Headline prefilled from the topic: one quick call writes it, and it
        // is put into the field so the student sees (and can edit) it.
        try {
          const h = (await geminiText(`Write a punchy YouTube thumbnail headline of 2-4 words, ALL CAPS, no quotes, no punctuation except !, for this video: ${prompt}`, { bulk: true, temperature: 0.8 })).replace(/["\n]/g, '').trim().slice(0, 42);
          if (h) { head = h; $('chead').value = h; }
        } catch { /* headline simply stays empty */ }
      }
      prog.setStep(1);
      // Same rule as the Redesigner: one size snapshot for the whole run.
      const size = snapSize();
      const sch = SCHEMES[cScheme] || SCHEMES.auto;
      out('cresult', '');
      const host = $('cresult');
      let madeAI = 0, lastBgErr = '', prevErr = null;
      const savedVers = [];
      for (let v = 0; v < cVers; v++) {
        if (v > 0) await breather(prevErr); // pacing between versions (longer after a limit hit)
        prog.setStep(1, cVers > 1 ? `Creating version ${v + 1} of ${cVers}` : 'Creating the thumbnail');
        let bg = null, bgErr = '';
        try {
          const url = await geminiImage(`YouTube thumbnail background art designed by a graphic designer. Scene: ${prompt || head}. Art style: ${$('cstyle').value}. Colour palette: ${sch.palette}. ${BG_PHRASE[cBg] || ''} ${SUBJ_PHRASE[cSubject] || ''}${cVers > 1 ? ` Composition: ${VAR_ANGLES[v % VAR_ANGLES.length]}.` : ''} Dramatic, high contrast, no text, no letters, no watermark.`, null, size.model, { onRetry: retryNote(b) });
          bg = await loadImg(url); madeAI++; prevErr = null;
        } catch (err) { bgErr = err.message; lastBgErr = bgErr; prevErr = err; /* designed-gradient fallback in composeThumb, real error shown on the card */ }
        const cv = composeThumb(bg, head, sub, size);
        try { const small = cv.toDataURL('image/jpeg', 0.85); if (small.length < 700000) savedVers.push({ name: cVers > 1 ? `Version ${v + 1}` : 'Your thumbnail', size: sizeTag(size), img: small }); } catch { /* skip */ }
        const card = document.createElement('div'); card.className = 'outcard';
        card.innerHTML = `<div class="spread"><b>${cVers > 1 ? `Version ${v + 1}` : 'Your thumbnail'}</b><span class="tag y">${sizeTag(size)}</span></div><p class="small dim mt">${esc(TSTYLE_NAMES[cTStyle])} text · ${esc(sch.name)} scheme · ${esc(BG_NAMES[cBg])} · ${esc(SUBJ_NAMES[cSubject])}${bg ? '' : ' · designed background'}</p>${bg ? '' : `<p class="small dim mt">${esc(bgErr)}</p>`}`;
        cv.className = 'thumbcv'; card.appendChild(cv);
        const dl = document.createElement('button'); dl.className = 'btn sm mt'; dl.textContent = 'Download thumbnail (PNG)';
        dl.addEventListener('click', () => { const a = document.createElement('a'); a.download = `thumbnail-${size.id}${cVers > 1 ? `-v${v + 1}` : ''}.png`; a.href = cv.toDataURL('image/png'); a.click(); });
        card.appendChild(dl); host.appendChild(card);
        prog.setFraction((v + 1) / cVers);
      }
      if (savedVers.length) saveWork('thumbnail', head || prompt || 'Thumbnail', { text: head || prompt, vers: savedVers });
      prog.done();
      toast(madeAI ? `${cVers} thumbnail version${cVers > 1 ? 's' : ''} made at ${sizeTag(size)} — same design choices on each.` : (lastBgErr || 'The image model did not answer.'), !madeAI);
    } catch (err) { prog.fail(err.message); toast(err.message, true); }
    busy(b, false, 'Create thumbnail');
  });
  // Restore the last Creator + Redesigner versions made on this device.
  const paintSavedVers = (host, w, heading) => {
    if (!host || !w || !(w.payload.vers || []).length) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `<p class="small dim mt">Restored — ${heading} (${new Date(w.t).toLocaleString()}). Small copies are kept on this device; download again from a fresh run for full size.</p>` + w.payload.vers.map(v2 => `<div class="outcard"><div class="spread"><b>${esc(v2.name)}</b><span class="tag y">${esc(v2.size || '')}</span></div><img class="thumbcv" src="${v2.img}" alt=""><button class="btn sm mt" data-dl="${esc(v2.name)}">Download this version</button></div>`).join('');
    wrap.querySelectorAll('[data-dl]').forEach(btn => btn.addEventListener('click', () => { const v2 = w.payload.vers.find(x => x.name === btn.dataset.dl); if (v2) { const a = document.createElement('a'); a.download = `thumbnail-restored-${v2.name.replace(/\W+/g, '-').toLowerCase()}.jpg`; a.href = v2.img; a.click(); } }));
    host.appendChild(wrap);
  };
  paintSavedVers($('cresult'), workFor('thumbnail'), 'your last Creator thumbnails');
  paintSavedVers($('vars'), workFor('thumbnail-rd'), 'your last Redesigner versions');
}

/* ---------- Upload Your Own Video / Lecture Clips (shared video handling) ---------- */
if (tool === 'upload' || tool === 'lecture-clips') {
  let dur = 0, vidFile = null;
  const v = $('vid');
  on('vfile', 'change', (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    vidFile = f;
    v.src = URL.createObjectURL(f); $('stage').classList.remove('hidden');
  });
  v.addEventListener('loadedmetadata', () => {
    dur = v.duration || 0;
    $('in').max = Math.max(1, Math.floor(dur)); $('out').max = Math.max(1, Math.floor(dur)); $('out').value = Math.floor(dur);
    $('dur').textContent = `Length: ${fmt(dur)} · drag the sliders to choose your clip`;
    upd();
  });
  const upd = () => { $('inv').textContent = fmt(Number($('in').value)); $('outv').textContent = fmt(Number($('out').value)); };
  on('in', 'input', () => { if (Number($('in').value) > Number($('out').value) - 3) $('in').value = Number($('out').value) - 3; v.currentTime = Number($('in').value); upd(); });
  on('out', 'input', () => { if (Number($('out').value) < Number($('in').value) + 3) $('out').value = Number($('in').value) + 3; upd(); });
  on('playseg', 'click', () => { v.currentTime = Number($('in').value); v.play(); });
  v.addEventListener('timeupdate', () => { if (v.currentTime >= Number($('out').value)) v.pause(); });
  function pickRecorderMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    for (const m of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) if (MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }
  // Caption burn-in toggle (Upload page; absent on Lecture Clips — guarded).
  const capSwitch = $('capon');
  if (capSwitch) capSwitch.addEventListener('click', () => capSwitch.classList.toggle('on'));
  // In-browser export: the chosen segment is drawn onto a canvas at the
  // chosen quality and recorded in real time to WebM. Vertical exports use
  // the exact quality dimensions (1080p 1080×1920, 720p 720×1280, 480p
  // 480×854); original shape is scaled to the quality height, never upscaled.
  const QUALITY_H = { '1080p': 1080, '720p': 720, '480p': 480 };
  const QUALITY_V = { '1080p': [1080, 1920], '720p': [720, 1280], '480p': [480, 854] };
  function drawCaption(x, W, H) {
    const sw = $('capon');
    if (!sw || !sw.classList.contains('on')) return;
    const text = ($('captext')?.value || '').trim();
    if (!text) return;
    const style = $('capstyle') ? $('capstyle').value : 'Bold bottom';
    const fs = Math.round(H * 0.042);
    x.save();
    x.font = `900 ${fs}px Poppins, Arial, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    // word-wrap to at most 2 lines
    const words = text.split(/\s+/); const lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > W * 0.88 && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    const use = lines.slice(0, 2), lh = fs * 1.25;
    if (style === 'Top banner') {
      const bh = lh * use.length + fs * 0.7;
      x.fillStyle = '#ffc81f'; x.fillRect(0, 0, W, bh);
      x.fillStyle = '#17130a';
      use.forEach((ln, i) => x.fillText(ln, W / 2, bh / 2 + (i - (use.length - 1) / 2) * lh));
    } else if (style === 'Box') {
      const bw = Math.max(...use.map(ln => x.measureText(ln).width)) + fs * 1.1;
      const bh = lh * use.length + fs * 0.55;
      x.fillStyle = 'rgba(0,0,0,.78)';
      x.beginPath(); x.roundRect((W - bw) / 2, H - bh - H * 0.045, bw, bh, 12); x.fill();
      x.fillStyle = '#fff';
      use.forEach((ln, i) => x.fillText(ln, W / 2, H - bh - H * 0.045 + bh / 2 + (i - (use.length - 1) / 2) * lh));
    } else {
      x.lineWidth = Math.max(4, fs * 0.18); x.strokeStyle = 'rgba(0,0,0,.9)'; x.lineJoin = 'round'; x.fillStyle = '#fff';
      use.forEach((ln, i) => { const y = H * 0.93 - (use.length - 1 - i) * lh; x.strokeText(ln, W / 2, y); x.fillText(ln, W / 2, y); });
    }
    x.restore();
  }
  on('export', 'click', async () => {
    if (!v.src) { toast('Upload a video first.', true); return; }
    const mime = pickRecorderMime();
    if (mime === null) { toast('This browser cannot export in-page. Use Chrome on Android/desktop.', true); return; }
    const vertical = $('fmt') && $('fmt').value === 'vertical';
    const q = ($('quality') && $('quality').value) || '1080p';
    const b = $('export'); busy(b, true, 'Export clip (WebM)');
    try {
      let W, H;
      if (vertical) { [W, H] = QUALITY_V[q] || QUALITY_V['1080p']; }
      else {
        const sc = Math.min(1, (QUALITY_H[q] || 1080) / (v.videoHeight || 1080));
        W = Math.max(2, Math.round(v.videoWidth * sc) & ~1); H = Math.max(2, Math.round(v.videoHeight * sc) & ~1);
      }
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      if (!cv.captureStream) { toast('This browser cannot export in-page. Use Chrome on Android/desktop.', true); busy(b, false, 'Export clip (WebM)'); return; }
      const cx = cv.getContext('2d');
      let raf = 0;
      const draw = () => {
        if (vertical) { const sc = Math.max(W / v.videoWidth, H / v.videoHeight); cx.fillStyle = '#000'; cx.fillRect(0, 0, W, H); cx.drawImage(v, (W - v.videoWidth * sc) / 2, (H - v.videoHeight * sc) / 2, v.videoWidth * sc, v.videoHeight * sc); }
        else cx.drawImage(v, 0, 0, W, H);
        drawCaption(cx, W, H);
        raf = requestAnimationFrame(draw);
      };
      draw();
      const stream = cv.captureStream(30);
      if (v.captureStream) v.captureStream().getAudioTracks().forEach(t => stream.addTrack(t));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      rec.ondataavailable = (x) => chunks.push(x.data);
      const done = new Promise(r => rec.onstop = r);
      // Live progress + Cancel: the export records in real time, so the
      // user watches it count and can abandon a wrong trim without
      // waiting out the whole segment (the partial file is discarded).
      const progEl = $('exprog'); const cancelBtn = $('excancel');
      let cancelled = false;
      const segStart = Number($('in').value), segLen = Math.max(1, Number($('out').value) - segStart);
      if (cancelBtn) { cancelBtn.classList.remove('hidden'); cancelBtn.onclick = () => { cancelled = true; }; }
      v.currentTime = segStart;
      await v.play(); rec.start(250);
      const stopAt = Number($('out').value);
      await new Promise(r => { const iv = setInterval(() => { if (progEl) progEl.textContent = `Recording your clip… ${fmt(Math.max(0, v.currentTime - segStart))} of ${fmt(segLen)} — keep this tab open`; if (cancelled || v.currentTime >= stopAt || v.paused) { clearInterval(iv); r(); } }, 200); });
      v.pause(); rec.stop(); await done;
      cancelAnimationFrame(raf);
      if (cancelBtn) cancelBtn.classList.add('hidden');
      if (progEl) progEl.textContent = '';
      if (cancelled) { toast('Export cancelled — nothing was saved.'); busy(b, false, 'Export clip (WebM)'); return; }
      const name = ($('ctitle')?.value.trim() || 'streamclip-clip').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'streamclip-clip';
      download(`${name}.webm`, new Blob(chunks, { type: 'video/webm' }));
      saveShort(($('ctitle')?.value.trim() || name), v, tool === 'lecture-clips' ? 'lecture-clips' : 'upload-video');
      toast(`Clip exported as WebM at ${W}×${H} (${q}).`);
    } catch (err) { toast('Export failed: ' + err.message, true); }
    busy(b, false, 'Export clip (WebM)');
  });

  // AI watch: Gemini watches the uploaded file itself (small files only).
  on('watch', 'click', async (e) => {
    if (!requireKey()) return;
    if (!vidFile) { toast('Upload the video first.', true); return; }
    if (vidFile.size > 18 * 1024 * 1024) { toast('This file is over ~18 MB — too big to send to Gemini from the browser. Use the transcript finder below, or trim a shorter copy first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const part = await fileToInline(vidFile);
      const isLecture = tool === 'lecture-clips';
      const d = await geminiPartsJson([part, { text: isLecture
        ? `Watch this lecture video. Find the key concepts a student must revise. Return JSON only: {"items":[{"title":"concept name","startSec":0,"endSec":0,"why":"one line: why it matters for the exam","hook":"3-6 word memory hook"}]} Up to 8 concepts, in teaching order. Times in seconds from the video start; each concept 30-60 seconds.`
        : `Watch this video. Pick the best moments for short vertical clips. Return JSON only: {"items":[{"title":"catchy clip title","startSec":0,"endSec":0,"why":"one line: why this moment works","hook":"3-7 punchy words"}]} Up to 8 moments, best first. Times in seconds from the video start; each moment 15-60 seconds.` }], { temperature: 0.4, timeoutMs: 240000, onRetry: retryNote(b) });
      renderPlan(d.items || [], true);
      toast('Gemini watched your video and marked the moments.');
    } catch (err) { toast('AI watch failed: ' + err.message, true); }
    busy(b, false, tool === 'lecture-clips' ? 'Watch & find concepts' : 'Watch & find moments');
  });
  // AI plan from a pasted transcript (moments / lecture concepts)
  on('plan', 'click', async (e) => {
    if (!requireKey()) return;
    const text = $('transcript').value.trim();
    if (text.length < 120) { toast('Paste a longer transcript so the AI has something to work with.', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const isLecture = tool === 'lecture-clips';
      const focus = $('focus') ? ` Focus on: ${$('focus').value}.` : '';
      const d = await geminiJson(isLecture
        ? `From this lecture transcript, find the key concepts a student must revise.${focus} Return JSON only: {"items":[{"title":"concept name","at":"timestamp or '—' if none in text","why":"one line: why it matters for the exam","hook":"3-6 word memory hook"}]} Give up to 8 items, in teaching order. Transcript:\n${text.slice(0, 30000)}`
        : `From this video transcript, pick the best moments for short clips. Return JSON only: {"items":[{"title":"catchy clip title","at":"timestamp or '—' if none in text","why":"one line: why this moment works","hook":"3-7 punchy words"}]} Give up to 8 moments, best first. Transcript:\n${text.slice(0, 30000)}`, { onRetry: retryNote(b) });
      renderPlan(d.items || [], false);
    } catch (err) { toast(err.message, true); }
    busy(b, false, tool === 'lecture-clips' ? 'Find key concepts' : 'Find best moments');
  });
  function renderPlan(items, fromWatch) {
    out('planresult', items.map((m, i) => {
      const s = fromWatch ? Number(m.startSec) : parseTs(m.at);
      const en = fromWatch ? Number(m.endSec) : null;
      const canSet = s !== null && !Number.isNaN(s) && dur > 0;
      return `<div class="outcard"><b>${i + 1}. ${esc(m.title)}</b>
        <p class="small dim mt">At: ${esc(fromWatch ? `${fmt(s || 0)} – ${fmt(en || 0)}` : (m.at || '—'))} · ${esc(m.why || '')}</p>
        <p class="mt"><span class="tag y">Hook</span> ${esc(m.hook || '')}</p>
        ${canSet ? `<button class="btn dark sm mt" data-set="${i}" data-s="${s}" data-e="${en || ''}">Set the trim to this ${tool === 'lecture-clips' ? 'concept' : 'moment'}</button>` : ''}</div>`;
    }).join('') || '<div class="outcard">No strong moments found. Try a longer transcript.</div>');
    document.querySelectorAll('[data-set]').forEach(btn => btn.addEventListener('click', () => {
      const s = Number(btn.dataset.s); const en = Number(btn.dataset.e) || Math.min(dur, s + (tool === 'lecture-clips' ? 45 : 30));
      $('in').value = Math.max(0, Math.floor(s)); $('out').value = Math.max(Number($('in').value) + 3, Math.floor(en));
      upd(); v.currentTime = s;
      toast('Trim set — press Play this part to check it, then Export.');
      window.scrollTo({ top: $('stage').offsetTop - 80, behavior: 'smooth' });
    }));
    if (tool === 'lecture-clips' && items.length) saveWork('lecture-clips', 'Revision concepts', { type: fromWatch ? 'watch' : 'transcript', items });
  }
  // Lecture Clips: restore the last concept list made on this device.
  if (tool === 'lecture-clips') {
    const savedLc = workFor('lecture-clips');
    if (savedLc && savedLc.payload && (savedLc.payload.items || []).length) renderPlan(savedLc.payload.items, savedLc.payload.type === 'watch');
  }
}

/* ---------- Stream Clipper ---------- */
if (tool === 'clipper') {
  let mode = 'yt';
  let found = []; // {startSec, endSec, startLabel, score, title, hook, why, picked, brief?}
  let editorHandle = null;
  // Stream / scan state
  let videoId = '', streamTitle = '', streamChannel = '', isLive = false, liveViewers = null, handoffId = '';
  let durationSec = 0, probedId = '';
  let scanRange = 'whole', shortLen = 45, pickCount = 3, voiceMode = 'none', quality = '1080p';
  let scannedRanges = [], scannedUrl = '';
  // Earn mode (Rewards-style: 1-min+ moments + per-video used memory) and
  // Cut the pauses (silences inside a moment noted as cut points).
  let earnMode = false, cutPauses = false;

  const ytId = (u) => { const m = String(u || '').match(/(?:youtube\.com\/(?:watch\?[^#]*v=|live\/|shorts\/)|youtu\.be\/)([\w-]{6,})/); return m ? m[1] : ''; };
  const fmtWatching = (n) => {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 'Live now';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M watching`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K watching`;
    return `${n} watching`;
  };
  const hosts = () => mode === 'yt' ? ['ytmoments', 'ytsummary', 'ytmake'] : ['txmoments', 'txsummary', 'txmake'];
  const CAP_NAMES = { bold: 'Bold', box: 'Box', yellow: 'Yellow', mint: 'Mint', poppins: 'Poppins', montserrat: 'Montserrat', anton: 'Anton', luckiest: 'Luckiest', bebas: 'Bebas' };

  const setMode = (m) => {
    mode = m;
    $('mode-yt').classList.toggle('on', m === 'yt');
    $('mode-tx').classList.toggle('on', m === 'tx');
    $('panel-yt').classList.toggle('hidden', m !== 'yt');
    $('panel-tx').classList.toggle('hidden', m !== 'tx');
  };
  on('mode-yt', 'click', () => setMode('yt'));
  on('mode-tx', 'click', () => setMode('tx'));
  on('cmin', 'input', () => { $('cminv').textContent = $('cmin').value; });
  on('tmin', 'input', () => { $('tminv').textContent = $('tmin').value; });

  /* ----- setup panel (app-style scan setup) ----- */
  function updateCalls() {
    const el = $('scancalls'); if (!el) return;
    const n = scanRange === 'whole'
      ? (durationSec > 0 ? Math.ceil(Math.min(durationSec, 4 * 3600) / 600) : '—')
      : Number(scanRange) / 600;
    el.textContent = `About ${n} Gemini calls.`;
  }
  async function probeSetup(url, id) {
    if (probedId === id) return;
    probedId = id;
    const pr = $('sc-probe');
    if (pr) pr.textContent = 'Checking the video with Gemini…';
    try {
      const p = await geminiYouTubeJson(url, 'Return JSON only: {"durationSec": 0, "title": ""} — durationSec is the total length of this video in seconds (a number), title is its title. If you truly cannot tell the length, use 0.', { timeoutMs: 120000 });
      if (videoId !== id) return;
      durationSec = Number(p.durationSec) || 0;
      if (p.title && !streamTitle) { streamTitle = p.title; $('sc-title').textContent = streamTitle; }
      if (pr) pr.textContent = durationSec ? `Video length: ${fmt(durationSec)}` : '';
      updateCalls();
    } catch { if (pr) pr.textContent = ''; }
  }
  function showSetup() {
    const url = $('slink').value.trim();
    const id = ytId(url);
    if (!id) { $('setupcard').classList.add('hidden'); return; }
    const changed = id !== videoId;
    videoId = id;
    if (id !== handoffId && changed) { isLive = false; liveViewers = null; streamTitle = ''; streamChannel = ''; durationSec = 0; probedId = ''; }
    $('setupcard').classList.remove('hidden');
    $('sc-thumb').style.backgroundImage = `url("https://i.ytimg.com/vi/${id}/mqdefault.jpg")`;
    $('sc-live').classList.toggle('hidden', !isLive);
    $('sc-title').textContent = streamTitle || 'YouTube video';
    $('sc-channel').textContent = streamChannel || '';
    $('sc-meta').textContent = liveViewers != null ? fmtWatching(liveViewers) : (isLive ? 'Live now' : '');
    updateCalls();
    if (changed && hasKey()) probeSetup(url, id);
  }
  on('slink', 'change', showSetup);
  on('slink', 'paste', () => setTimeout(showSetup, 60));

  function wireChips(boxId, attr, fn) {
    const box = $(boxId); if (!box) return;
    box.querySelectorAll(`[data-${attr}]`).forEach(c => c.addEventListener('click', () => {
      box.querySelectorAll(`[data-${attr}]`).forEach(x => x.classList.toggle('on', x === c));
      fn(c.dataset[attr]);
    }));
  }
  wireChips('rg-range', 'range', v => { scanRange = v; updateCalls(); });
  wireChips('rg-len', 'len', v => { shortLen = Number(v); });
  wireChips('rg-count', 'count', v => { pickCount = Number(v); });
  wireChips('rg-voice', 'voice', v => { voiceMode = v; if (found.length) renderFound(); });
  wireChips('rg-quality', 'q', v => { quality = v; if (found.length) renderFound(); });
  wireChips('rg-goal', 'goal', v => {
    earnMode = v === 'earn';
    const en = $('earnnote'); if (en) en.classList.toggle('hidden', !earnMode);
    if (found.length) renderFound();
  });
  on('cpauses', 'change', () => { cutPauses = $('cpauses').checked; });

  /* ----- used-moments memory (Earn mode) -----
   * Per-video record, on this device only, of the moments already planned
   * from a video — so a rescan never re-suggests the same part twice.
   * A moment counts as used when it overlaps a planned range. */
  const USED_LS = 'sc_used_moments_v1';
  function loadUsed() { try { const o = JSON.parse(localStorage.getItem(USED_LS) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } }
  function usedAt(id, s, e) {
    if (!id || s == null) return false;
    const list = loadUsed()[id] || [];
    return list.some(([a, b2]) => s < b2 && (e == null || e > a));
  }
  function markUsed(picks) {
    if (!videoId) return;
    const all = loadUsed();
    const list = all[videoId] || [];
    for (const m of picks) if (m.startSec != null) list.push([Math.floor(m.startSec), Math.ceil(m.endSec != null ? m.endSec : m.startSec + 30)]);
    all[videoId] = list.slice(-200);
    try { localStorage.setItem(USED_LS, JSON.stringify(all)); } catch { /* storage full/blocked — the memory is a nicety, not a promise */ }
  }

  // Handoff: a stream link from the home hero or a Live Now card arrives as a
  // query param and/or a one-shot localStorage note (which can also carry the
  // stream's title/channel/live state from /api/live) — land it in the field.
  try {
    const qs = new URLSearchParams(location.search);
    let ho = {};
    try { ho = JSON.parse(localStorage.getItem('sc_handoff_v1') || '{}'); } catch {}
    const hLink = qs.get('link') || ho.link || '';
    localStorage.removeItem('sc_handoff_v1');
    if (hLink) {
      if (ho.title) streamTitle = ho.title;
      if (ho.channel) streamChannel = ho.channel;
      if (ho.live) isLive = true;
      if (typeof ho.viewers === 'number') liveViewers = ho.viewers;
      handoffId = ytId(hLink);
      $('slink').value = hLink;
      showSetup();
      toast('Link carried over — set up your scan, then tap Start scanning.');
    }
  } catch {}

  /* ----- results (app-style "Best moments") ----- */
  function timeLine(m) {
    if (m.startSec != null && m.endSec != null) return `${fmt(m.startSec)} to ${fmt(m.endSec)} · ${Math.max(1, Math.round(m.endSec - m.startSec))}s`;
    return m.startLabel || '—';
  }
  function watchUrl(m) {
    if (!videoId || m.startSec == null) return '';
    return `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(m.startSec))}s`;
  }
  function momentCard(m, i) {
    const wu = watchUrl(m);
    return `<div class="outcard moment"><div><span class="time">${esc(timeLine(m))}</span><h3>${esc(m.title)}</h3></div>
      <div class="score${m.score < 70 ? ' mid' : ''}">${esc(String(m.score))}</div>
      <p class="why">${esc(m.why || '')}</p>
      <p class="why"><span class="tag y">Hook</span> ${esc(m.hook || '')}</p>
      ${mode === 'yt' && usedAt(videoId, m.startSec, m.endSec) ? `<p class="why"><span class="tag">Used in an earlier plan</span> — this part of the video is in your used-moments memory, so it is not pre-picked again.</p>` : ''}
      ${(m.pauses && m.pauses.length) ? `<p class="why"><span class="tag y">Pauses to cut</span> ${m.pauses.map(p => `${fmt(p.startSec)}–${fmt(p.endSec)}`).join(', ')}</p>` : ''}
      ${wu ? `<p class="why"><a href="${wu}" target="_blank" rel="noopener">▶ Watch this scene</a> — verify it in the stream at ${esc(fmt(m.startSec))}.</p>` : ''}
      <div class="acts"><button class="chip pickbtn${m.picked ? ' on' : ''}" data-pick="${i}">${m.picked ? '✓ Picked' : 'Pick'}</button>${m.picked ? `<button class="chip" data-edit="${i}">Open editor</button>` : ''}${voiceMode !== 'none' && m.picked ? `<button class="chip" data-voice="${i}">${voiceMode === 'hook' ? 'Make hook voice' : 'Make story voice'}</button>` : ''}</div>
      ${m.voiceScript ? `<p class="why"><b>Voice line:</b> ${esc(m.voiceScript)}</p>` : ''}
      ${m.voiceUrl ? `<audio controls src="${m.voiceUrl}" style="width:100%;grid-column:1/-1"></audio>` : ''}
      </div>`;
  }
  function renderFound() {
    const [hostId, summaryId] = hosts();
    const host = $(hostId);
    host.innerHTML = found.map((m, i) => momentCard(m, i)).join('');
    host.querySelectorAll('[data-pick]').forEach(btn => btn.addEventListener('click', () => { const m = found[Number(btn.dataset.pick)]; m.picked = !m.picked; renderFound(); }));
    host.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => { const m = found[Number(btn.dataset.edit)]; if (m && editorHandle) editorHandle.open(m); }));
    host.querySelectorAll('[data-voice]').forEach(btn => btn.addEventListener('click', () => genVoice(found[Number(btn.dataset.voice)])));
    const sm = $(summaryId);
    if (sm) sm.innerHTML = found.length ? `<div class="spread mt2"><h2>Best moments</h2><span class="tag y">${found.length} found</span></div>${mode === 'yt' ? '<button class="btn dark block mt" id="scannewest">⟳ Scan the newest part</button>' : ''}` : '';
    const sn = $('scannewest');
    if (sn) sn.addEventListener('click', scanNewest);
    renderMake();
  }
  function renderMake() {
    const [, , makeId] = hosts();
    const host = $(makeId); if (!host) return;
    const picks = found.filter(m => m.picked);
    host.innerHTML = found.length ? `<button class="btn block big mt" id="makebtn">✦ Make ${picks.length} shorts</button><div id="briefhost"></div>` : '';
    const mb = $('makebtn');
    if (mb) mb.addEventListener('click', renderBrief);
  }
  function momentBrief(m) {
    const b = m.brief || {};
    return {
      title: b.topTitle || m.title,
      time: timeLine(m), score: m.score, watch: watchUrl(m),
      quality,
      hook: b.hookText || m.hook || '',
      cut: (b.cutStart != null && b.cutEnd != null) ? `${fmt(b.cutStart)} – ${fmt(b.cutEnd)}` : timeLine(m),
      pauses: (m.pauses || []).map(p => `${fmt(p.startSec)}–${fmt(p.endSec)}`).join(', '),
      frame: b.frameMode ? `${b.frameMode === 'fill' ? 'Fill the screen' : 'Show all, blurred sides'} · zoom ${Number(b.zoom || 1).toFixed(2)}x · position ${b.fx != null ? b.fx : 50}% / ${b.fy != null ? b.fy : 50}%` : 'Show all, blurred sides (default)',
      captions: b.capOn === false ? 'Off' : `${CAP_NAMES[b.capStyle] || 'Bold'} · ${CAP_NAMES[b.capFont] || 'Poppins'} · ${b.capSize || 100}%`,
      voice: m.voiceScript || b.voiceText || 'None',
      voiceVolumes: `voice ${b.vvol != null ? b.vvol : 100}% · stream ${b.svol != null ? b.svol : 100}%`,
      music: b.musicName || 'None',
      topText: b.topOn === false ? 'Off' : (b.topText || '(not set)'),
      postCaption: b.postCaption || '',
      overlays: (b.overlays || []).map(o => `${o.kind} at ${Math.round(o.x)}%, ${Math.round(o.y)}% · ${Math.round(o.w)}% × ${Math.round(o.h)}%${o.kind === 'text' ? ` "${o.text || ''}"` : ''}`),
    };
  }
  function briefText(picks) {
    const head = `# StreamClip AI — shorts production plan\nThis is the production plan for your shorts — not a video file. The Watch links open each scene on YouTube.\n\n`;
    return head + picks.map((m, i) => {
      const br = momentBrief(m);
      return `## Short ${i + 1}: ${br.title}\n- Time: ${br.time} (score ${br.score})\n- Quality: ${br.quality}\n- Watch this scene: ${br.watch || '—'}\n- Cut: ${br.cut}${br.pauses ? `\n- Pauses to cut: ${br.pauses}` : ''}\n- Hook: ${br.hook || '—'}\n- Frame: ${br.frame}\n- Captions: ${br.captions}\n- Voice: ${br.voice} (${br.voiceVolumes})\n- Music: ${br.music}\n- Top text: ${br.topText}\n- Overlays: ${br.overlays.join('; ') || 'none'}\n- Posting caption: ${br.postCaption || '—'}`;
    }).join('\n\n');
  }
  function renderBrief() {
    const host0 = $('briefhost'); if (!host0) return;
    const picks0 = found.filter(m => m.picked);
    if (!picks0.length) { host0.innerHTML = '<div class="outcard mt"><b>No moments picked.</b><p class="small dim mt">Pick at least one moment above first.</p></div>'; return; }
    // Planned moments enter the used-moments memory (this device, per
    // video): a later scan of the same video will tag them instead of
    // pre-picking them again. Re-render first so the cards show the tag,
    // then fill the fresh brief host.
    markUsed(picks0);
    renderFound();
    const host = $('briefhost'); if (!host) return;
    const picks = found.filter(m => m.picked);
    host.innerHTML = `<h3 class="mt2">Your shorts plan — ${picks.length} picked</h3>` + picks.map((m) => {
      const br = momentBrief(m);
      return `<div class="outcard"><div class="spread"><b>${esc(br.title)}</b><span class="tag y">${esc(br.time)}</span></div>
      <p class="small dim mt">Score ${br.score}${br.watch ? ` · <a href="${br.watch}" target="_blank" rel="noopener">▶ Watch this scene</a>` : ''}</p>
      <p class="small mt"><b>Cut:</b> ${esc(br.cut)}<br>${br.pauses ? `<b>Pauses to cut:</b> ${esc(br.pauses)}<br>` : ''}<b>Quality:</b> ${esc(br.quality)}<br><b>Hook:</b> ${esc(br.hook || '—')}<br><b>Frame:</b> ${esc(br.frame)}<br><b>Captions:</b> ${esc(br.captions)}<br><b>Voice:</b> ${esc(br.voice)} (${esc(br.voiceVolumes)})<br><b>Music:</b> ${esc(br.music)}<br><b>Top text:</b> ${esc(br.topText)}${br.overlays.length ? `<br><b>Overlays:</b> ${esc(br.overlays.join('; '))}` : ''}${br.postCaption ? `<br><b>Posting caption:</b> ${esc(br.postCaption)}` : ''}</p>
      <button class="chip mt" data-editb="${found.indexOf(m)}">Open editor</button></div>`;
    }).join('') +
      `<div class="note mt"><div><b>Render queue.</b><div class="small dim">These briefs are saved for the render engine — the final downloadable videos are queued, not rendered here, because this website does not run a render engine yet. Nothing above fakes a finished file.</div><div class="small dim mt">This is the production plan for your shorts — not a video file. The Watch links open each scene on YouTube.</div></div></div>
      <div class="btns two mt"><button class="btn sm" id="copybrief">Copy brief</button><button class="btn dark sm" id="dlbrief">Download plan (.md)</button></div>`;
    host.querySelectorAll('[data-editb]').forEach(btn => btn.addEventListener('click', () => { const m = found[Number(btn.dataset.editb)]; if (m && editorHandle) editorHandle.open(m); }));
    on('copybrief', 'click', () => copyText(briefText(picks), 'Brief copied.'));
    on('dlbrief', 'click', () => download('streamclip-brief.md', briefText(picks), 'text/markdown'));
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function finishPick(count, minScore) {
    found.sort((a, b) => b.score - a.score);
    let n = 0;
    for (const m of found) {
      // Earn mode (YouTube scans): only 1-min+ moments, and never a moment
      // already planned from this video — the used-moments memory.
      const earnOk = !(earnMode && mode === 'yt') || ((m.endSec == null || m.endSec - m.startSec >= 61) && !usedAt(videoId, m.startSec, m.endSec));
      m.picked = earnOk && m.score >= minScore && n < count;
      if (m.picked) n++;
    }
  }
  async function genVoice(m) {
    if (!m || !requireKey()) return;
    try {
      toast('Making the AI voice…');
      if (!m.voiceScript) {
        m.voiceScript = await geminiText(voiceMode === 'hook'
          ? `Write ONE punchy spoken hook line (max 12 words) for a short clip titled "${m.title}". What happens: ${m.why || ''}. Return only the line, no quotes.`
          : `Write a short spoken narration (2-3 sentences, max 45 words) telling the story of this clip moment for a vertical short. Title: "${m.title}". What happens: ${m.why || ''}. Return only the narration.`, { temperature: 0.7 });
      }
      const blob = await geminiTTS(m.voiceScript, 'Kore');
      m.voiceUrl = URL.createObjectURL(blob);
      toast('Voice made — press play on the card.');
    } catch (err) { toast('Voice failed: ' + err.message, true); }
    renderFound();
  }
  // ONE progress system: the ring only. Retry notes and window updates
  // write into the ring's current step (activeProg/curStep), never a
  // second step list.
  let activeProg = null, curStep = 0;
  const scanRetry = () => (info) => { if (activeProg) activeProg.setStep(curStep, retryMsg(info)); };
  const PROBE_PROMPT = 'Return JSON only: {"durationSec": 0, "title": ""} — durationSec is the total length of this video in seconds (a number), title is its title. If you truly cannot tell the length, use 0.';
  function saveClipWork() {
    if (!found.length) return;
    saveWork('clipper', streamTitle || 'Stream Clipper scan', {
      mode, videoId, streamTitle, durationSec, quality, voiceMode,
      found: found.map(m => ({ ...m, voiceUrl: undefined })),
    });
  }

  /* ----- YouTube scan: Gemini watches the video in time windows ----- */
  async function scanWindow(url, s, en) {
    const niche = $('cniche').value, style = $('cstyle').value;
    return geminiYouTubeJson(url, `You are a top stream clipper. Watch ONLY the segment of this video you were given (it starts at ${fmt(s)} of the full video). Niche: ${niche}. Clip style: ${style}. ${earnMode ? 'EARN MODE: return ONLY moments at least 61 seconds long (aim for 70-150 seconds) — the length TikTok Creator Rewards asks for. A shorter moment must be dropped, however good it is.' : `Aim for moments about ${shortLen} seconds long.`}
Find the moments in THIS segment that would make viral Shorts. Return JSON only:
{"beyondEnd": false, "moments": [{"startSec": 0, "endSec": 0, "score": 0, "title": "...", "hook": "...", "why": "...", "pauses": []}]}
startSec/endSec are seconds FROM THE START OF THIS SEGMENT. score is a strict viral score 0-99. title max 60 chars. hook is 3-7 punchy words. why is one short line. ${cutPauses ? 'PAUSES: in each moment\'s "pauses" array, list the silences longer than 2 seconds INSIDE that moment as {"startSec": 0, "endSec": 0} (also segment-relative) — these will be cut out. Empty array if there are none.' : '"pauses" is always an empty array.'} Skip silence, menus, sponsor reads, intros and outros. If this segment is past the end of the video, return {"beyondEnd": true, "moments": []}.`, { startSec: s, endSec: en, onRetry: scanRetry('st2') });
  }
  function addMoments(list, base) {
    let added = 0, dropped = 0;
    for (const m of (list || [])) {
      const st = base + (parseTs(m.startSec) || 0);
      let en = m.endSec != null ? base + (parseTs(m.endSec) || 0) : null;
      // Provenance: never keep a moment that starts past the video's real
      // end; clamp the end to the known duration.
      if (durationSec > 0 && st >= durationSec) { dropped++; continue; }
      if (durationSec > 0 && en != null && en > durationSec) en = durationSec;
      const pauses = (Array.isArray(m.pauses) ? m.pauses : []).map(p => ({ startSec: base + (parseTs(p.startSec) || 0), endSec: base + (parseTs(p.endSec) || 0) })).filter(p => p.endSec > p.startSec);
      found.push({ startSec: st, endSec: en, startLabel: `${fmt(st)}${en != null ? ' – ' + fmt(en) : ''}`, score: Math.max(0, Math.min(99, Number(m.score) || 0)), title: m.title || 'Moment', hook: m.hook || '', why: m.why || '', picked: false, pauses });
      added++;
    }
    return { added, dropped };
  }

  on('scan', 'click', async (e) => {
    if (!requireKey()) return;
    const url = $('slink').value.trim();
    if (!/(youtube\.com|youtu\.be)/i.test(url)) { toast('Paste a YouTube link — or switch to the Transcript tab for Twitch.', true); return; }
    const b = e.currentTarget; busy(b, true);
    found = []; scannedRanges = []; scannedUrl = url; renderFound();
    const prog = makeProgress($('scanprog'), ['Reading the video', 'Watching & scoring moments', 'Ranking the best', 'Ready']);
    activeProg = prog; curStep = 0;
    try {
      if (!(durationSec > 0 && probedId === videoId)) {
        try {
          const probe = await geminiYouTubeJson(url, PROBE_PROMPT, { timeoutMs: 120000, onRetry: scanRetry() });
          durationSec = Number(probe.durationSec) || 0;
          if (probe.title && !streamTitle) { streamTitle = probe.title; $('sc-title').textContent = streamTitle; }
          probedId = videoId;
          updateCalls();
        } catch { /* probe is best-effort; windows below still run */ }
      }
      curStep = 1;
      prog.setStep(1, streamTitle ? `Video found: ${streamTitle}${durationSec ? ` · ${fmt(durationSec)} long` : ''}` : 'Watching & scoring moments');
      const WIN = 600;
      const total = durationSec > 0 ? Math.min(durationSec, 4 * 3600) : 3600;
      const winsTotal = Math.max(1, Math.ceil(total / WIN));
      // Honour "What to scan": tail options scan only the windows covering
      // the last X minutes (end-aligned chunks, so the call count matches).
      let winList = [];
      if (scanRange !== 'whole' && durationSec > 0) {
        const t0 = Math.max(0, total - Number(scanRange));
        for (let s = t0; s < total; s += WIN) winList.push([s, Math.min(total, s + WIN)]);
      } else {
        if (scanRange !== 'whole') prog.setStep(1, 'Length unknown — scanning the whole video instead…');
        for (let w = 0; w < winsTotal; w++) winList.push([w * WIN, Math.min(total, w * WIN + WIN)]);
      }
      let beyond = false, droppedTotal = 0, prevErr = null;
      for (let k = 0; k < winList.length && !beyond; k++) {
        if (k > 0) await breather(prevErr); // pacing between window scans (longer after a limit hit)
        const [s, en] = winList[k];
        prog.setStep(1, `Watching ${fmt(s)} – ${fmt(en)} (window ${k + 1} of ${winList.length})`);
        prog.setFraction(k / winList.length);
        try {
          const d = await scanWindow(url, s, en);
          if (d.beyondEnd) { beyond = true; break; }
          prevErr = null;
          droppedTotal += addMoments(d.moments, s).dropped;
          scannedRanges.push([s, en]);
          found.sort((a, b2) => b2.score - a.score);
          renderFound();
          prog.setFraction((k + 1) / winList.length);
        } catch (err) {
          prevErr = err;
          if (k === 0) throw err; // first window failing = the link itself failed
          prog.setStep(1, `Window ${k + 1} could not be watched (${err.message}) — continuing…`);
        }
      }
      curStep = 2;
      prog.setStep(2, `Watched the video — ${found.length} moments found${droppedTotal ? ` · Ignored ${droppedTotal} moment${droppedTotal > 1 ? 's' : ''} past the video's end` : ''}`);
      finishPick(pickCount, Number($('cmin').value));
      renderFound();
      prog.setStep(2, `Best ${found.filter(m => m.picked).length} moments pre-picked (score ≥ ${$('cmin').value})`);
      saveClipWork();
      prog.done();
      if (!found.length) toast('Gemini watched it but found no strong moments. Try the transcript mode, or a different stream.', true);
    } catch (err) {
      prog.fail(err.message);
      toast('YouTube scan failed: ' + err.message + ' — private/age-restricted or very long videos can fail; the Transcript tab always works.', true);
    }
    activeProg = null;
    busy(b, false, '✦ Start scanning');
  });

  // "Scan the newest part": re-watch only the LAST 10-minute window (the
  // newest window not yet scanned, or the final window again if everything
  // was scanned) and merge — moments in that window are replaced, picks for
  // surviving moments are kept.
  async function scanNewest() {
    if (!requireKey()) return;
    const url = $('slink').value.trim();
    if (!scannedUrl || url !== scannedUrl) { toast('Scan this video first, then scan its newest part.', true); return; }
    const prog = makeProgress($('scanprog'), ['Checking the newest part', 'Watching the newest window', 'Updating the list', 'Ready']);
    activeProg = prog; curStep = 0;
    try {
      try {
        const p = await geminiYouTubeJson(url, PROBE_PROMPT, { timeoutMs: 120000, onRetry: scanRetry() });
        if (Number(p.durationSec)) durationSec = Number(p.durationSec);
      } catch { /* keep the duration we have */ }
      const WIN = 600;
      const total = durationSec > 0 ? Math.min(durationSec, 4 * 3600) : 3600;
      const winsTotal = Math.max(1, Math.ceil(total / WIN));
      const ts = (winsTotal - 1) * WIN, te = total;
      const covered = scannedRanges.some(([s, en]) => s <= ts && en >= te);
      curStep = 1;
      prog.setStep(1, covered
        ? 'Everything was already scanned — rescanning the newest part (the last 10 minutes) anyway…'
        : `Scanning the newest part (${fmt(ts)} – ${fmt(te)})…`);
      const pickedAt = new Set(found.filter(m => m.picked).map(m => m.startSec));
      found = found.filter(m => !(m.startSec != null && m.startSec >= ts && m.startSec < te));
      const d = await scanWindow(url, ts, te);
      let dropped = 0;
      if (!d.beyondEnd) dropped = addMoments(d.moments, ts).dropped;
      for (const m of found) if (pickedAt.has(m.startSec)) m.picked = true;
      scannedRanges.push([ts, te]);
      found.sort((a, b2) => b2.score - a.score);
      renderFound();
      prog.setStep(2, `Newest part scanned — ${found.length} moments in total${dropped ? ` · Ignored ${dropped} moment${dropped > 1 ? 's' : ''} past the video's end` : ''}`);
      saveClipWork();
      prog.done();
    } catch (err) { prog.fail(err.message); toast('Newest-part scan failed: ' + err.message, true); renderFound(); }
    activeProg = null;
  }

  /* ----- Transcript mode: same scoring engine, chunk by chunk ----- */
  on('tscan', 'click', async (e) => {
    if (!requireKey()) return;
    const text = $('transcript').value.trim();
    if (text.length < 120) { toast('Paste the stream transcript first (at least a few minutes of it).', true); return; }
    const b = e.currentTarget; busy(b, true);
    found = []; renderFound();
    mode = 'tx'; // transcript results feed the same editor in transcript mode
    const prog = makeProgress($('txprog'), ['Reading the transcript', 'Scoring the moments', 'Ready']);
    try {
      const chunks = chunkText(text, 9000);
      for (let i = 0; i < chunks.length; i++) {
        if (i > 0) await breather(null); // pacing: space the chunk calls out
        prog.setStep(1, `Scoring part ${i + 1} of ${chunks.length} — ${found.length} moments so far`);
        const d = await geminiJson(`You are a top stream clipper. From this part of a stream transcript, pick the moments for viral Shorts. Return JSON only: {"items":[{"title":"catchy, max 60 chars","at":"timestamp as written in the text, or '—'","score":0,"hook":"3-7 punchy words","why":"one short line"}]} Score strictly 0-99. Skip silence, menus, sponsor talk, intros. Transcript part:\n${chunks[i]}`, { bulk: true, onRetry: (info) => prog.setStep(1, retryMsg(info)) });
        for (const m of (d.items || [])) found.push({ startSec: parseTs(m.at), endSec: null, startLabel: m.at || '—', score: Math.max(0, Math.min(99, Number(m.score) || 0)), title: m.title || 'Moment', hook: m.hook || '', why: m.why || '', picked: false });
        found.sort((a, b2) => b2.score - a.score);
        renderFound();
        prog.setFraction((i + 1) / chunks.length);
      }
      finishPick(Number($('tcount').value), Number($('tmin').value));
      renderFound();
      saveClipWork();
      prog.done();
      if (!found.length) toast('No strong moments found in that transcript.', true);
    } catch (err) { prog.fail(err.message); toast(err.message, true); }
    busy(b, false, 'Find best moments');
  });

  /* ----- clip editor (js/editor.js) ----- */
  editorHandle = initEditor({
    getFound: () => found,
    getMode: () => mode,
    getVideoId: () => videoId,
    getStreamTitle: () => streamTitle || 'this stream',
    getVoiceMode: () => voiceMode,
    getQuality: () => quality,
    getDuration: () => durationSec,
    pickedCount: () => found.filter(m => m.picked).length,
    rerender: () => renderFound(),
    onMake: () => { if (editorHandle) editorHandle.close(); renderFound(); renderBrief(); toast('Saved into the render queue — brief below.'); },
    onDelete: (m) => { found = found.filter(x => x !== m); if (editorHandle) editorHandle.close(); renderFound(); toast('Short deleted.'); },
  });
  // Restore the last scan made on this device — unless a Live Now handoff
  // link just arrived, which always wins.
  const savedClip = workFor('clipper');
  if (savedClip && savedClip.payload && (savedClip.payload.found || []).length && !new URLSearchParams(location.search).get('v')) {
    const p = savedClip.payload;
    found = p.found || []; videoId = p.videoId || ''; streamTitle = p.streamTitle || ''; durationSec = p.durationSec || 0;
    quality = p.quality || quality; voiceMode = p.voiceMode || voiceMode;
    if (p.mode === 'tx') setMode('tx');
    const tt = $('sc-title'); if (tt && streamTitle) tt.textContent = streamTitle;
    renderFound();
  }
}

/* ---------- Lecture to Revision Clips: find concepts from the source ----------
 * YouTube source: the Stream Clipper's window-scan machinery — Gemini watches
 * the lecture in 10-minute windows and returns concepts with real timestamps.
 * PDF / text source: there is no video to cut, so the model honestly returns
 * the KEY SECTIONS of the document as revision cards (never fake timestamps).
 */
if (tool === 'lecture-clips') {
  const LC_PROBE = 'Return JSON only: {"durationSec": 0, "title": ""} — durationSec is the total length of this video in seconds (a number), title is its title. If you truly cannot tell the length, use 0.';
  function conceptCard(m, i) {
    return `<div class="outcard"><b>${i + 1}. ${esc(m.title)}</b>
      <p class="small dim mt">${fmt(m.startSec || 0)} – ${fmt(m.endSec || 0)} · ${esc(m.why || '')}</p>
      <p class="mt"><span class="tag y">Hook</span> ${esc(m.hook || '')}</p>
      <p class="small dim mt"><a href="https://www.youtube.com/watch?v=${SRC.videoId}&t=${Math.max(0, Math.floor(m.startSec || 0))}s" target="_blank" rel="noopener">▶ Watch this concept in the lecture</a></p></div>`;
  }
  function sectionCard(m, i) {
    return `<div class="outcard"><div class="spread"><b>${i + 1}. ${esc(m.title)}</b><span class="tag">Section</span></div>
      ${m.summary ? `<p class="out mt">${esc(m.summary)}</p>` : ''}
      ${m.why ? `<p class="small dim mt">Why it matters: ${esc(m.why)}</p>` : ''}
      ${m.hook ? `<p class="mt"><span class="tag y">Remember</span> ${esc(m.hook)}</p>` : ''}</div>`;
  }
  on('lcgo', 'click', async (e) => {
    if (!requireKey() || !requireSource()) return;
    const b = e.currentTarget; busy(b, true);
    const focus = $('lcfocus') ? $('lcfocus').value : 'Key concepts';
    const prog = makeProgress($('prog'), SRC.type === 'youtube' ? ['Reading the lecture', 'Watching the lecture', 'Collecting the concepts', 'Ready'] : ['Reading your material', 'Picking the key sections', 'Ready']);
    try {
      if (SRC.type === 'youtube') {
        let durSec = SRC.durationSec || 0;
        if (!durSec) {
          try { const p = await geminiYouTubeJson(SRC.link, LC_PROBE, { timeoutMs: 120000, onRetry: (info) => prog.setStep(0, retryMsg(info)) }); durSec = Number(p.durationSec) || 0; } catch { /* windows below still run */ }
        }
        prog.setStep(1, durSec ? `Lecture found — ${fmt(durSec)} long. Watching…` : 'Watching the lecture…');
        const WIN = 600;
        const total = durSec > 0 ? Math.min(durSec, 4 * 3600) : 3600;
        const wins = Math.max(1, Math.ceil(total / WIN));
        const items = [];
        let beyond = false, prevErr = null;
        for (let k = 0; k < wins && !beyond; k++) {
          if (k > 0) await breather(prevErr); // pacing between window scans (longer after a limit hit)
          const s = k * WIN, en = Math.min(total, s + WIN);
          prog.setStep(1, `Watching ${fmt(s)} – ${fmt(en)} (window ${k + 1} of ${wins})`);
          try {
            const d = await geminiYouTubeJson(SRC.link, `Watch ONLY the segment of this lecture you were given (it starts at ${fmt(s)} of the full lecture). Find the key concepts a student must revise. Focus on: ${focus}. Return JSON only: {"beyondEnd": false, "items":[{"title":"concept name","startSec":0,"endSec":0,"why":"one line: why it matters for the exam","hook":"3-6 word memory hook"}]}
startSec/endSec are seconds FROM THE START OF THIS SEGMENT. Up to 4 concepts per segment, in teaching order; each concept 30-60 seconds. If this segment is past the end of the lecture, return {"beyondEnd": true, "items": []}.`, { startSec: s, endSec: en, onRetry: (info) => prog.setStep(1, retryMsg(info)) });
            if (d.beyondEnd) { beyond = true; break; }
            prevErr = null;
            for (const m of (d.items || [])) {
              const st = s + (parseTs(m.startSec) || 0);
              let en2 = m.endSec != null ? s + (parseTs(m.endSec) || 0) : null;
              if (durSec > 0 && st >= durSec) continue;
              if (durSec > 0 && en2 != null && en2 > durSec) en2 = durSec;
              items.push({ title: m.title || 'Concept', startSec: st, endSec: en2, why: m.why || '', hook: m.hook || '' });
            }
            items.sort((a, b2) => a.startSec - b2.startSec);
            out('lcresult', items.map(conceptCard).join(''));
            prog.setFraction((k + 1) / wins);
          } catch (err) {
            prevErr = err;
            if (k === 0) throw err;
            prog.setStep(1, `Window ${k + 1} could not be watched (${err.message}) — continuing…`);
          }
        }
        prog.setStep(2, `Watched the lecture — ${items.length} concepts found`);
        out('lcresult', (items.map(conceptCard).join('') || '<div class="outcard">No strong concepts found in this lecture. Try a different focus above.</div>')
          + '<p class="small dim mt">These are the exact moments in the YouTube lecture — tap one to watch it there. To download real clip files, add your own copy of the lecture in Step 3 below and cut each concept there.</p>');
        prog.done();
        if (!items.length) toast('Gemini watched the lecture but found no strong concepts.', true);
      } else {
        const st = $('lcstatus'); if (st) st.textContent = 'Reading the material and picking the key sections…';
        prog.setStep(1);
        const d = await sourceJson(`From the attached study material, pick the key sections a student must revise. Focus on: ${focus}. Return JSON only: {"items":[{"title":"section name","summary":"2-3 sentence summary of the section","why":"one line: why it matters for the exam","hook":"3-6 word memory hook"}]}
Up to 8 sections, in the material's own order. This is a document, not a video — do NOT invent timestamps.`, { temperature: 0.45, onRetry: retryNote(b) });
        const items = d.items || [];
        out('lcresult', (items.map(sectionCard).join('') || '<div class="outcard">No clear sections found. Try a longer or cleaner document.</div>')
          + '<p class="small dim mt">These are the key sections of your document, as revision cards. A PDF has no video timestamps, so nothing here pretends to be a clip — revise section by section.</p>');
        prog.done();
        if (st) st.textContent = items.length ? `Done — ${items.length} key sections found.` : '';
      }
    } catch (err) { prog.fail(err.message); toast('Concept finder failed: ' + err.message, true); const st = $('lcstatus'); if (st) st.textContent = ''; }
    busy(b, false, 'Find revision clips');
  });
}

/* ---------- Exam Prep: exam questions + revision sheet + ask your lecture ---------- */
if (tool === 'examprep') {
  /* ----- Exam questions — practice for your test ----- */
  function renderEqResult(d, restoredNote) {
      const mcqs = d.mcqs || [], shorts = d.short || [], longs = d.long || [];
      const letters = ['A', 'B', 'C', 'D', 'E'];
      out('eqresult', `${restoredNote ? `<p class="small dim mt">${restoredNote}</p>` : ''}
      ${mcqs.length ? `<h3 class="mt2">MCQs — choose in your head, then reveal</h3>${mcqs.map((q, i) => `<div class="outcard"><b>Q${i + 1}. ${esc(q.q)}</b>
        <ul class="mt">${(q.options || []).map((o, oi) => `<li><b>${letters[oi] || oi + 1}.</b> ${esc(o)}</li>`).join('')}</ul>
        <button class="chip mt" data-reveal>Show answer</button>
        <p class="small mt hidden" data-answer><b>Answer: ${letters[Number(q.answer)] || ''}. ${esc((q.options || [])[Number(q.answer)] || '')}</b>${q.why ? ` — ${esc(q.why)}` : ''}</p></div>`).join('')}` : ''}
      ${shorts.length ? `<h3 class="mt2">Short questions</h3>${shorts.map((q, i) => `<div class="outcard"><b>S${i + 1}. ${esc(q.q)}</b>
        <button class="chip mt" data-reveal>Show model answer</button>
        <p class="out mt hidden" data-answer>${esc(q.answer || '')}</p></div>`).join('')}` : ''}
      ${longs.length ? `<h3 class="mt2">Long / essay questions</h3>${longs.map((q, i) => `<div class="outcard"><b>L${i + 1}. ${esc(q.q)}</b>
        <button class="chip mt" data-reveal>Show outline answer</button>
        <div class="hidden" data-answer><ul class="mt">${(q.outline || []).map(o => `<li>${esc(o)}</li>`).join('')}</ul></div></div>`).join('')}` : ''}
      ${mcqs.length || shorts.length || longs.length ? `<div class="btns two mt"><button class="btn dark sm" id="eqall">Reveal all answers</button><button class="btn sm" id="eqdl">Download questions (.md)</button></div>` : '<div class="outcard">No questions came back. Try again.</div>'}`);
      const host = $('eqresult');
      host.querySelectorAll('[data-reveal]').forEach(btn => btn.addEventListener('click', () => {
        const a = btn.parentElement.querySelector('[data-answer]');
        if (a) a.classList.toggle('hidden');
        btn.textContent = a && !a.classList.contains('hidden') ? 'Hide answer' : (btn.textContent.includes('model') ? 'Show model answer' : btn.textContent.includes('outline') ? 'Show outline answer' : 'Show answer');
      }));
      on('eqall', 'click', () => host.querySelectorAll('[data-answer]').forEach(a => a.classList.remove('hidden')));
      on('eqdl', 'click', () => {
        const md = [`# Exam questions — practice for your test\n`,
          ...mcqs.map((q, i) => `## MCQ ${i + 1}. ${q.q}\n${(q.options || []).map((o, oi) => `- ${letters[oi]}. ${o}`).join('\n')}\n**Answer: ${letters[Number(q.answer)]}. ${(q.options || [])[Number(q.answer)] || ''}**${q.why ? ` — ${q.why}` : ''}`),
          ...shorts.map((q, i) => `## Short ${i + 1}. ${q.q}\n**Model answer:** ${q.answer || ''}`),
          ...longs.map((q, i) => `## Long ${i + 1}. ${q.q}\n**Outline:**\n${(q.outline || []).map(o => `- ${o}`).join('\n')}`)].join('\n\n');
        download('exam-questions.md', md, 'text/markdown');
      });
  }
  const savedEq = workFor('examprep');
  if (savedEq && savedEq.payload && savedEq.payload.d) renderEqResult(savedEq.payload.d, `Restored — your last question set (${new Date(savedEq.t).toLocaleString()}).`);
  on('eqgo', 'click', async (e) => {
    if (!requireKey() || !requireSource()) return;
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Reading your material', 'Writing MCQs', 'Writing short & long questions', 'Ready']);
    prog.setStep(1);
    try {
      const total = Number($('eqcount').value);
      const longN = total >= 20 ? 3 : 2;
      const mcqN = Math.round(total / 2);
      const shortN = total - mcqN - longN;
      const d = await sourceJson(`Make practice EXAM questions from the attached lecture material ONLY. Difficulty: ${$('eqdiff').value}. Return JSON only:
{"mcqs":[{"q":"...","options":["a","b","c","d"],"answer":0,"why":"one line"}],"short":[{"q":"...","answer":"model answer, 3-5 lines"}],"long":[{"q":"...","outline":["main point","..."]}]}
Exactly ${mcqN} MCQs, ${shortN} short questions and ${longN} long/essay questions. Questions must test real understanding of THIS material — invent nothing that is not in it. Mix the topics across the whole material, in its own order.`, { temperature: 0.55, onRetry: retryNote(b) });
      renderEqResult(d);
      saveWork('examprep', 'Exam questions', { d });
      prog.done();
    } catch (err) { prog.fail(err.message); toast('Exam questions failed: ' + err.message, true); }
    busy(b, false, 'Make exam questions');
  });
  /* ----- One-page revision sheet ----- */
  on('sheetgo', 'click', async (e) => {
    if (!requireKey() || !requireSource()) return;
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Reading the source', 'Writing the sheet', 'Designing the sheet', 'Ready']);
    prog.setStep(1);
    try {
      const d = await revisionSheetData(retryNote(b));
      prog.setStep(2);
      mountSheet($('sheetresult'), d, 'revision-sheet');
      saveWork('notes-sheet', d.title || 'Revision sheet', { data: d });
      prog.done();
      toast('Revision sheet ready — one page, everything that matters.');
    } catch (err) { prog.fail(err.message); toast('Revision sheet failed: ' + err.message, true); }
    busy(b, false, 'Make my revision sheet');
  });
  // Restore the last revision sheet (made from either student page).
  const savedEqSheet = workFor('notes-sheet');
  if (savedEqSheet && savedEqSheet.payload && savedEqSheet.payload.data) mountSheet($('sheetresult'), savedEqSheet.payload.data, 'revision-sheet');
  /* ----- Ask your lecture -----
     The input was an empty box with no sense of what to type — offer
     one-tap starter questions built from the analysed chapters. */
  function paintAskChips() {
    const host = $('askchips'); if (!host) return;
    const chs = (SRC && SRC.ready && Array.isArray(SRC.chapters)) ? SRC.chapters.slice(0, 3) : [];
    host.innerHTML = chs.map(c => `<button class="chip" data-ask="${esc(`Explain ${c.title} in simple words`)}">${esc(`Explain ${c.title}`)}</button>`).join('');
    host.querySelectorAll('[data-ask]').forEach(btn => btn.addEventListener('click', () => { const inp = $('askq'); if (inp) { inp.value = btn.dataset.ask; inp.focus(); } }));
  }
  window.addEventListener('sc-src-ready', paintAskChips);
  paintAskChips();
  const qaHist = [];
  const askLog = $('asklog');
  const addMsg = (text, me) => {
    if (!askLog) return null;
    const div = document.createElement('div');
    div.className = 'chatmsg' + (me ? ' me' : '');
    div.textContent = text;
    askLog.appendChild(div);
    askLog.scrollTop = askLog.scrollHeight;
    return div;
  };
  async function ask() {
    if (!requireKey() || !requireSource()) return;
    const q = $('askq').value.trim();
    if (!q) { toast('Write your question first.', true); return; }
    $('askq').value = '';
    addMsg(q, true);
    const wait = addMsg('Thinking — checking your material…', false);
    const b = $('askgo'); busy(b, true);
    try {
      const ctx = qaHist.slice(-3).map(x => `Earlier — Q: ${x.q}\nA: ${x.a}`).join('\n');
      const rule = `You are a tutor for this student's own lecture material. Answer the question using ONLY that material. If the material does not cover the answer, reply exactly: "This is not covered in this lecture." Answer in simple, clear words; add a tiny example only if the material itself has one.${ctx ? `\n${ctx}` : ''}\n\nQuestion: ${q}`;
      const a = await sourceText(rule, { temperature: 0.35, onRetry: (info) => { if (wait) wait.textContent = retryMsg(info); } });
      qaHist.push({ q, a });
      if (wait) wait.textContent = a;
    } catch (err) { if (wait) wait.textContent = 'That did not work: ' + err.message; }
    busy(b, false, 'Ask');
    if (askLog) askLog.scrollTop = askLog.scrollHeight;
  }
  on('askgo', 'click', ask);
  on('askq', 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ask(); } });
  // Deep links from other student tools (…#ask / …#sheet)
  if (location.hash === '#ask' || location.hash === '#sheet') {
    const t = document.querySelector(location.hash === '#ask' ? '#askcard' : '#sheetcard');
    if (t) setTimeout(() => t.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
  }
}

/* ---------- Your Own Branding ---------- */
if (tool === 'branding') {
  const LS = 'sc_branding_v1';
  const saved = JSON.parse(localStorage.getItem(LS) || '{}');
  if (saved.name) $('bname').value = saved.name;
  if (saved.pos) $('bpos').value = saved.pos;
  if (saved.size) $('bsize').value = saved.size;
  if (saved.op) $('bop').value = saved.op;
  if (saved.intro && $('bintro')) $('bintro').value = saved.intro;
  if (saved.outro && $('boutro')) $('boutro').value = saved.outro;
  if (saved.quality && $('bquality')) $('bquality').value = saved.quality;
  let logoUrl = saved.logo || '', logoImg = null;
  const POS = {
    br: { logo: { right: '12px', bottom: '12px', left: 'auto', top: 'auto' }, name: { left: '12px', bottom: '12px', right: 'auto', top: 'auto' } },
    bl: { logo: { left: '12px', bottom: '12px', right: 'auto', top: 'auto' }, name: { right: '12px', bottom: '12px', left: 'auto', top: 'auto' } },
    tr: { logo: { right: '12px', top: '12px', left: 'auto', bottom: 'auto' }, name: { left: '12px', bottom: '12px', right: 'auto', top: 'auto' } },
    tl: { logo: { left: '12px', top: '12px', right: 'auto', bottom: 'auto' }, name: { right: '12px', bottom: '12px', left: 'auto', top: 'auto' } },
    tc: { logo: { left: '50%', top: '12px', right: 'auto', bottom: 'auto' }, name: { left: '12px', bottom: '12px', right: 'auto', top: 'auto' } },
  };
  const setBox = (el, css) => { Object.assign(el.style, { left: '', right: '', top: '', bottom: '' }, css); };
  const apply = () => {
    const pos = POS[$('bpos').value] || POS.br;
    const lg = $('blogo'), nm = $('bnameov');
    lg.src = logoUrl || ''; lg.style.display = logoUrl ? 'block' : 'none';
    lg.style.maxWidth = `${$('bsize').value}px`; lg.style.maxHeight = `${Math.round($('bsize').value * 0.6)}px`;
    lg.style.opacity = $('bop').value / 100;
    setBox(lg, pos.logo);
    lg.style.transform = $('bpos').value === 'tc' ? 'translateX(-50%)' : '';
    document.querySelectorAll('[data-bpos]').forEach(c => c.classList.toggle('on', c.dataset.bpos === $('bpos').value));
    nm.textContent = $('bname').value || '';
    nm.style.opacity = $('bop').value / 100;
    nm.style.fontSize = `${Math.max(13, $('bsize').value / 6)}px`;
    setBox(nm, pos.name);
    if ($('bsizev')) $('bsizev').textContent = $('bsize').value;
    if ($('bopv')) $('bopv').textContent = $('bop').value + '%';
    localStorage.setItem(LS, JSON.stringify({ name: $('bname').value, logo: logoUrl, pos: $('bpos').value, size: $('bsize').value, op: $('bop').value, intro: $('bintro') ? $('bintro').value : '', outro: $('boutro') ? $('boutro').value : '', quality: $('bquality') ? $('bquality').value : '1080p' }));
    if (logoUrl) { const im = new Image(); im.onload = () => { logoImg = im; }; im.src = logoUrl; }
  };
  ['bname', 'bintro', 'boutro'].forEach(id => on(id, 'input', apply));
  ['bpos', 'bsize', 'bop', 'bquality'].forEach(id => on(id, 'input', apply));
  document.querySelectorAll('[data-bpos]').forEach(c => c.addEventListener('click', () => { $('bpos').value = c.dataset.bpos; apply(); }));
  on('logofile', 'change', (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => { logoUrl = String(r.result); apply(); }; r.readAsDataURL(f);
  });
  on('bgfile', 'change', (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    $('bvid').src = URL.createObjectURL(f); $('bstage').classList.remove('hidden'); apply();
  });
  function drawBrand(x, W, H) {
    const pos = $('bpos').value, op = $('bop').value / 100, sizePx = W * ($('bsize').value / 900);
    x.save(); x.globalAlpha = op;
    const name = $('bname').value || '';
    if (name) {
      // Name sits at the bottom corner opposite the logo's side.
      x.fillStyle = '#fff'; x.font = `900 ${Math.round(W * 0.038)}px Poppins, Arial`; x.shadowColor = '#000'; x.shadowBlur = 8;
      const leftSide = !(pos === 'bl' || pos === 'tl');
      x.fillText(name, leftSide ? 24 : W - x.measureText(name).width - 24, H - 24);
    }
    if (logoImg) {
      const w = Math.min(sizePx * 2.2, W * 0.22); const h = w * logoImg.height / logoImg.width;
      const lx = pos === 'tc' ? (W - w) / 2 : (pos === 'bl' || pos === 'tl') ? 24 : W - w - 24;
      const ly = (pos === 'tl' || pos === 'tr' || pos === 'tc') ? 24 : H - h - 24;
      x.shadowBlur = 0; x.drawImage(logoImg, lx, ly, w, h);
    }
    x.restore();
  }
  on('snap', 'click', () => {
    const v = $('bvid'); if (!v.videoWidth) { toast('Upload a video and play it to the frame you want.', true); return; }
    const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight;
    const x = cv.getContext('2d'); x.drawImage(v, 0, 0);
    drawBrand(x, cv.width, cv.height);
    const a = document.createElement('a'); a.download = 'branded-frame.png'; a.href = cv.toDataURL('image/png'); a.click();
    toast('Branded frame downloaded.');
  });
  // Full branded video export: the overlay is drawn onto every frame.
  on('bexport', 'click', async (e) => {
    const v = $('bvid');
    if (!v.videoWidth) { toast('Upload a video first.', true); return; }
    if (typeof MediaRecorder === 'undefined' || !v.captureStream) { toast('This browser cannot export video in-page. Use Chrome on Android/desktop.', true); return; }
    const b = e.currentTarget; busy(b, true, 'Export branded video (WebM)');
    const prog = $('bprog');
    try {
      const qh = { '1080p': 1080, '720p': 720, '480p': 480 }[$('bquality') ? $('bquality').value : '1080p'] || 1080;
      const qsc = Math.min(1, qh / (v.videoHeight || qh));
      const cv = document.createElement('canvas'); cv.width = Math.max(2, Math.round(v.videoWidth * qsc) & ~1); cv.height = Math.max(2, Math.round(v.videoHeight * qsc) & ~1);
      const x = cv.getContext('2d');
      let raf = 0;
      const intro = $('bintro') ? $('bintro').value.trim() : '';
      const outro = $('boutro') ? $('boutro').value.trim() : '';
      const bigText = (txt) => { x.save(); x.font = `900 ${Math.round(cv.width * 0.055)}px Poppins, Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.shadowColor = '#000'; x.shadowBlur = 12; x.fillStyle = '#fff'; x.fillText(txt, cv.width / 2, cv.height / 2); x.restore(); };
      const draw = () => {
        x.drawImage(v, 0, 0, cv.width, cv.height); drawBrand(x, cv.width, cv.height);
        if (intro && v.currentTime < 2) bigText(intro);
        if (outro && (v.duration || 0) > 4.5 && v.currentTime > v.duration - 2.2) bigText(outro);
        raf = requestAnimationFrame(draw);
      };
      const stream = cv.captureStream(30);
      v.captureStream().getAudioTracks().forEach(t => stream.addTrack(t));
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = []; rec.ondataavailable = (xx) => chunks.push(xx.data);
      const done = new Promise(r => rec.onstop = r);
      v.currentTime = 0; draw(); await v.play(); rec.start(250);
      let cancelled = false;
      const cancelBtn = $('bcancel');
      if (cancelBtn) { cancelBtn.classList.remove('hidden'); cancelBtn.onclick = () => { cancelled = true; }; }
      const tick = setInterval(() => { if (prog && v.duration) prog.textContent = `Rendering your branding onto the video… ${fmt(v.currentTime)} of ${fmt(v.duration)} (${Math.round(v.currentTime / v.duration * 100)}%) — keep this tab open`; }, 300);
      await new Promise(r => { if (v.ended) return r(); v.addEventListener('ended', () => r(), { once: true }); const iv = setInterval(() => { if (cancelled) { clearInterval(iv); r(); } }, 250); setTimeout(() => { clearInterval(iv); r(); }, (v.duration + 2) * 1000); });
      clearInterval(tick); cancelAnimationFrame(raf);
      if (cancelBtn) cancelBtn.classList.add('hidden');
      v.pause();
      rec.stop(); await done;
      if (cancelled) { if (prog) prog.textContent = ''; toast('Export cancelled — nothing was saved.'); busy(b, false, 'Export branded video (WebM)'); return; }
      download('branded-video.webm', new Blob(chunks, { type: 'video/webm' }));
      saveShort(($('bname').value.trim() || 'Branded clip'), v, 'your-branding');
      if (prog) prog.textContent = `Done — branded video downloaded at ${cv.width}×${cv.height}. Your logo and name are burned into every frame${intro || outro ? ', with your intro/outro text' : ''}.`;
      toast('Branded video exported.');
    } catch (err) { toast('Export failed: ' + err.message, true); if (prog) prog.textContent = ''; }
    busy(b, false, 'Export branded video (WebM)');
  });
  apply();
}

/* Test hook for tests/regression.mjs (not used by the site). */
export const __test = { parseBriefBatch };
