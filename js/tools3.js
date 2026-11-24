// StreamClip AI — tool logic, wave 3 (Viral Hook Translator, Dukaan Promo
// Maker, Shayari Maker, Cricket Clip Finder, News Card Maker, Voice Changer
// Dub, Subtitle Burner Pack, Podcast-to-Posts, Ramadan / Eid Content Kit,
// Blog Writer, Keyword Finder, AI Answer Checker, Carousel Maker,
// Pinterest Pin Maker + Pin Prompt Maker, Voice Maker, Blog-to-Reel).
// All AI runs in the browser on the visitor's key, via js/gemini.js only.
// Creator/business tools only — no student tools in this wave.
import { requireKey, hasKey, geminiText, geminiJson, geminiImage, geminiParts, geminiPartsJson, geminiYouTubeJson, geminiTTS, GEMINI_VOICES, fileToInline, esc } from './gemini.js';
import { toast, saveWork, workFor } from './site.js';

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
/* ---------- SRT helpers (same shapes as wave 2) ---------- */
function srtTime(sec) {
  sec = Math.max(0, Number(sec) || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60), ms = Math.round((sec - Math.floor(sec)) * 1000);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}
function cuesToSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}`).join('\n\n') + '\n';
}
/* ---------- Canvas helpers (cards, posters, slides, pins) ---------- */
function wrapLines(ctx, text, maxW) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}
function fitLines(ctx, text, maxW, startPx, minPx, maxLines, weight = 800, family = 'Arial, sans-serif') {
  let px = startPx;
  while (px > minPx) {
    ctx.font = `${weight} ${px}px ${family}`;
    const lines = wrapLines(ctx, text, maxW);
    if (lines.length <= maxLines) return { lines, px };
    px -= 4;
  }
  ctx.font = `${weight} ${minPx}px ${family}`;
  return { lines: wrapLines(ctx, text, maxW).slice(0, maxLines), px: minPx };
}
function downloadCanvas(canvas, name) {
  canvas.toBlob((b) => { if (b) download(name, b); }, 'image/png');
}
function loadImg(src) {
  return new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = src; });
}
function drawCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
const voiceOptions = (sel, dflt = 'Kore') => { if (sel) sel.innerHTML = GEMINI_VOICES.map(v => `<option${v === dflt ? ' selected' : ''}>${v}</option>`).join(''); };

/* ---------- Viral Hook Translator ----------
 * Step 1: Gemini watches a viral video and names the STRUCTURE of its hook
 * (what happens in the first seconds, the on-screen text, the promise).
 * Step 2: the visitor's own topic is poured into that same structure —
 * 5 hooks in their language, plus the structure explained so they can
 * reuse the pattern without the tool. */
if (tool === 'hooktrans') {
  let structure = null, hooks = [];
  function renderStructure() {
    const host = $('htstructure'); if (!host) return;
    if (!structure) { host.innerHTML = ''; return; }
    host.innerHTML = `<div class="outcard"><div class="spread"><b>The hook structure</b><span class="tag y">${esc(structure.pattern || 'Pattern')}</span></div>
      <p class="small mt"><b>First seconds:</b> ${esc(structure.firstSeconds || '—')}</p>
      <p class="small mt"><b>On-screen text:</b> ${esc(structure.onScreenText || '—')}</p>
      <p class="small mt"><b>The promise:</b> ${esc(structure.promise || '—')}</p>
      ${(structure.steps || []).length ? `<p class="small mt"><b>How it is built:</b></p><ol>${structure.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
      <p class="small mt"><b>Why it works:</b> ${esc(structure.whyItWorks || '—')}</p></div>`;
  }
  function renderHooks() {
    const host = $('hthooks'); if (!host) return;
    host.innerHTML = hooks.length ? `<div class="spread mt2"><h3>Your hooks — same structure, your topic</h3><button class="chip" id="htcopyall">Copy all</button></div>` +
      hooks.map((h, i) => `<div class="outcard"><div class="spread"><b>Hook ${i + 1}</b><button class="chip" data-hcopy="${i}">Copy</button></div><p class="mt">${esc(typeof h === 'string' ? h : h.text || '')}</p>${(typeof h === 'object' && h.note) ? `<p class="small dim mt">${esc(h.note)}</p>` : ''}</div>`).join('') : '';
    host.querySelectorAll('[data-hcopy]').forEach(b => b.addEventListener('click', () => { const h = hooks[Number(b.dataset.hcopy)]; copyText(typeof h === 'string' ? h : h.text || ''); }));
    const ca = $('htcopyall');
    if (ca) ca.addEventListener('click', () => copyText(hooks.map(h => typeof h === 'string' ? h : h.text || '').join('\n'), 'All hooks copied.'));
  }
  on('htanalyse', 'click', async (e) => {
    if (!requireKey()) return;
    const url = $('htlink').value.trim();
    if (!ytId(url)) { toast('Paste a YouTube link to the viral video first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Watching the video', 'Breaking down the hook', 'Ready']);
    try {
      const d = await geminiYouTubeJson(url, `Watch the START of this viral video very closely — the first 5 seconds above all. Your job is to name the STRUCTURE of its hook, not to summarise the video.
Return JSON only:
{"pattern":"the hook pattern's name, e.g. 'Result first, proof second'","firstSeconds":"what literally happens/shows in the first 3-5 seconds","onScreenText":"the on-screen text used at the start, or 'none'","promise":"the promise the hook makes to the viewer","steps":["step 1 of the structure","step 2","..."],"whyItWorks":"one or two lines on the psychology"}
Be exact about the first seconds — that is the whole point.`, { timeoutMs: 180000, onRetry: (info) => prog.setStep(0, retryMsg(info)) });
      structure = d;
      prog.setStep(1);
      renderStructure();
      prog.done();
      toast('Structure found — now give it your topic.');
    } catch (err) { prog.fail(err.message); toast('Analysis failed: ' + err.message, true); }
    busy(b, false, 'Analyse the hook');
  });
  on('htgo', 'click', async (e) => {
    if (!requireKey()) return;
    if (!structure) { toast('Analyse a viral video first — its structure is what your hooks are built from.', true); return; }
    const topic = $('httopic').value.trim();
    if (topic.length < 3) { toast('Write your topic first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog2'), ['Pouring your topic into the structure', 'Writing 5 hooks', 'Ready']);
    try {
      const d = await geminiJson(`You are a viral hook writer. A hook structure was extracted from a real viral video:
Pattern: ${structure.pattern || ''}
First seconds: ${structure.firstSeconds || ''}
On-screen text: ${structure.onScreenText || ''}
Promise: ${structure.promise || ''}
Steps: ${(structure.steps || []).join(' → ')}

Now write hooks for THIS topic: "${topic}". Language: ${$('htlang').value}.
Follow the structure EXACTLY — same beats, same promise shape — but the topic, words and details are entirely the new topic's. Never mention the original video.
Return JSON only: {"hooks":[{"text":"the hook line, ready to say on camera","note":"one short line: which structure step this line performs"}]}
Give exactly 5 hooks, each a different take on the structure (different angle or wording, same skeleton). Each hook 5-14 words, spoken-style, no emojis, no hashtags.`, { bulk: true, temperature: 0.8, onRetry: (info) => prog.setStep(0, retryMsg(info)) });
      hooks = d.hooks || [];
      if (!hooks.length) throw new Error('The AI reply held no hooks. Try again.');
      prog.setStep(1);
      renderHooks();
      saveWork('hooktrans', topic, { structure, hooks });
      prog.done();
    } catch (err) { prog.fail(err.message); toast(err.message, true); }
    busy(b, false, 'Write my hooks');
  });
  const savedHt = workFor('hooktrans');
  if (savedHt && savedHt.payload) { structure = savedHt.payload.structure || null; hooks = savedHt.payload.hooks || []; renderStructure(); renderHooks(); }
}

/* ---------- Dukaan Promo Maker ----------
 * For small shops: name + type + offers in → a complete promo pack out:
 * an AI poster carrying the offer text, a WhatsApp broadcast message, a
 * status-video script voiced by the AI, and a posting caption. */
if (tool === 'dukaan') {
  voiceOptions($('dkvoice'));
  let pack = null;
  on('dkgo', 'click', async (e) => {
    if (!requireKey()) return;
    const name = $('dkname').value.trim();
    const items = $('dkitems').value.trim();
    if (!name) { toast('Write the shop name first.', true); return; }
    if (items.length < 5) { toast('Add at least one product or offer.', true); return; }
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Writing the promo words', 'Designing the poster', 'Making the voice', 'Ready']);
    const lang = $('dklang').value, tone = $('dktone').value;
    try {
      const d = await geminiJson(`You write promos for small local shops. Shop: "${name}" (${$('dktype').value}). Products and offers (one per line):
${items.slice(0, 2000)}
Language: ${lang}. Tone: ${tone}.
Return JSON only:
{"offerLine":"the single strongest offer, max 8 words, in ${lang} — this goes big on the poster","posterSub":"one short supporting line for the poster, in ${lang}","whatsapp":"a WhatsApp broadcast message: greeting, the offers as a tidy list, price mentions kept exactly as written, a clear call to action (visit / order on WhatsApp), shop name at the end. In ${lang}.","caption":"a 2-3 line posting caption with 4-6 hashtags, in ${lang}","script":"a spoken status-video script, 20-30 seconds when read aloud (50-70 words), in ${lang}: hook first, offers in the middle, call to action at the end"}
Rules: never invent prices or discounts that are not in the list. Keep product names exactly as written.`, { bulk: true, temperature: 0.7, onRetry: (info) => prog.setStep(0, retryMsg(info)) });
      pack = { name, offerLine: d.offerLine || '', posterSub: d.posterSub || '', whatsapp: d.whatsapp || '', caption: d.caption || '', script: d.script || '' };
      prog.setStep(1);
      out('dkresult', `<div class="outcard"><div class="spread"><b>${esc(name)} — promo pack</b><span class="tag y">${esc(lang)}</span></div>
        <div id="dkposter" class="mt"><span class="spin"></span> Designing the poster…</div>
        <div class="outcard" style="box-shadow:none"><b>WhatsApp broadcast message</b><p class="small mt" style="white-space:pre-wrap">${esc(pack.whatsapp)}</p><button class="chip mt" id="dkcopywa">Copy message</button></div>
        <div class="outcard" style="box-shadow:none"><b>Status-video script</b><p class="small mt">${esc(pack.script)}</p><div id="dkvoicehost" class="mt"><span class="spin"></span> Making the voice…</div></div>
        <div class="outcard" style="box-shadow:none"><b>Posting caption</b><p class="small mt" style="white-space:pre-wrap">${esc(pack.caption)}</p><button class="chip mt" id="dkcopycap">Copy caption</button></div></div>`);
      on('dkcopywa', 'click', () => copyText(pack.whatsapp, 'Broadcast message copied.'));
      on('dkcopycap', 'click', () => copyText(pack.caption, 'Caption copied.'));
      // Poster — AI image with the offer text baked in by the image model.
      let prevErr = null;
      try {
        const url = await geminiImage(`Vertical 4:5 advertising poster for a local shop called "${name}" (${$('dktype').value}). Bright, clean, appetising/professional photo-style background of the shop's products. The poster MUST show this text clearly, large and correctly spelled, in the poster's main area: "${pack.offerLine}" and below it in smaller text "${pack.posterSub}" and the shop name "${name}". Bold modern poster typography, high contrast, no other text, no watermark.`, null, '4:5', { onRetry: retryNote(null, $('dkposter')) });
        const host = $('dkposter');
        if (host) host.innerHTML = `<img class="prev" src="${url}" alt="Promo poster"><a class="btn dark sm mt" href="${url}" download="dukaan-poster.png">Download the poster</a><p class="small dim mt">Check the poster's words before posting — AI image text can misspell; regenerate if a letter is wrong.</p>`;
      } catch (err) { prevErr = err; const host = $('dkposter'); if (host) host.innerHTML = `<p class="small" style="color:var(--red)">Poster failed — ${esc(err.message)}</p>`; }
      // Voice — the status script, spoken.
      prog.setStep(2);
      await breather(prevErr);
      const vh = $('dkvoicehost');
      try {
        const blob = await geminiTTS(pack.script, $('dkvoice').value, { onRetry: retryNote(b) });
        const url = URL.createObjectURL(blob);
        if (vh) vh.innerHTML = `<audio controls src="${url}" style="width:100%"></audio><a class="btn dark sm mt" href="${url}" download="dukaan-status-voice.wav">Download the voice (.wav)</a><p class="small dim mt">Put this voice over any product video or the poster (as a photo status with music) — that is your status video.</p>`;
      } catch (err) { if (vh) vh.innerHTML = `<p class="small" style="color:var(--red)">Voice failed — ${esc(err.message)}</p>`; }
      saveWork('dukaan', name, { offerLine: pack.offerLine, posterSub: pack.posterSub, whatsapp: pack.whatsapp, caption: pack.caption, script: pack.script });
      prog.done();
    } catch (err) { prog.fail(err.message); toast(err.message, true); }
    busy(b, false, 'Make my promo pack');
  });
  const savedDk = workFor('dukaan');
  if (savedDk && savedDk.payload) {
    const p = savedDk.payload;
    out('dkresult', `<div class="outcard"><div class="spread"><b>Your last promo pack</b><span class="tag">${esc(savedDk.title || '')}</span></div>
      <p class="small mt"><b>Offer:</b> ${esc(p.offerLine || '')}</p>
      <div class="outcard" style="box-shadow:none"><b>WhatsApp broadcast message</b><p class="small mt" style="white-space:pre-wrap">${esc(p.whatsapp || '')}</p></div>
      <div class="outcard" style="box-shadow:none"><b>Status-video script</b><p class="small mt">${esc(p.script || '')}</p></div>
      <div class="outcard" style="box-shadow:none"><b>Posting caption</b><p class="small mt" style="white-space:pre-wrap">${esc(p.caption || '')}</p></div>
      <p class="small dim mt">The poster picture and voice are not kept — run the maker again to regenerate them.</p></div>`);
  }
}

/* ---------- Shayari / Poetry Video Maker ----------
 * Mood + language + verse count → original poetry, one AI background per
 * verse, and every verse voiced in a deep voice. The page delivers the
 * full asset pack; assembling the video is the render step, said plainly. */
if (tool === 'shayari') {
  voiceOptions($('shvoice'), 'Charon');
  let mood = 'Sad', vcount = 4;
  wireChips('rg-shmood', 'shmood', v => { mood = v; });
  wireChips('rg-shcount', 'shcount', v => { vcount = Number(v); });
  let pack = null;
  on('shgo', 'click', async (e) => {
    if (!requireKey()) return;
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Writing the poetry', 'Painting the backgrounds', 'Voicing the verses', 'Ready']);
    const lang = $('shlang').value;
    try {
      const d = await geminiJson(`You are a gifted poet writing ORIGINAL shayari/poetry for short vertical videos. Mood: ${mood}. Language: ${lang}. Write exactly ${vcount} verses (sher). Each verse: 2 lines that land like a punch of feeling — simple words, deep meaning, no clichés copied from famous poets; this must be original writing.
Return JSON only:
{"title":"a short title for this poetry set","verses":[{"text":"the verse, 2 lines separated by a line break","image":"a one-sentence moody background picture description for this verse — visual only, no people faces close-up, no text"}]}
Verses should flow in order — an emotional arc, not ${vcount} unrelated pieces. Write the verse text in ${lang} script/style as a native speaker would post it.`, { temperature: 0.9, onRetry: (info) => prog.setStep(0, retryMsg(info)) });
      pack = { title: d.title || 'Shayari', verses: (d.verses || []).filter(v => v && v.text) };
      if (!pack.verses.length) throw new Error('The AI reply held no verses. Try again.');
      prog.setStep(1);
      out('shresult', `<div class="outcard"><div class="spread"><b>${esc(pack.title)}</b><span class="tag y">${pack.verses.length} verses · ${esc(mood)}</span></div>
        <p class="small dim mt">Painting one background per verse, then voicing each verse…</p></div>
        <div id="shverses">${pack.verses.map((v, i) => `<div class="outcard"><b>Verse ${i + 1}</b><div class="sceneimg mt" id="shimg-${i}" style="position:relative"><span class="spin"></span> Painting…</div><p class="mt" style="white-space:pre-wrap">${esc(v.text)}</p><div id="shaud-${i}" class="mt"><span class="spin"></span> Voicing…</div></div>`).join('')}</div>
        <div class="btns two mt"><button class="btn dark sm" id="shcopypack">Copy all verses</button><button class="btn sm" id="shdlpack">Download the pack (.md)</button></div>
        <div class="note mt"><div><b>Render step.</b><div class="small dim">You have everything a poetry video is made of — background, words and voice per verse. The final assembled video is made in the render step; this website does not run a render engine yet, so nothing here fakes a finished MP4.</div></div></div>`);
      on('shcopypack', 'click', () => copyText(pack.verses.map(v => v.text).join('\n\n'), 'Verses copied.'));
      on('shdlpack', 'click', () => download('shayari-pack.md', `# ${pack.title}\n\n${pack.verses.map((v, i) => `## Verse ${i + 1}\n${v.text}\n\nBackground: ${v.image || ''}`).join('\n\n')}`, 'text/markdown'));
      let prevErr = null;
      for (let i = 0; i < pack.verses.length; i++) {
        if (i > 0) await breather(prevErr);
        const host = $(`shimg-${i}`);
        try {
          const url = await geminiImage(`Vertical 9:16 moody background for a poetry video. ${pack.verses[i].image || 'A quiet, emotional scene matching deep poetry'}. Cinematic, soft light, no text, no words, no watermark. Leave calm empty space in the middle for poetry text.`, null, '9:16', { onRetry: retryNote(null, host) });
          pack.verses[i].imgUrl = url;
          if (host) host.innerHTML = `<img class="prev" src="${url}" alt="Verse ${i + 1} background"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.35)"><p style="color:#fff;font-weight:700;text-align:center;white-space:pre-wrap;text-shadow:0 2px 10px rgba(0,0,0,.6)">${esc(pack.verses[i].text)}</p></div><a class="btn dark sm mt" href="${url}" download="shayari-verse-${i + 1}.png">Download background</a>`;
          prevErr = null;
        } catch (err) { prevErr = err; if (host) host.innerHTML = `<p class="small" style="color:var(--red)">Background failed — ${esc(err.message)}</p>`; }
        prog.setFraction((i + 1) / pack.verses.length);
      }
      prog.setStep(2);
      let vprev = null;
      for (let i = 0; i < pack.verses.length; i++) {
        if (i > 0) await breather(vprev);
        const host = $(`shaud-${i}`);
        try {
          const blob = await geminiTTS(pack.verses[i].text.replace(/\n/g, ' '), $('shvoice').value, { onRetry: retryNote(b) });
          const url = URL.createObjectURL(blob);
          if (host) host.innerHTML = `<audio controls src="${url}" style="width:100%"></audio><a class="btn dark sm mt" href="${url}" download="shayari-verse-${i + 1}.wav">Download verse voice (.wav)</a>`;
          vprev = null;
        } catch (err) { vprev = err; if (host) host.innerHTML = `<p class="small" style="color:var(--red)">Voice failed — ${esc(err.message)}</p>`; }
        prog.setFraction((i + 1) / pack.verses.length);
      }
      saveWork('shayari', pack.title, { title: pack.title, verses: pack.verses.map(v => ({ text: v.text, image: v.image })) });
      prog.done();
    } catch (err) { prog.fail(err.message); toast(err.message, true); }
    busy(b, false, 'Make my shayari pack');
  });
  const savedSh = workFor('shayari');
  if (savedSh && savedSh.payload && (savedSh.payload.verses || []).length) {
    const p = savedSh.payload;
    out('shresult', `<div class="outcard"><div class="spread"><b>${esc(p.title || 'Shayari')}</b><span class="tag">Your last set</span></div>${p.verses.map((v, i) => `<p class="mt"><b>Verse ${i + 1}</b></p><p style="white-space:pre-wrap">${esc(v.text)}</p>`).join('')}<p class="small dim mt">Backgrounds and voices are not kept — run the maker again to regenerate them.</p></div>`);
  }
}

/* ---------- Cricket Clip Finder ----------
 * The Podcast Clipper's window scan, re-tuned for cricket: wickets, sixes,
 * fours, catches and funny moments, each tagged with its type so the list
 * can be filtered. Watch-link provenance + Pick → brief, same pattern. */
if (tool === 'cricket') {
  let clipLen = 30, pickCount = 5, found = [], videoId = '', durationSec = 0, videoTitle = '', typeFilter = 'All';
  wireChips('rg-cklen', 'cklen', v => { clipLen = Number(v); });
  wireChips('rg-ckcount', 'ckcount', v => { pickCount = Number(v); });
  wireChips('rg-ckfilter', 'ckfilter', v => { typeFilter = v; renderFound(); });
  let activeProg = null, curStep = 0;
  const scanRetry = () => (info) => { if (activeProg) activeProg.setStep(curStep, retryMsg(info)); };
  const PROBE_PROMPT = 'Return JSON only: {"durationSec": 0, "title": ""} — durationSec is the total length of this video in seconds (a number), title is its title. If you truly cannot tell the length, use 0.';
  const timeLine = (m) => (m.startSec != null && m.endSec != null) ? `${fmt(m.startSec)} to ${fmt(m.endSec)} · ${Math.max(1, Math.round(m.endSec - m.startSec))}s` : '—';
  const watchUrl = (m) => (videoId && m.startSec != null) ? `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(m.startSec))}s` : '';
  const shown = () => typeFilter === 'All' ? found : found.filter(m => m.type === typeFilter);
  function momentCard(m, i) {
    const wu = watchUrl(m);
    return `<div class="outcard moment"><div><span class="time">${esc(timeLine(m))}</span><h3>${esc(m.title)}</h3></div>
      <div class="score${m.score < 70 ? ' mid' : ''}">${esc(String(m.score))}</div>
      <p class="why"><span class="tag y">${esc(m.type || 'Moment')}</span> ${esc(m.why || '')}</p>
      <p class="why"><span class="tag y">Hook</span> ${esc(m.hook || '')}</p>
      ${wu ? `<p class="why"><a href="${wu}" target="_blank" rel="noopener">▶ Watch this scene</a> — verify it in the match at ${esc(fmt(m.startSec))}.</p>` : ''}
      <div class="acts"><button class="chip pickbtn${m.picked ? ' on' : ''}" data-pick="${i}">${m.picked ? '✓ Picked' : 'Pick'}</button></div></div>`;
  }
  function renderFound() {
    const host = $('ckmoments'); if (!host) return;
    const list = shown();
    host.innerHTML = list.map(m => momentCard(m, found.indexOf(m))).join('') || (found.length ? '<div class="outcard mt"><b>No moments of this type.</b><p class="small dim mt">Try the All filter — or scan more of the match.</p></div>' : '');
    host.querySelectorAll('[data-pick]').forEach(btn => btn.addEventListener('click', () => { const m = found[Number(btn.dataset.pick)]; m.picked = !m.picked; renderFound(); }));
    const sm = $('cksummary');
    if (sm) sm.innerHTML = found.length ? `<div class="spread mt2"><h2>Best moments</h2><span class="tag y">${found.length} found · ${list.length} shown</span></div>` : '';
    renderMake();
  }
  function renderMake() {
    const host = $('ckmake'); if (!host) return;
    const picks = found.filter(m => m.picked);
    host.innerHTML = found.length ? `<button class="btn block big mt" id="ckmakebtn">✦ Make ${picks.length} clips</button><div id="ckbriefhost"></div>` : '';
    const mb = $('ckmakebtn');
    if (mb) mb.addEventListener('click', renderBrief);
  }
  function briefText(picks) {
    const head = `# StreamClip AI — cricket clips production plan\nThis is the production plan for your clips — not a video file. The Watch links open each scene on YouTube.\nSource: ${videoTitle || 'Cricket video'} (https://www.youtube.com/watch?v=${videoId})\n`;
    return head + picks.map((m, i) => `## Clip ${i + 1}: ${m.title}\n- Type: ${m.type || 'Moment'}\n- Time: ${timeLine(m)} (score ${m.score})\n- Watch this scene: ${watchUrl(m) || '—'}\n- Hook: ${m.hook || '—'}\n- Why it works: ${m.why || '—'}`).join('\n\n');
  }
  function renderBrief() {
    const host = $('ckbriefhost'); if (!host) return;
    const picks = found.filter(m => m.picked);
    if (!picks.length) { host.innerHTML = '<div class="outcard mt"><b>No moments picked.</b><p class="small dim mt">Pick at least one moment above first.</p></div>'; return; }
    host.innerHTML = `<h3 class="mt2">Your clips plan — ${picks.length} picked</h3>` + picks.map((m) => `<div class="outcard"><div class="spread"><b>${esc(m.title)}</b><span class="tag y">${esc(timeLine(m))}</span></div>
      <p class="small dim mt">${esc(m.type || 'Moment')} · Score ${m.score}${watchUrl(m) ? ` · <a href="${watchUrl(m)}" target="_blank" rel="noopener">▶ Watch this scene</a>` : ''}</p>
      <p class="small mt"><b>Hook:</b> ${esc(m.hook || '—')}<br><b>Why it works:</b> ${esc(m.why || '—')}</p></div>`).join('') +
      `<div class="note mt"><div><b>Render step.</b><div class="small dim">These briefs are the production plan for your clips. The final downloadable videos are made in the render step — this website does not run a render engine yet, so nothing here fakes a finished file. The Watch links open each scene on YouTube.</div></div></div>
      <div class="btns two mt"><button class="btn sm" id="ckcopybrief">Copy plan</button><button class="btn dark sm" id="ckdlbrief">Download plan (.md)</button></div>`;
    on('ckcopybrief', 'click', () => copyText(briefText(picks), 'Plan copied.'));
    on('ckdlbrief', 'click', () => download('cricket-clips-plan.md', briefText(picks), 'text/markdown'));
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function finishPick(count, minScore) {
    found.sort((a, b) => b.score - a.score);
    let n = 0;
    for (const m of found) { m.picked = m.score >= minScore && n < count; if (m.picked) n++; }
  }
  async function scanWindow(url, s, en) {
    return geminiYouTubeJson(url, `You are a top cricket clipper. Watch ONLY the segment of this cricket match/highlights video you were given (it starts at ${fmt(s)} of the full video). Hunt for the moments cricket fans clip: wickets (bowled, LBW, run-outs, great catches), SIXES, FOURS, stunning fielding, funny moments (crowd, celebrations, commentary gold, on-field banter) and turning points. Aim for moments about ${clipLen} seconds long — start a few seconds BEFORE the ball is bowled so the clip has its build-up.
Return JSON only:
{"beyondEnd": false, "moments": [{"startSec": 0, "endSec": 0, "score": 0, "type": "Wicket", "title": "...", "hook": "...", "why": "..."}]}
type is exactly one of: Wicket, Six, Four, Catch, Funny, Moment. startSec/endSec are seconds FROM THE START OF THIS SEGMENT. score is a strict clip-worthiness score 0-99. title max 60 chars and names the player/event if visible. hook is 3-7 punchy words. why is one short line. Skip replays of moments already shown live, studio talk, ad breaks and dead overs with nothing happening. If this segment is past the end of the video, return {"beyondEnd": true, "moments": []}.`, { startSec: s, endSec: en, onRetry: scanRetry() });
  }
  function addMoments(list, base) {
    let added = 0, dropped = 0;
    const TYPES = ['Wicket', 'Six', 'Four', 'Catch', 'Funny', 'Moment'];
    for (const m of (list || [])) {
      const st = base + (parseTs(m.startSec) || 0);
      let en = m.endSec != null ? base + (parseTs(m.endSec) || 0) : null;
      if (durationSec > 0 && st >= durationSec) { dropped++; continue; }
      if (durationSec > 0 && en != null && en > durationSec) en = durationSec;
      found.push({ startSec: st, endSec: en, score: Math.max(0, Math.min(99, Number(m.score) || 0)), type: TYPES.includes(m.type) ? m.type : 'Moment', title: m.title || 'Moment', hook: m.hook || '', why: m.why || '', picked: false });
      added++;
    }
    return { added, dropped };
  }
  on('ckscan', 'click', async (e) => {
    if (!requireKey()) return;
    const url = $('cklink').value.trim();
    const id = ytId(url);
    if (!id) { toast('Paste a YouTube cricket match or highlights link first.', true); return; }
    videoId = id;
    const b = e.currentTarget; busy(b, true);
    found = []; durationSec = 0; videoTitle = ''; renderFound();
    const prog = makeProgress($('scanprog'), ['Reading the match', 'Watching & scoring moments', 'Ranking the best', 'Ready']);
    activeProg = prog; curStep = 0;
    try {
      try {
        const probe = await geminiYouTubeJson(url, PROBE_PROMPT, { timeoutMs: 120000, onRetry: scanRetry() });
        durationSec = Number(probe.durationSec) || 0;
        videoTitle = probe.title || '';
      } catch { /* probe is best-effort; windows below still run */ }
      curStep = 1;
      prog.setStep(1, videoTitle ? `Match found: ${videoTitle}${durationSec ? ` · ${fmt(durationSec)} long` : ''}` : 'Watching & scoring moments');
      const WIN = 600;
      const total = durationSec > 0 ? Math.min(durationSec, 4 * 3600) : 3600;
      const winsTotal = Math.max(1, Math.ceil(total / WIN));
      let beyond = false, droppedTotal = 0, prevErr = null;
      for (let k = 0; k < winsTotal && !beyond; k++) {
        if (k > 0) await breather(prevErr);
        const s = k * WIN, en = Math.min(total, s + WIN);
        prog.setStep(1, `Watching ${fmt(s)} – ${fmt(en)} (window ${k + 1} of ${winsTotal})`);
        prog.setFraction(k / winsTotal);
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
          prog.setStep(1, `Window ${k + 1} could not be watched (${err.message}) — continuing…`);
        }
      }
      curStep = 2;
      prog.setStep(2, `Watched the match — ${found.length} moments found${droppedTotal ? ` · Ignored ${droppedTotal} moment${droppedTotal > 1 ? 's' : ''} past the video's end` : ''}`);
      finishPick(pickCount, Number($('ckmin').value));
      renderFound();
      prog.setStep(2, `Best ${found.filter(m => m.picked).length} moments pre-picked (score ≥ ${$('ckmin').value})`);
      if (found.length) saveWork('cricket', videoTitle || 'Cricket scan', { found, videoId, videoTitle, durationSec });
      prog.done();
      if (!found.length) toast('Gemini watched it but found no strong cricket moments. Highlights videos usually score better than full match replays.', true);
    } catch (err) {
      prog.fail(err.message);
      toast('Cricket scan failed: ' + err.message + ' — private/age-restricted or very long videos can fail.', true);
    }
    activeProg = null;
    busy(b, false, '✦ Find cricket moments');
  });
  const savedCk = workFor('cricket');
  if (savedCk && savedCk.payload && (savedCk.payload.found || []).length) {
    found = savedCk.payload.found; videoId = savedCk.payload.videoId || ''; videoTitle = savedCk.payload.videoTitle || ''; durationSec = savedCk.payload.durationSec || 0;
    renderFound();
  }
}

/* ---------- News Card Maker ----------
 * Headline + details in → a TV-style breaking-news card drawn on canvas
 * (no key needed for the card itself), plus AI headline variants and a
 * posting caption when a key is present. Red band, yellow stripe — the
 * colours this site allows itself. */
if (tool === 'newscard') {
  let size = 'sq';
  wireChips('rg-ncsize', 'ncsize', v => { size = v; drawCard(); });
  const CATS = { Breaking: ['BREAKING NEWS', 'بریکنگ نیوز'], Politics: ['POLITICS', 'سیاست'], Sports: ['SPORTS', 'کھیل'], Weather: ['WEATHER', 'موسم'], Showbiz: ['SHOWBIZ', 'شوبز'] };
  function drawCard() {
    const cv = $('nccanvas'); if (!cv) return;
    const W = size === 'sq' ? 1080 : 1200, H = size === 'sq' ? 1080 : 628;
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const urdu = $('nclang').value === 'Urdu';
    const cat = CATS[$('nccat').value] || CATS.Breaking;
    const bandLabel = urdu ? cat[1] : cat[0];
    const headline = $('ncheadline').value.trim() || (urdu ? 'یہاں سرخی لکھیں' : 'Your headline goes here');
    const details = $('ncdetails').value.trim();
    const channel = $('ncchannel').value.trim() || 'Your Channel';
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    // Red top band + yellow stripe
    const bandH = Math.round(H * 0.16);
    ctx.fillStyle = '#d92b20'; ctx.fillRect(0, 0, W, bandH);
    ctx.fillStyle = '#fcd81b'; ctx.fillRect(0, bandH, W, Math.round(H * 0.022));
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${Math.round(bandH * 0.52)}px Arial, sans-serif`;
    ctx.textAlign = urdu ? 'right' : 'left';
    ctx.direction = urdu ? 'rtl' : 'ltr';
    ctx.fillText(bandLabel, urdu ? W - 44 : 44, bandH * 0.68);
    ctx.direction = 'ltr';
    // Headline
    const pad = 48, maxW = W - pad * 2;
    const head = fitLines(ctx, headline, maxW, size === 'sq' ? 92 : 72, 40, size === 'sq' ? 5 : 3, 900);
    ctx.fillStyle = '#171408';
    ctx.textAlign = urdu ? 'right' : 'left';
    ctx.direction = urdu ? 'rtl' : 'ltr';
    let y = bandH + Math.round(H * 0.07) + head.px;
    for (const ln of head.lines) { ctx.fillText(ln, urdu ? W - pad : pad, y); y += head.px * 1.18; }
    // Details
    if (details) {
      const det = fitLines(ctx, details, maxW, size === 'sq' ? 44 : 36, 26, size === 'sq' ? 6 : 3, 500);
      ctx.fillStyle = '#454033';
      y += Math.round(H * 0.03);
      for (const ln of det.lines) { ctx.fillText(ln, urdu ? W - pad : pad, y); y += det.px * 1.3; }
    }
    ctx.direction = 'ltr';
    // Bottom black bar: channel in yellow + date
    const barH = Math.round(H * 0.11);
    ctx.fillStyle = '#171408'; ctx.fillRect(0, H - barH, W, barH);
    ctx.fillStyle = '#fcd81b';
    ctx.font = `800 ${Math.round(barH * 0.42)}px Arial, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(channel, 44, H - barH * 0.36);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.font = `600 ${Math.round(barH * 0.34)}px Arial, sans-serif`;
    ctx.fillText(new Date().toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }), W - 44, H - barH * 0.38);
    const host = $('ncpreview');
    if (host && !host.contains(cv)) host.appendChild(cv);
  }
  ['ncheadline', 'ncdetails', 'ncchannel'].forEach(id => on(id, 'input', drawCard));
  on('nccat', 'change', drawCard);
  on('nclang', 'change', drawCard);
  drawCard();
  on('ncdownload', 'click', () => { drawCard(); downloadCanvas($('nccanvas'), 'news-card.png'); toast('News card downloaded.'); });
  on('ncai', 'click', async (e) => {
    if (!requireKey()) return;
    const headline = $('ncheadline').value.trim();
    if (headline.length < 8) { toast('Write the headline first — the variants are built from it.', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const d = await geminiJson(`You are a news editor for social media. Headline: "${headline}". Details: "${$('ncdetails').value.trim().slice(0, 800)}". Language: ${$('nclang').value}. Category: ${$('nccat').value}.
Return JSON only: {"variants":["headline variant 1","variant 2","variant 3"],"caption":"a posting caption for this news card, 1-2 lines, with 3-5 hashtags"}
Variants: same facts, three different angles (straight / urgent / curiosity). Never add facts that are not in the headline or details. Write in the chosen language.`, { bulk: true, temperature: 0.7, onRetry: retryNote(b) });
      const variants = d.variants || [];
      out('ncresult', `<div class="outcard"><b>Headline variants</b>${variants.map((v, i) => `<div class="spread mt"><p class="small">${esc(v)}</p><button class="chip" data-ncuse="${i}">Use this</button></div>`).join('')}
        <div class="outcard" style="box-shadow:none"><b>Posting caption</b><p class="small mt" style="white-space:pre-wrap">${esc(d.caption || '')}</p><button class="chip mt" id="nccopycap">Copy caption</button></div></div>`);
      document.querySelectorAll('[data-ncuse]').forEach(btn => btn.addEventListener('click', () => { $('ncheadline').value = variants[Number(btn.dataset.ncuse)]; drawCard(); toast('Headline on the card updated.'); }));
      on('nccopycap', 'click', () => copyText(d.caption || '', 'Caption copied.'));
      saveWork('newscard', headline, { variants, caption: d.caption || '' });
    } catch (err) { toast(err.message, true); }
    busy(b, false, 'Improve with AI — variants + caption');
  });
  const savedNc = workFor('newscard');
  if (savedNc && savedNc.payload && (savedNc.payload.variants || []).length) {
    out('ncresult', `<div class="outcard"><b>Your last headline variants</b>${savedNc.payload.variants.map(v => `<p class="small mt">${esc(v)}</p>`).join('')}<p class="small mt"><b>Caption:</b> ${esc(savedNc.payload.caption || '')}</p></div>`);
  }
}

/* ---------- Voice Changer Dub ----------
 * Honest by design: Gemini cannot filter a recording into another voice.
 * What this tool does — and says on the page — is: transcribe your line,
 * then an AI character voice SPEAKS it. Your recording is never altered;
 * the line is re-voiced. */
if (tool === 'voicechanger') {
  const CHARS = {
    oldman: { voice: 'Charon', label: 'Old man', style: 'a slow, frail elderly man with a slightly shaky voice' },
    child: { voice: 'Puck', label: 'Child-like', style: 'a cheerful young child, high-pitched and playful' },
    villain: { voice: 'Fenrir', label: 'Villain', style: 'a deep, slow, menacing movie villain' },
    anchor: { voice: 'Callirrhoe', label: 'News anchor', style: 'a confident television news anchor, clear and formal' },
    woman: { voice: 'Aoede', label: 'Woman', style: 'a warm, natural adult woman' },
    man: { voice: 'Orus', label: 'Man', style: 'a friendly, natural adult man' },
  };
  let charKey = 'villain';
  wireChips('rg-vcchar', 'vcchar', v => { charKey = v; });
  let recBlob = null, recorder = null, recChunks = [], recording = false;
  async function transcribeBlob(blob, name) {
    const file = blob instanceof File ? blob : new File([blob], name || 'line.webm', { type: blob.type || 'audio/webm' });
    if (file.size > 18 * 1024 * 1024) throw new Error('That file is over the ~18 MB browser limit. Use a shorter clip.');
    const part = await fileToInline(file);
    const d = await geminiPartsJson([part, { text: 'Transcribe the spoken words in this audio/video EXACTLY as spoken — the words only, no timestamps, no speaker labels, no commentary. Return JSON only: {"text":"..."} If nothing is spoken, return {"text":""}.' }], { temperature: 0.1 });
    return String(d.text || '').trim();
  }
  on('vcrec', 'click', async (e) => {
    const b = e.currentTarget;
    if (recording && recorder) { recorder.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recChunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (ev) => { if (ev.data.size) recChunks.push(ev.data); };
      recorder.onstop = async () => {
        recording = false;
        stream.getTracks().forEach(t => t.stop());
        b.textContent = '🎙 Record your line';
        recBlob = new Blob(recChunks, { type: recorder.mimeType || 'audio/webm' });
        const st = $('vcstatus'); if (st) st.textContent = 'Recorded. Now tap "Read my line" — or record again to replace it.';
      };
      recorder.start();
      recording = true;
      b.textContent = '⏹ Stop recording';
      const st = $('vcstatus'); if (st) st.textContent = 'Recording… speak your line, then tap Stop.';
    } catch { toast('Microphone not available — allow mic access, or upload a file instead.', true); }
  });
  on('vcfile', 'change', () => {
    const f = $('vcfile').files[0];
    if (f) { recBlob = f; const st = $('vcstatus'); if (st) st.textContent = `Loaded: ${f.name}. Now tap "Read my line".`; }
  });
  on('vcread', 'click', async (e) => {
    if (!requireKey()) return;
    if (!recBlob) { toast('Record your line or upload a short audio/video file first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const text = await transcribeBlob(recBlob, 'line.webm');
      if (!text) throw new Error('No speech could be heard in that recording. Try again, closer to the mic.');
      $('vctext').value = text;
      toast('Line read — check the words, fix any mistake, then re-voice it.');
    } catch (err) { toast(err.message, true); }
    busy(b, false, 'Read my line');
  });
  on('vcgo', 'click', async (e) => {
    if (!requireKey()) return;
    const line = $('vctext').value.trim();
    if (line.length < 2) { toast('There is no line to voice yet — record and read one first, or type it.', true); return; }
    const ch = CHARS[charKey] || CHARS.villain;
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), [`Voicing as: ${ch.label}`, 'Ready']);
    try {
      const blob = await geminiTTS(`Say in the voice of ${ch.style}: ${line}`, ch.voice, { onRetry: (info) => prog.setStep(0, retryMsg(info)) });
      const url = URL.createObjectURL(blob);
      out('vcresult', `<div class="outcard"><div class="spread"><b>Your line — as the ${esc(ch.label)}</b><span class="tag y">AI voice</span></div>
        <p class="small dim mt">"${esc(line)}"</p>
        <audio controls src="${url}" style="width:100%" class="mt"></audio>
        <a class="btn dark sm mt" href="${url}" download="revoiced-line.wav">Download the voice (.wav)</a>
        <p class="small dim mt">This is an AI voice speaking your line — your own recording was only used to read the words.</p></div>`);
      saveWork('voicechanger', line.slice(0, 60), { text: line, char: ch.label });
      prog.done();
    } catch (err) { prog.fail(err.message); toast(err.message, true); }
    busy(b, false, 'Re-voice my line');
  });
  const savedVc = workFor('voicechanger');
  if (savedVc && savedVc.payload && savedVc.payload.text) {
    out('vcresult', `<div class="outcard"><b>Your last line</b><p class="small mt">"${esc(savedVc.payload.text)}" — voiced as the ${esc(savedVc.payload.char || '')}. The audio is not kept; re-voice it above any time.</p></div>`);
    if (!$('vctext').value) $('vctext').value = savedVc.payload.text;
  }
}

/* ---------- Subtitle Burner Pack ----------
 * One video → a bilingual subtitle pack ready for the render step: an SRT
 * per language, a combined bilingual SRT, and a styled .ass whose main
 * line is big and the second language sits smaller beneath it. Timing is
 * segment-level (the AI's), labelled as such — same honesty as Auto
 * Captions. */
if (tool === 'subburner') {
  let segments = []; // {start,end,text} in the video's spoken language
  let sourceName = '';
  async function getSegmentsFromUpload(file) {
    if (file.size > 18 * 1024 * 1024) throw new Error('That file is over the ~18 MB browser limit. Use a shorter video, or the YouTube link tab.');
    const part = await fileToInline(file);
    const d = await geminiPartsJson([part, { text: 'Watch this video and transcribe the spoken words as subtitle segments. Return JSON only: {"segments":[{"start":0,"end":0,"text":"..."}]} — start/end in seconds, each segment one subtitle line (max ~14 words), in the language actually spoken. If nothing is spoken, return {"segments":[]}.' }], { temperature: 0.2, timeoutMs: 240000 });
    return (d.segments || []).map(s => ({ start: Number(s.start) || 0, end: Math.max(Number(s.end) || 0, (Number(s.start) || 0) + 1), text: String(s.text || '').trim() })).filter(s => s.text);
  }
  async function getSegmentsFromYouTube(url) {
    const d = await geminiYouTubeJson(url, `Watch this video and transcribe the spoken words as subtitle segments for roughly the first 30 minutes. Return JSON only: {"segments":[{"start":0,"end":0,"text":"..."}]} — start/end in seconds, each segment one subtitle line (max ~14 words), in the language actually spoken. If nothing is spoken, return {"segments":[]}.`, { timeoutMs: 240000 });
    return (d.segments || []).map(s => ({ start: Number(s.start) || 0, end: Math.max(Number(s.end) || 0, (Number(s.start) || 0) + 1), text: String(s.text || '').trim() })).filter(s => s.text);
  }
  async function translateSegments(segs, targetLang, prog, stepIdx) {
    // Translate in chunks of 25 lines per call, bulk (lite-first) models.
    const outSegs = segs.map(s => ({ ...s }));
    const CH = 25;
    for (let i = 0; i < segs.length; i += CH) {
      const slice = segs.slice(i, i + CH);
      const d = await geminiJson(`Translate these subtitle lines into ${targetLang}. Keep each line short and subtitle-style (spoken language, not book language). Return JSON only: {"lines":["..."]} — exactly ${slice.length} lines, in the same order, nothing else.\n${slice.map((s, j) => `${j + 1}. ${s.text}`).join('\n')}`, { bulk: true, temperature: 0.3 });
      (d.lines || []).forEach((t, j) => { if (outSegs[i + j]) outSegs[i + j].text = String(t || '').trim() || outSegs[i + j].text; });
      if (prog) { prog.setStep(stepIdx); prog.setFraction(Math.min(1, (i + CH) / segs.length)); }
      if (i + CH < segs.length) await breather(null);
    }
    return outSegs;
  }
  function assTime(sec) {
    sec = Math.max(0, Number(sec) || 0);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60), cs = Math.round((sec - Math.floor(sec)) * 100);
    const p = (n) => String(n).padStart(2, '0');
    return `${h}:${p(m)}:${p(s)}.${p(cs)}`;
  }
  function buildAss(main, second) {
    const head = `[Script Info]
Title: StreamClip AI bilingual subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,Arial,64,&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,0,2,40,40,120,1
Style: Second,Arial,44,&H0000FFFF,&H0000FFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,0,2,40,40,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
    const clean = (t) => String(t || '').replace(/\n/g, ' ').replace(/,/g, '،');
    const lines = main.map((s, i) => {
      const sec = second && second[i] ? `{\\rSecond}${clean(second[i].text)}` : '';
      const txt = second && second[i] ? `${clean(s.text)}\\N${sec}` : clean(s.text);
      return `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Main,,0,0,0,,${txt}`;
    });
    return head + lines.join('\n') + '\n';
  }
  on('sbgo', 'click', async (e) => {
    if (!requireKey()) return;
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Reading the video', 'Writing the main subtitles', 'Translating the second language', 'Building the pack', 'Ready']);
    try {
      prog.setStep(0);
      if ($('sbmode-yt').classList.contains('on')) {
        const url = $('sblink').value.trim();
        if (!ytId(url)) { toast('Paste a YouTube link first.', true); busy(b, false, 'Make my subtitle pack'); return; }
        segments = await getSegmentsFromYouTube(url);
        sourceName = 'YouTube video';
      } else {
        const f = $('sbfile').files[0];
        if (!f) { toast('Choose a video file first.', true); busy(b, false, 'Make my subtitle pack'); return; }
        segments = await getSegmentsFromUpload(f);
        sourceName = f.name;
      }
      if (!segments.length) throw new Error('No speech was found in that video.');
      const lang1 = $('sblang1').value, lang2 = $('sblang2').value;
      prog.setStep(1, `${segments.length} subtitle lines found — writing the ${lang1} track`);
      const mainSegs = lang1 === 'Original language' ? segments : await translateSegments(segments, lang1, prog, 1);
      prog.setStep(2, `Translating into ${lang2}`);
      const secondSegs = await translateSegments(segments, lang2, prog, 2);
      prog.setStep(3);
      const srtMain = cuesToSrt(mainSegs.map(s => ({ start: s.start, end: s.end, text: s.text })));
      const srtSecond = cuesToSrt(secondSegs.map(s => ({ start: s.start, end: s.end, text: s.text })));
      const both = mainSegs.map((s, i) => ({ start: s.start, end: s.end, text: `${s.text}\n${secondSegs[i] ? secondSegs[i].text : ''}` }));
      const srtBoth = cuesToSrt(both);
      const ass = buildAss(mainSegs, secondSegs);
      out('sbresult', `<div class="outcard"><div class="spread"><b>Bilingual subtitle pack</b><span class="tag y">${segments.length} lines</span></div>
        <p class="small dim mt">Main: ${esc(lang1)} · Second: ${esc(lang2)} · Source: ${esc(sourceName)}. Give the styled .ass to the render step and both languages burn onto the video together — main line big, second line smaller beneath it.</p>
        <div class="btns two mt">
        <button class="btn sm" id="sbdl1">Download ${esc(lang1)} (.srt)</button>
        <button class="btn sm" id="sbdl2">Download ${esc(lang2)} (.srt)</button>
        <button class="btn sm" id="sbdlboth">Download bilingual (.srt)</button>
        <button class="btn dark sm" id="sbdlass">Download styled (.ass)</button>
        </div>
        <p class="small dim mt">Timing is segment-level — set by the AI from the speech, not measured word by word. Check a few lines against the video before a big upload.</p></div>`);
      on('sbdl1', 'click', () => download('subtitles-main.srt', srtMain, 'text/plain'));
      on('sbdl2', 'click', () => download('subtitles-second.srt', srtSecond, 'text/plain'));
      on('sbdlboth', 'click', () => download('subtitles-bilingual.srt', srtBoth, 'text/plain'));
      on('sbdlass', 'click', () => download('subtitles-styled.ass', ass, 'text/plain'));
      saveWork('subburner', sourceName, { segments: segments.slice(0, 100), lang1, lang2 });
      prog.done();
    } catch (err) { prog.fail(err.message); toast(err.message, true); }
    busy(b, false, 'Make my subtitle pack');
  });
  const setSbMode = (yt) => {
    $('sbmode-yt').classList.toggle('on', yt);
    $('sbmode-up').classList.toggle('on', !yt);
    $('panel-sb-yt').classList.toggle('hidden', !yt);
    $('panel-sb-upload').classList.toggle('hidden', yt);
  };
  on('sbmode-yt', 'click', () => setSbMode(true));
  on('sbmode-up', 'click', () => setSbMode(false));
  const savedSb = workFor('subburner');
  if (savedSb && savedSb.payload && (savedSb.payload.segments || []).length) {
    out('sbresult', `<div class="outcard"><b>Your last subtitle pack</b><p class="small mt">${savedSb.payload.segments.length} lines · Main: ${esc(savedSb.payload.lang1 || '')} · Second: ${esc(savedSb.payload.lang2 || '')}. The files themselves are not kept — run the maker again to rebuild the downloads.</p></div>`);
  }
}

/* ---------- Podcast-to-Posts ----------
 * One podcast/interview link → a week of posts: 3 quote cards (canvas),
 * a summary post, a numbered thread, and the top 3 clip moments. The scan
 * collects real quotes window by window, then one compose call writes the
 * posts from those quotes and notes — nothing is invented at compose time
 * beyond arranging what the episode actually said. */
if (tool === 'podposts') {
  let pack = null;
  function drawQuoteCard(q, showTitle) {
    const cv = document.createElement('canvas');
    cv.width = 1080; cv.height = 1080;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1080, 1080);
    ctx.fillStyle = '#fcd81b'; ctx.fillRect(0, 0, 1080, 150);
    ctx.fillStyle = '#171408';
    ctx.font = '900 64px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('“', 56, 105);
    ctx.font = '700 34px Arial, sans-serif';
    ctx.fillText('SAID ON THE PODCAST', 140, 96);
    const body = fitLines(ctx, q.text, 1080 - 140, 62, 34, 9, 700);
    ctx.fillStyle = '#171408';
    let y = 300 + body.px;
    for (const ln of body.lines) { ctx.fillText(ln, 70, y); y += body.px * 1.25; }
    ctx.fillStyle = '#d92b20'; ctx.fillRect(70, y + 10, 120, 10);
    ctx.fillStyle = '#454033';
    ctx.font = '700 38px Arial, sans-serif';
    ctx.fillText(q.speaker || 'Guest', 70, y + 90);
    ctx.font = '500 30px Arial, sans-serif';
    ctx.fillStyle = '#7d7663';
    ctx.fillText(showTitle || '', 70, 1080 - 56);
    return cv;
  }
  function renderPack() {
    const host = $('ppresult'); if (!host || !pack) return;
    host.innerHTML = `<div class="spread mt2"><h3>Your post pack</h3><span class="tag y">${esc(pack.videoTitle || 'Podcast')}</span></div>
      <div class="outcard"><b>Quote cards</b><div id="ppcards" class="mt"></div></div>
      <div class="outcard"><div class="spread"><b>Summary post</b><button class="chip" id="ppcopysum">Copy</button></div><p class="small mt" style="white-space:pre-wrap">${esc(pack.summary || '')}</p></div>
      <div class="outcard"><div class="spread"><b>Thread</b><button class="chip" id="ppcopythread">Copy thread</button></div>${(pack.thread || []).map((t, i) => `<p class="small mt"><b>${i + 1}.</b> ${esc(t)}</p>`).join('')}</div>
      <div class="outcard"><b>Top clip moments</b>${(pack.moments || []).map(m => `<p class="small mt"><span class="tag y">${esc(fmt(m.startSec || 0))}</span> ${esc(m.title || '')} — <a href="https://www.youtube.com/watch?v=${pack.videoId}&t=${Math.floor(m.startSec || 0)}s" target="_blank" rel="noopener">▶ Watch this scene</a></p>`).join('') || '<p class="small mt">No moments were scored in the scanned part.</p>'}</div>`;
    const cardsHost = $('ppcards');
    (pack.quotes || []).slice(0, 3).forEach((q, i) => {
      const cv = drawQuoteCard(q, pack.videoTitle);
      const wrap = document.createElement('div');
      wrap.className = 'outcard'; wrap.style.boxShadow = 'none';
      const img = document.createElement('img');
      img.className = 'prev'; img.alt = `Quote card ${i + 1}`; img.src = cv.toDataURL('image/png');
      const btn = document.createElement('button');
      btn.className = 'btn dark sm mt'; btn.textContent = `Download quote card ${i + 1}`;
      btn.addEventListener('click', () => downloadCanvas(cv, `quote-card-${i + 1}.png`));
      wrap.appendChild(img); wrap.appendChild(btn);
      cardsHost.appendChild(wrap);
    });
    on('ppcopysum', 'click', () => copyText(pack.summary || '', 'Summary post copied.'));
    on('ppcopythread', 'click', () => copyText((pack.thread || []).map((t, i) => `${i + 1}/ ${t}`).join('\n\n'), 'Thread copied.'));
  }
  on('ppgo', 'click', async (e) => {
    if (!requireKey()) return;
    const url = $('pplink').value.trim();
    const id = ytId(url);
    if (!id) { toast('Paste a YouTube podcast or interview link first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Reading the episode', 'Collecting quotes & moments', 'Writing the posts', 'Ready']);
    try {
      let durationSec = 0, videoTitle = '';
      try {
        const probe = await geminiYouTubeJson(url, 'Return JSON only: {"durationSec": 0, "title": ""} — durationSec is the total length of this video in seconds (a number), title is its title. If you truly cannot tell the length, use 0.', { timeoutMs: 120000, onRetry: (info) => prog.setStep(0, retryMsg(info)) });
        durationSec = Number(probe.durationSec) || 0;
        videoTitle = probe.title || '';
      } catch { /* best-effort */ }
      prog.setStep(1);
      const WIN = 600;
      const total = Math.min(durationSec > 0 ? durationSec : 3600, 3600); // first hour is plenty for a post pack
      const wins = Math.max(1, Math.ceil(total / WIN));
      const quotes = [], moments = [], notes = [];
      let prevErr = null;
      for (let k = 0; k < wins; k++) {
        if (k > 0) await breather(prevErr);
        const s = k * WIN, en = Math.min(total, s + WIN);
        prog.setStep(1, `Listening ${fmt(s)} – ${fmt(en)} (part ${k + 1} of ${wins})`);
        prog.setFraction(k / wins);
        try {
          const d = await geminiYouTubeJson(url, `Listen to ONLY this segment of a podcast/interview (it starts at ${fmt(s)} of the full episode). Collect material for social posts. Return JSON only:
{"quotes":[{"text":"an exact, quotable line someone said — punchy and self-contained","speaker":"who said it, if you can tell, else 'Guest'","atSec":0}],"moments":[{"startSec":0,"score":0,"title":"..."}],"notes":"2-3 sentences: the main points made in this segment"}
atSec/startSec are seconds FROM THE START OF THIS SEGMENT. Quotes must be real lines from this segment — never invent or polish them into different words. moments: the 2 most clippable moments, score 0-99. If this segment is past the end, return {"quotes":[],"moments":[],"notes":""}.`, { startSec: s, endSec: en, onRetry: (info) => prog.setStep(1, retryMsg(info)) });
          (d.quotes || []).forEach(q => { if (q && q.text) quotes.push({ text: q.text, speaker: q.speaker || 'Guest', atSec: s + (Number(q.atSec) || 0) }); });
          (d.moments || []).forEach(m => { if (m) moments.push({ startSec: s + (Number(m.startSec) || 0), score: Number(m.score) || 0, title: m.title || 'Moment' }); });
          if (d.notes) notes.push(d.notes);
          prevErr = null;
        } catch (err) { prevErr = err; if (k === 0) throw err; }
        prog.setFraction((k + 1) / wins);
      }
      if (!quotes.length && !notes.length) throw new Error('Nothing quotable was found in the scanned part. Try a talk-heavier episode.');
      quotes.sort((a, b2) => (b2.text.length > 40) - (a.text.length > 40));
      moments.sort((a, b2) => b2.score - a.score);
      prog.setStep(2);
      const topQuotes = quotes.slice(0, 3);
      const comp = await geminiJson(`You turn one podcast episode into social posts. Episode: "${videoTitle}". Language for the posts: ${$('pplang').value}.
Real quotes collected from the episode:
${topQuotes.map(q => `- "${q.text}" — ${q.speaker}`).join('\n')}
Episode notes:
${notes.join(' ').slice(0, 4000)}
Return JSON only:
{"summary":"one summary post (3-5 lines) about what this episode teaches, ending with a question to the audience, plus 3-4 hashtags","thread":["post 1 — the hook, built on the strongest idea","post 2","post 3","post 4","post 5 — the takeaway + a question"]}
Write ONLY from the quotes and notes above — no new claims about the episode. Thread posts: each under 280 characters, numbered feel, no hashtags inside except the last post.`, { bulk: true, temperature: 0.7, onRetry: (info) => prog.setStep(2, retryMsg(info)) });
      pack = { videoId: id, videoTitle, quotes: topQuotes, summary: comp.summary || '', thread: comp.thread || [], moments: moments.slice(0, 3) };
      renderPack();
      saveWork('podposts', videoTitle || 'Podcast posts', pack);
      prog.done();
    } catch (err) { prog.fail(err.message); toast(err.message, true); }
    busy(b, false, 'Make my post pack');
  });
  const savedPp = workFor('podposts');
  if (savedPp && savedPp.payload) { pack = savedPp.payload; renderPack(); }
}

/* ---------- Ramadan / Eid Content Kit ----------
 * Seasonal pack: a set of 7 dua cards (canvas), a sehri/iftar (or Eid /
 * Jumma) reminder script voiced by the AI, and a greeting card carrying
 * the visitor's name. Dua texts are AI-drafted — the page says plainly to
 * verify them against a trusted source before posting. */
if (tool === 'ramadankit') {
  voiceOptions($('rkvoice'));
  let packName = 'ramadan';
  wireChips('rg-rkpack', 'rkpack', v => { packName = v; });
  const PACK_LABEL = { ramadan: 'Ramadan — daily duas', eid: 'Eid greetings & duas', jumma: 'Jumma — Friday pack' };
  function drawDuaCard(card, i) {
    const cv = document.createElement('canvas');
    cv.width = 1080; cv.height = 1350;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1080, 1350);
    ctx.fillStyle = '#fcd81b'; ctx.fillRect(0, 0, 1080, 170);
    ctx.fillStyle = '#171408';
    ctx.font = '900 54px Arial, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`DAY ${i + 1}`, 60, 108);
    ctx.font = '700 30px Arial, sans-serif'; ctx.fillStyle = '#454033';
    ctx.fillText(PACK_LABEL[packName] || 'Dua card', 320, 106);
    let y = 300;
    if (card.arabic) {
      const ar = fitLines(ctx, card.arabic, 1080 - 120, 56, 34, 6, 700);
      ctx.fillStyle = '#171408'; ctx.textAlign = 'right'; ctx.direction = 'rtl';
      for (const ln of ar.lines) { ctx.fillText(ln, 1080 - 60, y); y += ar.px * 1.5; }
      ctx.direction = 'ltr'; ctx.textAlign = 'left';
      y += 30;
    }
    ctx.fillStyle = '#171408';
    ctx.font = '800 44px Arial, sans-serif';
    const tt = wrapLines(ctx, card.title || 'Dua', 1080 - 120);
    for (const ln of tt) { ctx.fillText(ln, 60, y); y += 56; }
    y += 14;
    const tr = fitLines(ctx, card.translation || '', 1080 - 120, 40, 28, 10, 500);
    ctx.fillStyle = '#454033';
    for (const ln of tr.lines) { ctx.fillText(ln, 60, y); y += tr.px * 1.35; }
    ctx.fillStyle = '#d92b20'; ctx.fillRect(60, 1350 - 130, 120, 10);
    ctx.fillStyle = '#7d7663'; ctx.font = '600 28px Arial, sans-serif';
    ctx.fillText('StreamClip AI — Ramadan / Eid Content Kit', 60, 1350 - 66);
    return cv;
  }
  function drawGreeting(name, greeting) {
    const cv = document.createElement('canvas');
    cv.width = 1080; cv.height = 1080;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#171408'; ctx.fillRect(0, 0, 1080, 1080);
    ctx.fillStyle = '#fcd81b'; ctx.fillRect(0, 0, 1080, 26); ctx.fillRect(0, 1080 - 26, 1080, 26);
    ctx.fillStyle = '#fcd81b'; ctx.textAlign = 'center';
    const g = fitLines(ctx, greeting || 'Eid Mubarak', 1080 - 160, 110, 54, 3, 900);
    let y = 430;
    for (const ln of g.lines) { ctx.fillText(ln, 540, y); y += g.px * 1.15; }
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 40px Arial, sans-serif';
    ctx.fillText(name ? `— ${name}` : '', 540, y + 70);
    return cv;
  }
  let kit = null;
  on('rkgo', 'click', async (e) => {
    if (!requireKey()) return;
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Writing the pack', 'Designing the dua cards', 'Making the reminder voice', 'Ready']);
    const lang = $('rklang').value;
    try {
      const brief = packName === 'ramadan'
        ? 'a Ramadan daily pack: 7 short, well-known authentic duas (one per card) for the first days of Ramadan — for sehri, iftar, forgiveness and gratitude'
        : packName === 'eid'
          ? 'an Eid pack: 7 cards of Eid duas and warm wishes (one per card) — gratitude, family, acceptance of fasts and prayers'
          : 'a Jumma (Friday) pack: 7 cards of Friday duas and reminders (one per card) — durood, forgiveness, the hour of acceptance, Surah Al-Kahf';
      const d = await geminiJson(`You prepare Islamic social-media content with care. Build ${brief}. Language for translations and scripts: ${lang}.
Return JSON only:
{"cards":[{"title":"the card's theme in ${lang}, max 6 words","arabic":"the short dua in Arabic script — only duas that are widely known and authentic; keep each under 20 words","translation":"its meaning in ${lang}, 1-2 lines"}],"reminderScript":"a warm spoken reminder script (sehri/iftar for Ramadan, Eid morning for Eid, Friday reminder for Jumma), 20-30 seconds read aloud, in ${lang}","greeting":"the main greeting text for a greeting card, e.g. 'Eid Mubarak' / 'Ramadan Mubarak' / 'Jumma Mubarak', in ${lang} or its common form"}
Rules: exactly 7 cards. Arabic must be real, well-known dua text — if unsure of a dua, use a shorter famous one rather than composing new Arabic. Translations must be faithful.`, { temperature: 0.4, onRetry: (info) => prog.setStep(0, retryMsg(info)) });
      kit = { cards: (d.cards || []).slice(0, 7), reminderScript: d.reminderScript || '', greeting: d.greeting || '' };
      if (!kit.cards.length) throw new Error('The AI reply held no cards. Try again.');
      prog.setStep(1);
      out('rkresult', `<div class="outcard"><div class="spread"><b>${esc(PACK_LABEL[packName])}</b><span class="tag y">${kit.cards.length} cards</span></div>
        <p class="small mt" style="color:var(--red)"><b>Verify before posting:</b> the dua texts are AI-drafted. Check each Arabic dua and translation against a trusted source (a Quran/hadith app or your local scholar) before you post — religious text must be exact.</p>
        <div id="rkcards" class="mt"></div>
        <div class="outcard" style="box-shadow:none"><b>Reminder script</b><p class="small mt">${esc(kit.reminderScript)}</p><div id="rkvoicehost" class="mt"><span class="spin"></span> Making the voice…</div></div>
        <div class="outcard" style="box-shadow:none"><b>Greeting card</b><div id="rkgreet" class="mt"></div></div></div>`);
      const cardsHost = $('rkcards');
      kit.cards.forEach((card, i) => {
        const cv = drawDuaCard(card, i);
        const wrap = document.createElement('div');
        wrap.className = 'outcard'; wrap.style.boxShadow = 'none';
        const img = document.createElement('img');
        img.className = 'prev'; img.alt = `Dua card ${i + 1}`; img.src = cv.toDataURL('image/png');
        const btn = document.createElement('button');
        btn.className = 'btn dark sm mt'; btn.textContent = `Download card ${i + 1}`;
        btn.addEventListener('click', () => downloadCanvas(cv, `dua-card-${i + 1}.png`));
        wrap.appendChild(img); wrap.appendChild(btn);
        cardsHost.appendChild(wrap);
      });
      const gcv = drawGreeting($('rkname').value.trim(), kit.greeting);
      const gwrap = $('rkgreet');
      const gimg = document.createElement('img');
      gimg.className = 'prev'; gimg.alt = 'Greeting card'; gimg.src = gcv.toDataURL('image/png');
      const gbtn = document.createElement('button');
      gbtn.className = 'btn dark sm mt'; gbtn.textContent = 'Download the greeting card';
      gbtn.addEventListener('click', () => downloadCanvas(gcv, 'greeting-card.png'));
      gwrap.appendChild(gimg); gwrap.appendChild(gbtn);
      prog.setStep(2);
      const vh = $('rkvoicehost');
      try {
        const blob = await geminiTTS(kit.reminderScript, $('rkvoice').value, { onRetry: retryNote(b) });
        const url = URL.createObjectURL(blob);
        if (vh) vh.innerHTML = `<audio controls src="${url}" style="width:100%"></audio><a class="btn dark sm mt" href="${url}" download="reminder-voice.wav">Download the voice (.wav)</a>`;
      } catch (err) { if (vh) vh.innerHTML = `<p class="small" style="color:var(--red)">Voice failed — ${esc(err.message)}</p>`; }
      saveWork('ramadankit', PACK_LABEL[packName], { cards: kit.cards, reminderScript: kit.reminderScript, greeting: kit.greeting, pack: packName });
      prog.done();
    } catch (err) { prog.fail(err.message); toast(err.message, true); }
    busy(b, false, 'Make my kit');
  });
  const savedRk = workFor('ramadankit');
  if (savedRk && savedRk.payload && (savedRk.payload.cards || []).length) {
    const p = savedRk.payload;
    out('rkresult', `<div class="outcard"><b>Your last kit — ${esc(p.greeting || '')}</b>${p.cards.map((c, i) => `<p class="small mt"><b>Card ${i + 1} — ${esc(c.title || '')}:</b> ${esc(c.translation || '')}</p>`).join('')}<p class="small mt"><b>Reminder script:</b> ${esc(p.reminderScript || '')}</p><p class="small dim mt">The card pictures and voice are not kept — run the maker again to regenerate them.</p></div>`);
  }
}

/* ---------- Blog Writer ----------
 * One generator with three source modes — Topic, Photo (up to 10 pictures
 * → one article each), News (a headline + details the visitor pastes).
 * StreamClip never publishes anywhere: the page states plainly that the
 * visitor downloads the draft and publishes it themselves in a minute. */
if (tool === 'blogwriter') {
  let bwMode = 'topic';
  const setBwMode = (m) => {
    bwMode = m;
    ['topic', 'photo', 'news'].forEach(x => {
      $('bwmode-' + x).classList.toggle('on', x === m);
      $('panel-bw-' + x).classList.toggle('hidden', x !== m);
    });
  };
  on('bwmode-topic', 'click', () => setBwMode('topic'));
  on('bwmode-photo', 'click', () => setBwMode('photo'));
  on('bwmode-news', 'click', () => setBwMode('news'));
  const LEN = { Short: 'about 600 words', Medium: 'about 1200 words', Long: 'about 2000 words' };
  function articleMd(a) {
    return `# ${a.title}\n\n_Meta description: ${a.meta || ''}_\n\n${a.intro || ''}\n\n${(a.sections || []).map(s => `## ${s.h}\n\n${s.body}`).join('\n\n')}${(a.faq && a.faq.length) ? `\n\n## Frequently asked questions\n\n${a.faq.map(f => `### ${f.q}\n\n${f.a}`).join('\n\n')}` : ''}\n\n## Conclusion\n\n${a.conclusion || ''}\n`;
  }
  function articleHtml(a) {
    return `<div class="outcard article"><div class="spread"><b>${esc(a.title)}</b><span class="tag y">Article</span></div>
      <p class="small dim mt"><b>Meta description:</b> ${esc(a.meta || '')}</p>
      <p class="mt">${esc(a.intro || '')}</p>
      ${(a.sections || []).map(s => `<h3 class="mt2">${esc(s.h)}</h3><p class="mt">${esc(s.body).replace(/\n/g, '<br>')}</p>`).join('')}
      ${(a.faq && a.faq.length) ? `<h3 class="mt2">Frequently asked questions</h3>${a.faq.map(f => `<div class="faq"><b>${esc(f.q)}</b><p>${esc(f.a)}</p></div>`).join('')}` : ''}
      <h3 class="mt2">Conclusion</h3><p class="mt">${esc(a.conclusion || '')}</p>
      <div class="btns two mt"><button class="btn sm" data-bwcopy>Copy article (.md)</button><button class="btn dark sm" data-bwdl>Download (.md)</button></div></div>`;
  }
  function wireArticle(host, a) {
    const cp = host.querySelector('[data-bwcopy]'), dl = host.querySelector('[data-bwdl]');
    if (cp) cp.addEventListener('click', () => copyText(articleMd(a), 'Article copied as Markdown.'));
    if (dl) dl.addEventListener('click', () => download(`${(a.title || 'article').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}.md`, articleMd(a), 'text/markdown'));
  }
  async function writeArticle(subject, extra) {
    const lang = $('bwlang').value, len = LEN[$('bwlen').value] || LEN.Medium, tone = $('bwtone').value, faq = $('bwfaq').checked;
    return geminiJson(`You are an experienced blog writer. Write a complete, genuinely useful blog article. ${extra}
Subject: ${subject}
Language: ${lang}. Length: ${len}. Tone: ${tone}.
Return JSON only:
{"title":"a clear, search-friendly title, max 70 chars","meta":"a meta description, 140-160 chars","intro":"an opening of 2-3 short paragraphs with a hook — no 'in this article we will' filler","sections":[{"h":"a descriptive H2 heading","body":"the section text — short paragraphs separated by line breaks, practical and specific"}],"faq":[${faq ? '{"q":"a real reader question","a":"a direct answer, 2-3 lines"}' : ''}],"conclusion":"a short closing with one clear takeaway"}
Rules: ${faq ? 'give exactly 4 FAQ entries' : 'faq must be an empty array'}; 4-7 sections for Medium/Long, 3-4 for Short; write from real knowledge, never invent statistics, prices or quotes; headings must describe content, not tease it. Write everything in ${lang}.`, { temperature: 0.6 });
  }
  on('bwgo', 'click', async (e) => {
    if (!requireKey()) return;
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Planning the article', 'Writing it', 'Ready']);
    try {
      if (bwMode === 'topic') {
        const topic = $('bwtopic').value.trim();
        if (topic.length < 4) { toast('Write the article topic first.', true); busy(b, false, 'Write my article'); return; }
        const a = await writeArticle(topic, `Niche: ${$('bwniche').value}.`);
        prog.setStep(1);
        out('bwresult', articleHtml(a));
        wireArticle($('bwresult'), a);
        saveWork('blogwriter', a.title, { article: a });
      } else if (bwMode === 'news') {
        const head = $('bwheadline').value.trim();
        if (head.length < 8) { toast('Paste the news headline first.', true); busy(b, false, 'Write my article'); return; }
        const a = await writeArticle(head, `This is a NEWS article. Facts available (use ONLY these — never add facts, names, numbers or quotes beyond them): ${$('bwdetails').value.trim().slice(0, 2500) || '(the headline only)'}. Write it as fresh news reporting, and where the available facts run out, describe what is being awaited rather than inventing details.`);
        prog.setStep(1);
        out('bwresult', articleHtml(a));
        wireArticle($('bwresult'), a);
        saveWork('blogwriter', a.title, { article: a });
      } else {
        const files = [...($('bwphotos').files || [])].slice(0, 10);
        if (!files.length) { toast('Choose at least one picture.', true); busy(b, false, 'Write my article'); return; }
        prog.setStep(0, `Writing ${files.length} article${files.length > 1 ? 's' : ''} — one per picture`);
        out('bwresult', files.map((f, i) => `<div class="outcard" id="bwart-${i}"><b>Picture ${i + 1} — ${esc(f.name)}</b><p class="small dim mt"><span class="spin"></span> Writing…</p></div>`).join(''));
        let prevErr = null, firstArticle = null;
        for (let i = 0; i < files.length; i++) {
          if (i > 0) await breather(prevErr);
          prog.setFraction(i / files.length);
          const host = $(`bwart-${i}`);
          try {
            const part = await fileToInline(files[i]);
            const a = await geminiPartsJson([part, { text: `Look at this picture and write a complete blog article about what it shows, for the niche: ${$('bwniche').value}. Language: ${$('bwlang').value}. Length: ${LEN[$('bwlen').value] || LEN.Medium}. Tone: ${$('bwtone').value}.
Return JSON only: {"title":"max 70 chars","meta":"140-160 chars","intro":"2-3 short paragraphs","sections":[{"h":"heading","body":"text"}],"faq":[],"conclusion":"short closing"}
Describe only what is genuinely visible or a safe, general truth about it — never invent brands, prices, places or people. ${$('bwfaq').checked ? 'Give exactly 4 FAQ entries about the pictured subject.' : 'faq must be an empty array.'}` }], { temperature: 0.6 });
            if (!firstArticle) firstArticle = a;
            if (host) { host.innerHTML = articleHtml(a); wireArticle(host, a); }
            prevErr = null;
          } catch (err) { prevErr = err; if (host) host.innerHTML = `<b>Picture ${i + 1} — ${esc(files[i].name)}</b><p class="small mt" style="color:var(--red)">Article failed — ${esc(err.message)}</p>`; }
          prog.setFraction((i + 1) / files.length);
        }
        if (firstArticle) saveWork('blogwriter', firstArticle.title, { article: firstArticle });
      }
      prog.done();
    } catch (err) { prog.fail(err.message); toast(err.message, true); }
    busy(b, false, 'Write my article');
  });
  const savedBw = workFor('blogwriter');
  if (savedBw && savedBw.payload && savedBw.payload.article) {
    out('bwresult', articleHtml(savedBw.payload.article));
    wireArticle($('bwresult'), savedBw.payload.article);
  }
}

/* ---------- Keyword Finder ----------
 * Seed in → related keywords out. Real Google autosuggest suggestions are
 * fetched when the endpoint allows it (no key needed for that part) and
 * fed to the visitor's Gemini key, which clusters and ESTIMATES intent
 * and difficulty. The estimates are labelled as estimates everywhere —
 * there is no real volume database behind a free key, and the page says
 * so, exactly like AlphaPost admits of its own numbers. */
if (tool === 'keywords') {
  let rows = [], kwCount = 20;
  wireChips('rg-kwcount', 'kwcount', v => { kwCount = Number(v); });
  async function googleSuggest(q) {
    try {
      const r = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d && d[1]) ? d[1] : [];
    } catch { return []; }
  }
  function renderRows() {
    const host = $('kwresult'); if (!host) return;
    const filter = $('kwintent').value;
    const list = filter === 'All' ? rows : rows.filter(r => r.intent === filter);
    host.innerHTML = rows.length ? `<div class="spread mt2"><h3>Keywords for "${esc($('kwseed').value.trim())}"</h3><button class="chip" id="kwcopyall">Copy all</button></div>
      <div class="outcard"><p class="small dim">Difficulty and demand are <b>AI estimates for comparison only</b> — not measured search volumes. Use them to pick what to make first, not as facts.</p>
      ${list.map(r => `<div class="spread mt"><span><b>${esc(r.keyword)}</b><br><span class="small dim">${esc(r.angle || '')}</span></span><span class="spread" style="gap:6px"><span class="tag">${esc(r.intent || '')}</span><span class="tag ${r.difficulty === 'Low' ? 'ok' : r.difficulty === 'High' ? 'rest' : 'y'}">${esc(r.difficulty || '')}</span><span class="tag">${esc(String(r.demand ?? ''))}/100</span><a class="chip" href="../tools/hooks-title-generator.html?topic=${encodeURIComponent(r.keyword)}">Use in a title →</a></span></div>`).join('') || '<p class="small mt">No keywords with this intent — switch the filter to All.</p>'}</div>` : '';
    const ca = $('kwcopyall');
    if (ca) ca.addEventListener('click', () => copyText(rows.map(r => r.keyword).join('\n'), 'Keywords copied.'));
  }
  on('kwintent', 'change', renderRows);
  on('kwgo', 'click', async (e) => {
    if (!requireKey()) return;
    const seed = $('kwseed').value.trim();
    if (seed.length < 2) { toast('Write a seed keyword first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    const n = kwCount;
    const prog = makeProgress($('prog'), ['Collecting real search suggestions', 'Estimating intent & difficulty', 'Ready']);
    try {
      const queries = [seed, `how to ${seed}`, `${seed} for beginners`, `best ${seed}`, `${seed} tips`];
      let sugg = [];
      for (const q of queries) { sugg = sugg.concat(await googleSuggest(q)); }
      sugg = [...new Set(sugg)].slice(0, 40);
      prog.setStep(1, sugg.length ? `Found ${sugg.length} real suggestions — estimating…` : 'Suggestions endpoint did not answer — generating from the seed alone…');
      const d = await geminiJson(`You are an SEO keyword researcher. Seed keyword: "${seed}". Niche: ${$('kwniche').value}. Country focus: ${$('kwcountry').value}. Language: ${$('kwlang').value}.
${sugg.length ? `Real Google autosuggest suggestions for this seed (prefer these and their close variants):\n${sugg.join('\n')}` : 'No live suggestions were available — generate sensible long-tail variants of the seed.'}
Return JSON only: {"keywords":[{"keyword":"...","intent":"Informational or Commercial","difficulty":"Low or Medium or High","demand":0,"angle":"a one-line content angle for this keyword"}]}
Give exactly ${n} keywords. demand is your ESTIMATE of relative demand 0-100 for comparison inside this list only. difficulty is your ESTIMATE of how hard it is for a small new site/channel to rank or win with it. Favour specific long-tail keywords a small creator can actually win. Write keywords in the chosen language (keep English keywords in English when that is how people search).`, { bulk: true, temperature: 0.5, onRetry: (info) => prog.setStep(1, retryMsg(info)) });
      rows = (d.keywords || []).filter(r => r && r.keyword);
      if (!rows.length) throw new Error('The AI reply held no keywords. Try again.');
      renderRows();
      saveWork('keywords', seed, { rows });
      prog.done();
    } catch (err) { prog.fail(err.message); toast(err.message, true); }
    busy(b, false, 'Find keywords');
  });
  const savedKw = workFor('keywords');
  if (savedKw && savedKw.payload && (savedKw.payload.rows || []).length) { rows = savedKw.payload.rows; renderRows(); }
}

/* ---------- AI Answer Checker (AEO) ----------
 * Scores a page /100 on whether AI answer engines can find, read and
 * quote it. The score itself is DETERMINISTIC — title/meta/headings/
 * schema/robots checks on the page's real HTML — so it works with no key
 * at all. A key only unlocks the optional AI fix suggestions. The page is
 * fetched through our /api/page route (browsers block cross-origin reads);
 * if the fetch fails, paste-the-text mode is the honest fallback. */
if (tool === 'aeocheck') {
  let lastReport = null, lastHtml = '', lastUrl = '';
  async function fetchViaRoute(url) {
    const r = await fetch(`/api/page?url=${encodeURIComponent(url)}`);
    if (!r.ok) throw new Error('route ' + r.status);
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'fetch_failed');
    return d;
  }
  function runChecks(html, extras) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const text = (doc.body ? doc.body.textContent : '').replace(/\s+/g, ' ').trim();
    const title = (doc.querySelector('title')?.textContent || '').trim();
    const meta = (doc.querySelector('meta[name="description"]')?.getAttribute('content') || '').trim();
    const h1s = [...doc.querySelectorAll('h1')];
    const heads = [...doc.querySelectorAll('h2,h3')].map(h => h.textContent.trim()).filter(Boolean);
    const qHeads = heads.filter(h => /\?\s*$/.test(h) || /^(how|what|why|when|which|can|is|are|do|does)\b/i.test(h));
    const ld = [...doc.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent).join(' ');
    const firstParas = [...doc.querySelectorAll('p')].map(p => p.textContent.replace(/\s+/g, ' ').trim()).filter(p => p.split(' ').length >= 15);
    const checks = [
      { name: 'Title tag present and sized to be quoted', pass: title.length >= 20 && title.length <= 70, fix: 'Give the page a clear 20–70 character title that states the topic plainly.', detail: title ? `"${title.slice(0, 80)}" (${title.length} chars)` : 'No <title> found.' },
      { name: 'Meta description present', pass: meta.length >= 100 && meta.length <= 170, fix: 'Write a 100–170 character meta description that answers "what is this page?" in one breath.', detail: meta ? `${meta.length} chars` : 'No meta description found.' },
      { name: 'Exactly one H1', pass: h1s.length === 1, fix: 'Use one H1 that names the page\'s single main topic.', detail: `${h1s.length} H1 tag(s) found.` },
      { name: 'Question-style headings (what AI engines match)', pass: qHeads.length >= 2, fix: 'Turn at least two H2/H3 headings into the real questions people ask ("How much does X cost?") and answer directly under each.', detail: `${qHeads.length} question heading(s) of ${heads.length}.` },
      { name: 'A direct answer early on the page', pass: firstParas.length > 0 && text.indexOf(firstParas[0].slice(0, 40)) < 2500, fix: 'Put a plain 2–3 sentence answer to the page\'s main question in the first screenful — answer engines quote what comes first.', detail: firstParas.length ? 'A substantial early paragraph exists.' : 'No substantial paragraph found.' },
      { name: 'FAQ schema (FAQPage JSON-LD)', pass: /FAQPage/.test(ld), fix: 'Add FAQPage structured data with your real questions and short answers — it is the most directly quotable block a page can carry.', detail: /FAQPage/.test(ld) ? 'FAQPage schema present.' : 'No FAQPage schema.' },
      { name: 'Some structured data (any JSON-LD)', pass: ld.length > 20, fix: 'Add JSON-LD describing the page (Article, Product, HowTo — whichever fits) so machines can classify it confidently.', detail: ld.length > 20 ? 'JSON-LD present.' : 'No JSON-LD found.' },
      { name: 'Scannable structure (lists)', pass: doc.querySelectorAll('ul,ol').length >= 1, fix: 'Break key facts into a bullet list — lists are quoted by answer engines far more than prose.', detail: `${doc.querySelectorAll('ul,ol').length} list(s) found.` },
      { name: 'llms.txt present', pass: extras.llms === true, fix: 'Add an /llms.txt file: a short plain-text map of your site written for AI readers.', detail: extras.llms === true ? 'Found.' : extras.llms === false ? 'Not found (404).' : 'Could not be checked.' },
      { name: 'AI crawlers allowed in robots.txt', pass: extras.robots === true, fix: 'In robots.txt, do not block GPTBot, ClaudeBot, PerplexityBot or Google-Extended — blocked crawlers cannot quote you.', detail: extras.robots === true ? 'No blanket block found.' : extras.robots === false ? 'An AI crawler is blocked.' : 'Could not be checked.' },
    ];
    const passed = checks.filter(c => c.pass).length;
    return { checks, score: Math.round((passed / checks.length) * 100) };
  }
  function renderReport(rep) {
    const host = $('aeresult'); if (!host) return;
    host.innerHTML = `<div class="outcard"><div class="spread"><b>AI Answer score</b><span class="score${rep.score < 50 ? ' mid' : ''}">${rep.score}</span></div>
      <p class="small dim mt">${esc(lastUrl)} — ${rep.checks.filter(c => c.pass).length} of ${rep.checks.length} readiness signals pass. This scores whether answer engines CAN quote the page; it is not a promise that they will.</p>
      ${rep.checks.map(c => `<div class="spread mt"><span><b>${c.pass ? '✓' : '✗'} ${esc(c.name)}</b><br><span class="small dim">${esc(c.detail)}</span>${c.pass ? '' : `<br><span class="small">Fix: ${esc(c.fix)}</span>`}</span></div>`).join('')}
      <button class="btn dark block mt" id="aeai">Get AI fix suggestions (uses your key)</button>
      <div id="aeaihost"></div></div>`;
    on('aeai', 'click', async (e) => {
      if (!requireKey()) return;
      const b = e.currentTarget; busy(b, true);
      try {
        const failed = rep.checks.filter(c => !c.pass).map(c => c.name).join('; ') || 'none';
        const excerpt = lastHtml.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 5000);
        const d = await geminiJson(`You are an AEO (AI answer engine optimisation) specialist. A page scored ${rep.score}/100. Failing checks: ${failed}.
Page text excerpt: """${excerpt}"""
Return JSON only:
{"suggestions":["a specific, ordered fix — what to change, where, and to what, in one or two lines each"],"faq":[{"q":"a real question this page should answer","a":"a quotable 2-line answer written from the page's own content"}],"intro":"a rewritten 2-3 sentence opening that answers the page's main question directly"}
Give 3-5 suggestions. Never invent facts the page does not contain — write the FAQ and intro ONLY from the excerpt.`, { bulk: true, temperature: 0.5, onRetry: retryNote(b) });
        out('aeaihost', `<div class="outcard" style="box-shadow:none"><b>Do these first</b><ol>${(d.suggestions || []).map(s => `<li>${esc(s)}</li>`).join('')}</ol>
          <p class="mt"><b>Rewritten opening:</b></p><p class="small mt">${esc(d.intro || '')}</p>
          ${(d.faq || []).length ? `<p class="mt"><b>FAQ to add (with FAQPage schema):</b></p>${d.faq.map(f => `<div class="faq"><b>${esc(f.q)}</b><p>${esc(f.a)}</p></div>`).join('')}<button class="chip mt" id="aecopyfaq">Copy the FAQ schema (JSON-LD)</button>` : ''}</div>`);
        const cf = $('aecopyfaq');
        if (cf) cf.addEventListener('click', () => {
          const schema = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: (d.faq || []).map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
          copyText(`<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`, 'FAQ schema copied — paste it before </body>.');
        });
      } catch (err) { toast(err.message, true); }
      busy(b, false, 'Get AI fix suggestions (uses your key)');
    });
  }
  async function checkUrl(url) {
    lastUrl = url;
    const d = await fetchViaRoute(url);
    if (d.status >= 400) throw new Error(`The site answered ${d.status} — check the link.`);
    lastHtml = d.text || '';
    const origin = new URL(d.finalUrl || url).origin;
    const extras = {};
    try { const ll = await fetchViaRoute(origin + '/llms.txt'); extras.llms = ll.status < 400 && (ll.text || '').trim().length > 0; } catch { extras.llms = null; }
    try {
      const rb = await fetchViaRoute(origin + '/robots.txt');
      if (rb.status < 400) {
        const t = rb.text || '';
        extras.robots = !/User-agent:\s*\*/i.test(t) || !/Disallow:\s*\/\s*($|\n)/i.test(t);
        if (/User-agent:\s*(GPTBot|ClaudeBot|PerplexityBot|Google-Extended)[\s\S]{0,120}?Disallow:\s*\//i.test(t)) extras.robots = false;
      }
    } catch { extras.robots = null; }
    return runChecks(lastHtml, extras);
  }
  on('aego', 'click', async (e) => {
    const url = $('aeurl').value.trim();
    if (!/^https?:\/\//i.test(url)) { toast('Paste a full page link starting with https://', true); return; }
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Fetching the page', 'Running the checks', 'Ready']);
    try {
      lastReport = await checkUrl(url);
      prog.setStep(1);
      renderReport(lastReport);
      saveWork('aeocheck', url, { score: lastReport.score, passed: lastReport.checks.filter(c => c.pass).map(c => c.name), failed: lastReport.checks.filter(c => !c.pass).map(c => c.name) });
      prog.done();
    } catch (err) {
      prog.fail('Could not fetch that page: ' + err.message);
      const pm = $('pastewrap'); if (pm) pm.classList.remove('hidden');
      toast('Fetching failed (' + err.message + ') — paste the page text below instead; the wording checks still run.', true);
    }
    busy(b, false, 'Check this page');
  });
  on('aepastego', 'click', () => {
    const t = $('aepaste').value.trim();
    if (t.length < 200) { toast('Paste more of the page — at least a few paragraphs.', true); return; }
    const html = /</.test(t) ? t : `<html><head><title></title></head><body>${t.split(/\n\s*\n/).map(p => `<p>${esc(p)}</p>`).join('')}</body></html>`;
    lastHtml = html; lastUrl = $('aeurl').value.trim() || 'pasted text';
    lastReport = runChecks(html, {});
    renderReport(lastReport);
    toast('Checked from pasted text — title/meta/schema checks need the real page, so they show as missing.');
  });
  const savedAe = workFor('aeocheck');
  if (savedAe && savedAe.payload) {
    out('aeresult', `<div class="outcard"><b>Your last check</b><p class="small mt">${esc(savedAe.title || '')} scored <b>${esc(String(savedAe.payload.score))}/100</b>. Passed: ${(savedAe.payload.passed || []).join(', ') || '—'}. Missing: ${(savedAe.payload.failed || []).join(', ') || 'none'}.</p><p class="small dim mt">Run the check again for the full report.</p></div>`);
  }
}

/* ---------- Instagram Carousel Maker ----------
 * Topic or story → slide-by-slide copy (hook slide, content slides, CTA
 * slide) → theme-styled slide PNGs drawn on canvas at exact Instagram
 * pixels, with the visitor's own photos if they add them, + the caption.
 * Generator only — the visitor posts the carousel themselves. */
if (tool === 'carousel') {
  let slideCount = 7, sizeKey = 'portrait';
  wireChips('rg-crslides', 'crslides', v => { slideCount = Number(v); });
  wireChips('rg-crsize', 'crsize', v => { sizeKey = v; });
  const THEMES = {
    'Yellow Pop': { bg: '#fcd81b', ink: '#171408', sub: '#454033', accent: '#d92b20' },
    'Ink Dark': { bg: '#171408', ink: '#ffffff', sub: '#ded5bd', accent: '#fcd81b' },
    'Mint Fresh': { bg: '#dff5e6', ink: '#0d2b18', sub: '#3c5a47', accent: '#1d9e57' },
    'Red Bold': { bg: '#d92b20', ink: '#ffffff', sub: '#ffd9d4', accent: '#fcd81b' },
  };
  let slides = [], captionText = '';
  async function drawSlide(s, i, n) {
    const W = 1080, H = sizeKey === 'portrait' ? 1350 : 1080;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const th = THEMES[$('crtheme').value] || THEMES['Yellow Pop'];
    ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, H);
    const photos = $('crphotos').files;
    let hasPhoto = false;
    if (photos && photos.length) {
      try {
        const f = photos[i % photos.length];
        const img = await loadImg(URL.createObjectURL(f));
        drawCover(ctx, img, 0, 0, W, H);
        ctx.fillStyle = 'rgba(10,8,4,.62)'; ctx.fillRect(0, 0, W, H);
        hasPhoto = true;
      } catch { /* photo failed to load — theme colours stay */ }
    }
    const ink = hasPhoto ? '#ffffff' : th.ink;
    const sub = hasPhoto ? '#f2ead2' : th.sub;
    ctx.fillStyle = th.accent; ctx.fillRect(70, 84, 110, 12);
    ctx.fillStyle = ink;
    const head = fitLines(ctx, s.headline || '', W - 140, 84, 40, 4, 900);
    let y = 84 + 60 + head.px;
    ctx.textAlign = 'left';
    for (const ln of head.lines) { ctx.fillText(ln, 70, y); y += head.px * 1.14; }
    ctx.fillStyle = sub;
    const body = fitLines(ctx, s.body || '', W - 140, 46, 30, 9, 500);
    y += 26;
    for (const ln of body.lines) { ctx.fillText(ln, 70, y); y += body.px * 1.3; }
    ctx.fillStyle = ink;
    ctx.font = '700 32px Arial, sans-serif';
    const handle = $('crhandle').value.trim();
    if (handle) ctx.fillText(handle.startsWith('@') ? handle : '@' + handle, 70, H - 64);
    ctx.textAlign = 'right';
    ctx.fillText(`${i + 1} / ${n}`, W - 70, H - 64);
    if (i < n - 1) { ctx.textAlign = 'right'; ctx.fillStyle = th.accent; ctx.font = '900 44px Arial, sans-serif'; ctx.fillText('→', W - 70, 130); }
    return cv;
  }
  async function renderSlides() {
    const host = $('crresult'); if (!host) return;
    host.innerHTML = `<div class="spread mt2"><h3>Your carousel</h3><span class="tag y">${slides.length} slides</span></div><div id="crslideshost"></div>
      <div class="outcard"><div class="spread"><b>Caption</b><button class="chip" id="crcopycap">Copy caption</button></div><p class="small mt" style="white-space:pre-wrap">${esc(captionText)}</p></div>
      <button class="btn dark block mt" id="crdlall">Download all slides</button>`;
    const sh = $('crslideshost');
    for (let i = 0; i < slides.length; i++) {
      const cv = await drawSlide(slides[i], i, slides.length);
      const wrap = document.createElement('div');
      wrap.className = 'outcard';
      const img = document.createElement('img');
      img.className = 'prev'; img.alt = `Slide ${i + 1}`; img.src = cv.toDataURL('image/png');
      const btn = document.createElement('button');
      btn.className = 'btn dark sm mt'; btn.textContent = `Download slide ${i + 1}`;
      btn.addEventListener('click', () => downloadCanvas(cv, `carousel-slide-${i + 1}.png`));
      wrap.appendChild(img); wrap.appendChild(btn);
      sh.appendChild(wrap);
    }
    on('crcopycap', 'click', () => copyText(captionText, 'Caption copied.'));
    on('crdlall', 'click', async () => {
      for (let i = 0; i < slides.length; i++) { const cv = await drawSlide(slides[i], i, slides.length); downloadCanvas(cv, `carousel-slide-${i + 1}.png`); await pace(350); }
      toast('Slides downloading — check your downloads folder.');
    });
  }
  on('crgo', 'click', async (e) => {
    if (!requireKey()) return;
    const topic = $('crtopic').value.trim();
    if (topic.length < 5) { toast('Write the topic — or paste your story/article text — first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Writing the slides', 'Designing the slides', 'Ready']);
    try {
      const d = await geminiJson(`You write Instagram carousels that get saved and shared. Topic or source text: """${topic.slice(0, 4000)}""". Language: ${$('crlang').value}.
Write exactly ${slideCount} slides. Return JSON only:
{"slides":[{"headline":"...","body":"..."}],"caption":"the full posting caption, 2-4 lines","hashtags":["..."]}
Slide 1 is the HOOK slide: a headline that promises a payoff (its body is one short teaser line). Middle slides: ONE idea each — headline max 7 words, body max 40 words, plain spoken language. The LAST slide is the CTA: follow/save/share + a question. hashtags: 8-12, no # symbol. Write slides and caption in the chosen language.`, { bulk: true, temperature: 0.7, onRetry: (info) => prog.setStep(0, retryMsg(info)) });
      slides = (d.slides || []).filter(s => s && (s.headline || s.body));
      if (!slides.length) throw new Error('The AI reply held no slides. Try again.');
      captionText = `${d.caption || ''}\n\n${(d.hashtags || []).map(h => '#' + String(h).replace(/\s+/g, '')).join(' ')}`.trim();
      prog.setStep(1);
      await renderSlides();
      saveWork('carousel', topic.slice(0, 60), { slides, caption: captionText });
      prog.done();
    } catch (err) { prog.fail(err.message); toast(err.message, true); }
    busy(b, false, 'Make my carousel');
  });
  on('crphotos', 'change', () => { if (slides.length) renderSlides(); });
  on('crtheme', 'change', () => { if (slides.length) renderSlides(); });
  const savedCr = workFor('carousel');
  if (savedCr && savedCr.payload && (savedCr.payload.slides || []).length) { slides = savedCr.payload.slides; captionText = savedCr.payload.caption || ''; renderSlides(); }
}

/* ---------- Pinterest Pin Maker + Pin Prompt Maker ----------
 * One page, two tabs. Pin Maker: a photo (yours, or AI-made) + title →
 * a finished 1000×1500 pin on canvas + a Gemini-written title and
 * description. Pin Prompt Maker: niche + idea → ready English image
 * prompts built for tall 2:3 Pinterest images. Neither pins anything —
 * the visitor uploads to Pinterest themselves. */
if (tool === 'pinmaker') {
  const setPmTab = (t) => {
    $('pmtab-pin').classList.toggle('on', t === 'pin');
    $('pmtab-prompts').classList.toggle('on', t === 'prompts');
    $('panel-pm-pin').classList.toggle('hidden', t !== 'pin');
    $('panel-pm-prompts').classList.toggle('hidden', t !== 'prompts');
  };
  on('pmtab-pin', 'click', () => setPmTab('pin'));
  on('pmtab-prompts', 'click', () => setPmTab('prompts'));
  if (location.hash === '#prompts') setPmTab('prompts');
  /* ----- Pin Maker ----- */
  let pinImg = null; // HTMLImageElement currently composited
  async function drawPin() {
    const cv = $('pmcanvas'); if (!cv) return;
    cv.width = 1000; cv.height = 1500;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#f7f4ec'; ctx.fillRect(0, 0, 1000, 1500);
    if (pinImg) drawCover(ctx, pinImg, 0, 0, 1000, 1500);
    else { ctx.fillStyle = '#7d7663'; ctx.font = '600 34px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Add a photo — or make one with AI', 500, 720); }
    // Bottom gradient + title
    const grad = ctx.createLinearGradient(0, 880, 0, 1500);
    grad.addColorStop(0, 'rgba(10,8,4,0)'); grad.addColorStop(0.45, 'rgba(10,8,4,.72)'); grad.addColorStop(1, 'rgba(10,8,4,.92)');
    ctx.fillStyle = grad; ctx.fillRect(0, 880, 1000, 620);
    ctx.textAlign = 'left';
    const title = fitLines(ctx, $('pmtitle').value.trim() || 'Your pin title', 1000 - 110, 76, 38, 3, 900);
    ctx.fillStyle = '#ffffff';
    let y = 1500 - 300;
    for (const ln of title.lines) { ctx.fillText(ln, 55, y); y += title.px * 1.12; }
    const sub = $('pmsub').value.trim();
    if (sub) { ctx.font = '500 36px Arial, sans-serif'; ctx.fillStyle = '#fcd81b'; ctx.fillText(sub.slice(0, 60), 55, y + 8); }
    const brand = $('pmbrand').value.trim();
    if (brand) {
      ctx.fillStyle = '#fcd81b'; ctx.fillRect(0, 0, 1000, 74);
      ctx.fillStyle = '#171408'; ctx.font = '800 36px Arial, sans-serif';
      ctx.fillText(brand, 55, 50);
    }
  }
  on('pmfile', 'change', async () => {
    const f = $('pmfile').files[0];
    if (!f) return;
    pinImg = await loadImg(URL.createObjectURL(f));
    drawPin();
  });
  ['pmtitle', 'pmsub', 'pmbrand'].forEach(id => on(id, 'input', drawPin));
  drawPin();
  on('pmaiimg', 'click', async (e) => {
    if (!requireKey()) return;
    const idea = $('pmimgprompt').value.trim();
    if (idea.length < 4) { toast('Describe the picture first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const url = await geminiImage(`Vertical 2:3 Pinterest-style picture. ${idea}. Bright, scroll-stopping, clean composition with copy space at the bottom third, no text, no words, no watermark.`, null, '2:3', { onRetry: retryNote(b) });
      pinImg = await loadImg(url);
      drawPin();
      toast('Picture made — it is on the pin.');
    } catch (err) { toast(err.message, true); }
    busy(b, false, 'Make the picture with AI');
  });
  on('pmdownload', 'click', () => { drawPin(); downloadCanvas($('pmcanvas'), 'pinterest-pin.png'); toast('Pin downloaded — 1000×1500, ready to upload.'); });
  on('pmdesc', 'click', async (e) => {
    if (!requireKey()) return;
    const topic = $('pmtopic').value.trim() || $('pmtitle').value.trim();
    if (topic.length < 3) { toast('Write what the pin is about first (or a pin title).', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const d = await geminiJson(`You write Pinterest pins that get clicks and saves. Topic: "${topic}".
Return JSON only: {"title":"a pin title, max 100 chars, with the main keyword early","description":"a pin description of 2-3 sentences with natural keywords and a soft call to action, max 450 chars"}.`, { bulk: true, temperature: 0.6, onRetry: retryNote(b) });
      out('pmdescresult', `<div class="outcard"><div class="spread"><b>Pin title</b><button class="chip" id="pmcopyt">Copy</button></div><p class="small mt">${esc(d.title || '')}</p>
        <div class="spread mt"><b>Pin description</b><button class="chip" id="pmcopyd">Copy</button></div><p class="small mt">${esc(d.description || '')}</p></div>`);
      on('pmcopyt', 'click', () => copyText(d.title || ''));
      on('pmcopyd', 'click', () => copyText(d.description || ''));
      if (d.title && !$('pmtitle').value.trim()) { $('pmtitle').value = d.title; drawPin(); }
      saveWork('pinmaker', topic, { pinTitle: d.title || '', pinDescription: d.description || '' });
    } catch (err) { toast(err.message, true); }
    busy(b, false, 'Write the title + description');
  });
  /* ----- Pin Prompt Maker ----- */
  let ppCount = 3;
  wireChips('rg-ppcount', 'ppcount', v => { ppCount = Number(v); });
  on('ppgo', 'click', async (e) => {
    if (!requireKey()) return;
    const idea = $('ppidea').value.trim();
    if (idea.length < 3) { toast('Write your idea first — a few words is enough.', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const d = await geminiJson(`You write image-generation prompts for Pinterest. Niche: ${$('ppniche').value}. Idea (any language): "${idea}". Style direction: ${$('ppstyle').value}.
Return JSON only: {"prompts":["..."]}
Give exactly ${ppCount} DIFFERENT English prompts, each a complete image prompt for a tall 2:3 Pinterest image: subject, setting, lighting, colours, composition and mood, 25-45 words each, and end each with "vertical 2:3 composition, no text". Prompts must be in English even if the idea is not.`, { bulk: true, temperature: 0.8, onRetry: retryNote(b) });
      const prompts = (d.prompts || []).filter(Boolean);
      out('ppresult', `<div class="spread mt2"><h3>Your pin prompts</h3><button class="chip" id="ppcopyall">Copy all</button></div>` +
        prompts.map((p, i) => `<div class="outcard"><div class="spread"><b>Prompt ${i + 1}</b><span><button class="chip" data-ppcopy="${i}">Copy</button> <button class="chip" data-ppmake="${i}">Make this image</button></span></div><p class="small mt">${esc(p)}</p></div>`).join(''));
      document.querySelectorAll('[data-ppcopy]').forEach(btn => btn.addEventListener('click', () => copyText(prompts[Number(btn.dataset.ppcopy)], 'Prompt copied.')));
      document.querySelectorAll('[data-ppmake]').forEach(btn => btn.addEventListener('click', () => {
        copyText(prompts[Number(btn.dataset.ppmake)], 'Prompt copied — opening the Thumbnail Creator. Paste it as the idea and pick the Pinterest-friendly 2:3-friendly size.');
        setTimeout(() => { location.href = '../tools/thumbnail-creator.html'; }, 600);
      }));
      const ca = $('ppcopyall');
      if (ca) ca.addEventListener('click', () => copyText(prompts.join('\n\n'), 'All prompts copied.'));
      saveWork('pinmaker', idea, { prompts });
    } catch (err) { toast(err.message, true); }
    busy(b, false, 'Write my prompts');
  });
  const savedPm = workFor('pinmaker');
  if (savedPm && savedPm.payload && (savedPm.payload.prompts || []).length) {
    out('ppresult', `<div class="outcard"><b>Your last prompts</b>${savedPm.payload.prompts.map(p => `<p class="small mt">${esc(p)}</p>`).join('')}</div>`);
  }
}

/* ---------- Voice Maker ----------
 * Standalone text-to-voice: paste a script, or upload a .txt / PDF (the
 * PDF's text is extracted by Gemini), pick one of the 30 voices, and get
 * downloadable WAV per chunk — long scripts are split at sentence
 * boundaries and voiced chunk by chunk with live status. Free Gemini TTS
 * has a small daily cap; the page says so and points at a second key. */
if (tool === 'voicemaker') {
  voiceOptions($('vmvoice'));
  function splitChunks(text, max = 2800) {
    const parts = text.match(/[^.!?।\n]+[.!?।]?\s*/g) || [text];
    const chunks = []; let cur = '';
    for (const p of parts) {
      if ((cur + p).length > max && cur) { chunks.push(cur.trim()); cur = p; }
      else cur += p;
      while (cur.length > max) { chunks.push(cur.slice(0, max).trim()); cur = cur.slice(max); }
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks.filter(Boolean);
  }
  function renderChunks(chunks) {
    const host = $('vmchunks'); if (!host) return;
    host.innerHTML = chunks.length ? `<div class="outcard"><b>${chunks.length} part${chunks.length > 1 ? 's' : ''}</b><p class="small dim mt">Long text is voiced in parts (the voice model takes a few thousand characters at a time). Each part gets its own player and download as it finishes.</p>${chunks.map((c, i) => `<div class="outcard" style="box-shadow:none" id="vmchunk-${i}"><div class="spread"><b>Part ${i + 1}</b><span class="tag" data-vmstate="${i}">Waiting</span></div><p class="small dim mt">${esc(c.slice(0, 140))}${c.length > 140 ? '…' : ''}</p><div data-vmaudio="${i}" class="mt"></div></div>`).join('')}</div>` : '';
  }
  on('vmfile', 'change', async () => {
    const f = $('vmfile').files[0];
    if (!f) return;
    if (/\.txt$/i.test(f.name) || f.type === 'text/plain') {
      $('vmtext').value = (await f.text()).slice(0, 60000);
      toast('Text loaded from the file.');
      return;
    }
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
      if (!requireKey()) return;
      if (f.size > 18 * 1024 * 1024) { toast('That PDF is over the ~18 MB browser limit.', true); return; }
      toast('Reading the PDF with Gemini…');
      try {
        const part = await fileToInline(f);
        const txt = await geminiParts([part, { text: 'Extract ALL the readable text from this PDF, in order, exactly as written. Return the text only — no summary, no commentary.' }], { temperature: 0.1, timeoutMs: 240000 });
        $('vmtext').value = String(txt || '').slice(0, 60000);
        toast('PDF text loaded — check it, then make the voice.');
      } catch (err) { toast('PDF reading failed: ' + err.message, true); }
      return;
    }
    toast('That file type is not supported — use a .txt or a PDF.', true);
  });
  on('vmgo', 'click', async (e) => {
    if (!requireKey()) return;
    const text = $('vmtext').value.trim();
    if (text.length < 3) { toast('Paste your script first.', true); return; }
    const chunks = splitChunks(text);
    renderChunks(chunks);
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Voicing your script', 'Ready']);
    const style = $('vmstyle').value.trim();
    let prevErr = null, made = 0;
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await breather(prevErr);
      const state = document.querySelector(`[data-vmstate="${i}"]`);
      if (state) state.textContent = 'Voicing…';
      prog.setFraction(i / chunks.length);
      try {
        const blob = await geminiTTS(style ? `Say this ${style}: ${chunks[i]}` : chunks[i], $('vmvoice').value, { onRetry: (info) => prog.setStep(0, retryMsg(info)) });
        const url = URL.createObjectURL(blob);
        const host = document.querySelector(`[data-vmaudio="${i}"]`);
        if (host) host.innerHTML = `<audio controls src="${url}" style="width:100%"></audio><a class="btn dark sm mt" href="${url}" download="voice-part-${i + 1}.wav">Download part ${i + 1} (.wav)</a>`;
        if (state) { state.textContent = 'Done'; state.className = 'tag ok'; }
        prevErr = null; made++;
      } catch (err) {
        prevErr = err;
        if (state) { state.textContent = 'Failed'; state.className = 'tag rest'; }
        const host = document.querySelector(`[data-vmaudio="${i}"]`);
        if (host) host.innerHTML = `<p class="small" style="color:var(--red)">${esc(err.message)}</p>`;
      }
      prog.setFraction((i + 1) / chunks.length);
    }
    saveWork('voicemaker', text.slice(0, 60), { text: text.slice(0, 4000), voice: $('vmvoice').value });
    prog.done();
    toast(made === chunks.length ? 'Voice ready — all parts voiced.' : `${made} of ${chunks.length} parts voiced — the rest hit the free limit or an error (see the cards).`, made !== chunks.length);
    busy(b, false, 'Make the voice');
  });
  const savedVm = workFor('voicemaker');
  if (savedVm && savedVm.payload && savedVm.payload.text && !$('vmtext').value) {
    $('vmtext').value = savedVm.payload.text;
    toast('Your last script was restored into the box.');
  }
}

/* ---------- Blog-to-Reel ----------
 * An article in → a teaser reel pack out: a hook and a script that stops
 * BEFORE the answer, the voice, an end card ("Full answer on the blog"),
 * the first-comment text with the article link, and an estimated-timing
 * captions file. It never posts or comments by itself — the visitor
 * downloads the pack and posts it. */
if (tool === 'blogreel') {
  voiceOptions($('brvoice'));
  let format = 'Unfinished story';
  wireChips('rg-brformat', 'brformat', v => { format = v; });
  on('brgo', 'click', async (e) => {
    if (!requireKey()) return;
    const text = $('brtext').value.trim();
    if (text.length < 200) { toast('Paste more of the article — at least a few paragraphs, so the teaser has something real to withhold.', true); return; }
    const b = e.currentTarget; busy(b, true);
    const prog = makeProgress($('prog'), ['Reading the article', 'Writing the teaser', 'Making the voice', 'Ready']);
    try {
      const d = await geminiJson(`You make teaser reels that send viewers to a blog article. Teaser format: ${format}. Language: ${$('brlang').value}.
The article (use ONLY its content):
"""${text.slice(0, 9000)}"""
Return JSON only:
{"hook":"the first spoken line — a scroll-stopper built from the article's most surprising point","lines":["spoken line 2","line 3","..."],"withheld":"the exact fact/answer the teaser deliberately does NOT reveal (for the creator's eyes)","endCard":"the end-card text — must include the words 'Full answer on the blog'","firstComment":"the first-comment text for the post, including a friendly pointer to the article link","caption":"the posting caption, 1-2 lines","hashtags":["..."]}
Rules: 5-8 spoken lines total including the hook, each 8-15 words, building curiosity step by step — and the script STOPS before the answer. The withheld answer must genuinely be in the article (never tease something the article does not deliver). hashtags: 5-8, no # symbol.`, { bulk: true, temperature: 0.7, onRetry: (info) => prog.setStep(1, retryMsg(info)) });
      const lines = (d.lines || []).filter(Boolean);
      const allLines = [d.hook, ...lines].filter(Boolean);
      if (!allLines.length) throw new Error('The AI reply held no script. Try again.');
      prog.setStep(2);
      out('brresult', `<div class="outcard"><div class="spread"><b>Teaser script — stops before the answer</b><span class="tag y">${esc(format)}</span></div>
        ${allLines.map((l, i) => `<p class="mt"><b>${i === 0 ? 'Hook:' : `Line ${i + 1}:`}</b> ${esc(l)}</p>`).join('')}
        <p class="small mt"><b>Withheld (do not say this in the reel):</b> ${esc(d.withheld || '')}</p>
        <p class="small mt"><b>End card:</b> ${esc(d.endCard || 'Full answer on the blog')}</p>
        <div id="brvoicehost" class="mt"><span class="spin"></span> Making the voice…</div>
        <div id="brimghost"></div>
        <div class="outcard" style="box-shadow:none"><b>First comment</b><p class="small mt">${esc(d.firstComment || '')}</p><button class="chip mt" id="brcopyfc">Copy first comment</button></div>
        <div class="outcard" style="box-shadow:none"><b>Caption</b><p class="small mt" style="white-space:pre-wrap">${esc(d.caption || '')}\n\n${(d.hashtags || []).map(h => '#' + String(h).replace(/\s+/g, '')).join(' ')}</p><button class="chip mt" id="brcopycap">Copy caption</button></div>
        <div class="btns two mt"><button class="btn sm" id="brdlsrt">Download captions (.srt)</button><button class="btn dark sm" id="brdlmd">Download the pack (.md)</button></div>
        <div class="note mt"><div><b>Render step.</b><div class="small dim">The voice, script and captions are the pack; the assembled reel is made in the render step. Post the reel yourself and pin the first comment with your article link — this tool never posts or comments for you.</div></div></div></div>`);
      on('brcopyfc', 'click', () => copyText(d.firstComment || '', 'First comment copied.'));
      on('brcopycap', 'click', () => copyText(`${d.caption || ''}\n\n${(d.hashtags || []).map(h => '#' + String(h).replace(/\s+/g, '')).join(' ')}`, 'Caption copied.'));
      // Captions: estimated timing from word counts (labelled as estimate).
      let t = 0;
      const cues = allLines.map(l => {
        const dur = Math.max(1.6, String(l).split(/\s+/).length / 2.4);
        const c = { start: t, end: t + dur, text: l };
        t += dur + 0.25;
        return c;
      });
      on('brdlsrt', 'click', () => download('teaser-captions.srt', cuesToSrt(cues), 'text/plain'));
      on('brdlmd', 'click', () => download('blog-to-reel-pack.md', `# Blog-to-Reel teaser pack\n\n## Script\n${allLines.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\n## Withheld answer\n${d.withheld || ''}\n\n## End card\n${d.endCard || ''}\n\n## First comment\n${d.firstComment || ''}\n\n## Caption\n${d.caption || ''}\n\n${(d.hashtags || []).map(h => '#' + String(h).replace(/\s+/g, '')).join(' ')}`, 'text/markdown'));
      // Voice
      const vh = $('brvoicehost');
      let voiceErr = null;
      try {
        const blob = await geminiTTS(allLines.join(' '), $('brvoice').value, { onRetry: retryNote(b) });
        const url = URL.createObjectURL(blob);
        if (vh) vh.innerHTML = `<audio controls src="${url}" style="width:100%"></audio><a class="btn dark sm mt" href="${url}" download="teaser-voice.wav">Download the voice (.wav)</a><p class="small dim mt">Caption timings are estimated from the script's word counts — nudge them in your editor if a line runs long.</p>`;
      } catch (err) { voiceErr = err; if (vh) vh.innerHTML = `<p class="small" style="color:var(--red)">Voice failed — ${esc(err.message)}</p>`; }
      // Optional scene pictures
      if ($('brimages').checked) {
        const ih = $('brimghost');
        if (ih) ih.innerHTML = '<p class="small dim mt">Painting one picture per line…</p>';
        let prevErr = voiceErr;
        const imgs = [];
        for (let i = 0; i < Math.min(6, allLines.length); i++) {
          if (i > 0) await breather(prevErr);
          try {
            const url = await geminiImage(`Vertical 9:16 picture for a teaser reel scene. Visualise this spoken line without showing its answer: "${allLines[i]}". Cinematic, curiosity-building, no text, no words, no watermark.`, null, '9:16', { onRetry: retryNote(null, ih) });
            imgs.push(`<div class="outcard" style="box-shadow:none"><b>Line ${i + 1}</b><img class="prev mt" src="${url}" alt="Scene ${i + 1}"><a class="btn dark sm mt" href="${url}" download="teaser-scene-${i + 1}.png">Download</a></div>`);
            prevErr = null;
          } catch (err) { prevErr = err; imgs.push(`<div class="outcard" style="box-shadow:none"><b>Line ${i + 1}</b><p class="small mt" style="color:var(--red)">Picture failed — ${esc(err.message)}</p></div>`); }
        }
        if (ih) ih.innerHTML = imgs.join('');
      }
      saveWork('blogreel', $('brtitle').value.trim() || 'Blog teaser', { hook: d.hook, lines, withheld: d.withheld, endCard: d.endCard, firstComment: d.firstComment, caption: d.caption });
      prog.done();
    } catch (err) { prog.fail(err.message); toast(err.message, true); }
    busy(b, false, 'Make my teaser pack');
  });
  const savedBr = workFor('blogreel');
  if (savedBr && savedBr.payload && savedBr.payload.hook) {
    const p = savedBr.payload;
    out('brresult', `<div class="outcard"><b>Your last teaser script</b><p class="mt"><b>Hook:</b> ${esc(p.hook)}</p>${(p.lines || []).map((l, i) => `<p class="small mt"><b>Line ${i + 2}:</b> ${esc(l)}</p>`).join('')}<p class="small mt"><b>Withheld:</b> ${esc(p.withheld || '')}</p><p class="small mt"><b>End card:</b> ${esc(p.endCard || '')}</p><p class="small dim mt">The voice and pictures are not kept — run the maker again to regenerate them.</p></div>`);
  }
}
