// StreamClip AI — tool logic. All AI runs in the browser on the visitor's key.
import { requireKey, geminiText, geminiJson, geminiImage, fileToInline, esc } from './gemini.js';
import { toast } from './site.js';

const $ = (id) => document.getElementById(id);
const tool = document.body.dataset.tool;
const busy = (btn, on, label) => { btn.disabled = on; btn.innerHTML = on ? '<span class="spin"></span> Working…' : label; };
const out = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };

/* ---------- Hooks + Title Generator ---------- */
if (tool === 'hooks') {
  $('go').addEventListener('click', async (e) => {
    if (!requireKey()) return;
    const topic = $('topic').value.trim();
    if (!topic) { toast('Write your topic first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const d = await geminiJson(`You are a viral short-form content strategist. Topic: "${topic}". Platform: ${$('platform').value}. Tone: ${$('tone').value}.
Return JSON only: {"hooks":["..."],"titles":["..."],"hashtags":["..."]}
Give 8 hooks (3-7 punchy words each, no emojis), 6 titles (max 60 characters each), 8 hashtags (no # symbol, single words or short phrases).`);
      out('result', `
        <div class="outcard"><b>Hooks</b><ol>${(d.hooks || []).map(h => `<li>${esc(h)}</li>`).join('')}</ol></div>
        <div class="outcard"><b>Titles</b><ol>${(d.titles || []).map(t => `<li>${esc(t)}</li>`).join('')}</ol></div>
        <div class="outcard"><b>Hashtags</b><p class="out">${(d.hashtags || []).map(h => '#' + esc(String(h).replace(/\s+/g, ''))).join(' ')}</p>
        <button class="btn dark sm mt" id="copytags">Copy hashtags</button></div>`);
      $('copytags')?.addEventListener('click', () => { navigator.clipboard.writeText((d.hashtags || []).map(h => '#' + String(h).replace(/\s+/g, '')).join(' ')); toast('Hashtags copied.'); });
    } catch (err) { toast(err.message, true); }
    busy(b, false, 'Generate hooks & titles');
  });
}

/* ---------- Caption Translation ---------- */
if (tool === 'translate') {
  $('go').addEventListener('click', async (e) => {
    if (!requireKey()) return;
    const text = $('src').value.trim();
    if (!text) { toast('Paste your captions first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const r = await geminiText(`Translate these video captions into ${$('lang').value}. Keep every line break and every timestamp exactly as it is. Translate only the spoken words. Do not add explanations.\n\n${text}`, { temperature: 0.3 });
      out('result', `<div class="outcard"><b>Translated captions</b><p class="out mt">${esc(r)}</p><button class="btn dark sm mt" id="copytr">Copy translation</button></div>`);
      $('copytr').addEventListener('click', () => { navigator.clipboard.writeText(r); toast('Translation copied.'); });
    } catch (err) { toast(err.message, true); }
    busy(b, false, 'Translate captions');
  });
}

/* ---------- Lecture to Notes ---------- */
if (tool === 'notes') {
  $('go').addEventListener('click', async (e) => {
    if (!requireKey()) return;
    const text = $('src').value.trim();
    if (text.length < 80) { toast('Paste a longer lecture transcript (at least a few paragraphs).', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const d = await geminiJson(`You are a study-notes writer. From this lecture transcript, make clean revision notes.
Return JSON only: {"title":"...","summary":"...","keyPoints":["..."],"definitions":[{"term":"...","meaning":"..."}],"formulas":["..."],"remember":["..."]}
Keep points short and exact to the transcript. Transcript:\n${text.slice(0, 24000)}`);
      const md = `# ${d.title}\n\n## Summary\n${d.summary}\n\n## Key points\n${(d.keyPoints || []).map(p => '- ' + p).join('\n')}\n\n## Definitions\n${(d.definitions || []).map(x => `- **${x.term}**: ${x.meaning}`).join('\n')}\n\n## Formulas & facts\n${(d.formulas || []).map(f => '- ' + f).join('\n')}\n\n## Remember\n${(d.remember || []).map(r => '- ' + r).join('\n')}`;
      out('result', `<div class="outcard"><h3>${esc(d.title || 'Lecture notes')}</h3>
        <p class="out mt"><b>Summary:</b> ${esc(d.summary || '')}</p>
        <b class="mt" style="display:block">Key points</b><ul>${(d.keyPoints || []).map(p => `<li>${esc(p)}</li>`).join('')}</ul>
        ${(d.definitions || []).length ? `<b style="display:block" class="mt">Definitions</b><ul>${d.definitions.map(x => `<li><b>${esc(x.term)}:</b> ${esc(x.meaning)}</li>`).join('')}</ul>` : ''}
        ${(d.formulas || []).length ? `<b style="display:block" class="mt">Formulas & facts</b><ul>${d.formulas.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
        <button class="btn sm mt" id="dln">Download notes (.md)</button></div>`);
      $('dln').addEventListener('click', () => download('lecture-notes.md', md, 'text/markdown'));
    } catch (err) { toast(err.message, true); }
    busy(b, false, 'Make my notes');
  });
}

/* ---------- Flashcards + Quiz ---------- */
if (tool === 'flashcards') {
  let cards = [], ci = 0, flipped = false;
  $('go').addEventListener('click', async (e) => {
    if (!requireKey()) return;
    const text = $('src').value.trim();
    if (text.length < 80) { toast('Paste more study text first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const d = await geminiJson(`Make study material from this text. Return JSON only:
{"flashcards":[{"front":"question or term","back":"answer"}],"quiz":[{"q":"...","options":["a","b","c","d"],"answer":0,"why":"one line"}]}
8 flashcards, 6 quiz questions. Exact to the text.\n${text.slice(0, 24000)}`);
      cards = d.flashcards || []; ci = 0; flipped = false;
      const quiz = (d.quiz || []).map((q, qi) => `<div class="outcard"><b>Q${qi + 1}. ${esc(q.q)}</b>
        <div class="chips mt">${q.options.map((o, oi) => `<button class="chip" data-q="${qi}" data-o="${oi}">${esc(o)}</button>`).join('')}</div>
        <p class="small dim mt hidden" id="why-${qi}">${esc(q.why || '')}</p></div>`).join('');
      out('result', `${cards.length ? `<h3 class="mt2">Flashcards — tap a card to flip</h3><div class="flashcard" id="fc"></div>
        <div class="btns two mt"><button class="btn dark" id="prev">Previous</button><button class="btn dark" id="next">Next</button></div>
        <p class="small dim mt" id="fcn"></p>` : ''}
        ${quiz ? `<h3 class="mt2">Quiz — tap an answer</h3>${quiz}` : ''}`);
      const draw = () => { if (!cards.length) return; $('fc').textContent = flipped ? cards[ci].back : cards[ci].front; $('fcn').textContent = `Card ${ci + 1} of ${cards.length} — ${flipped ? 'answer' : 'question'} side`; };
      if (cards.length) {
        draw();
        $('fc').addEventListener('click', () => { flipped = !flipped; draw(); });
        $('prev').addEventListener('click', () => { ci = (ci - 1 + cards.length) % cards.length; flipped = false; draw(); });
        $('next').addEventListener('click', () => { ci = (ci + 1) % cards.length; flipped = false; draw(); });
      }
      document.querySelectorAll('[data-q]').forEach(btn => btn.addEventListener('click', () => {
        const q = (d.quiz || [])[Number(btn.dataset.q)];
        const ok = Number(btn.dataset.o) === Number(q.answer);
        btn.classList.add('on'); btn.style.background = ok ? 'var(--green)' : 'var(--red)';
        const w = $(`why-${btn.dataset.q}`); if (w) { w.classList.remove('hidden'); w.textContent = (ok ? 'Correct. ' : `Not quite — the answer is "${q.options[q.answer]}". `) + (q.why || ''); }
      }));
    } catch (err) { toast(err.message, true); }
    busy(b, false, 'Make flashcards & quiz');
  });
}

/* ---------- Video Presentation Maker ---------- */
if (tool === 'presentation') {
  $('go').addEventListener('click', async (e) => {
    if (!requireKey()) return;
    const topic = $('topic').value.trim();
    if (!topic) { toast('Write your presentation topic first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const d = await geminiJson(`Plan a student class-presentation video. Topic: "${topic}". Extra points from the student: "${$('points').value.trim()}". Slides: ${$('slides').value}. Audience level: ${$('level').value}.
Return JSON only: {"title":"...","slides":[{"title":"...","bullets":["..."],"narration":"..."}]}
Narration per slide: 2-4 natural spoken sentences a student can read aloud or use as the AI-voice script. No greetings on every slide.`);
      const script = (d.slides || []).map((s, i) => `SLIDE ${i + 1}: ${s.title}\n${s.narration}`).join('\n\n');
      out('result', `<div class="outcard"><h3>${esc(d.title || topic)}</h3></div>
        ${(d.slides || []).map((s, i) => `<div class="outcard slidecard"><b>Slide ${i + 1} — ${esc(s.title)}</b>
          <ul>${(s.bullets || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
          <p class="small dim mt"><b>Voice script:</b> ${esc(s.narration)}</p></div>`).join('')}
        <button class="btn sm mt" id="dls">Download voice script (.txt)</button>`);
      $('dls').addEventListener('click', () => download('presentation-script.txt', `${d.title || topic}\n\n${script}`, 'text/plain'));
    } catch (err) { toast(err.message, true); }
    busy(b, false, 'Plan my presentation');
  });
}

/* ---------- Thumbnail Creator / Redesigner ---------- */
if (tool === 'thumbnail') {
  let file = null, analysis = '';
  $('tfile').addEventListener('change', (e) => {
    file = e.target.files?.[0] || null;
    if (file) { $('tprev').src = URL.createObjectURL(file); $('tprev').classList.remove('hidden'); }
  });
  $('analyse').addEventListener('click', async (e) => {
    if (!requireKey()) return;
    if (!file) { toast('Upload a thumbnail first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const part = await fileToInline(file);
      analysis = await geminiText('Analyse this YouTube thumbnail like a top thumbnail designer. Cover, in short headed sections: Topic it is selling; The exact text on it; What works (subject, colours, contrast, emotion); What is weak; 4 concrete redesign directions that look completely different from each other but keep the SAME text. Be specific.', { parts: [part], temperature: 0.4 });
      out('aresult', `<div class="outcard"><b>Thumbnail analysis</b><p class="out mt">${esc(analysis)}</p></div>`);
    } catch (err) { toast(err.message, true); }
    busy(b, false, 'Analyse thumbnail');
  });
  // Canvas variations: genuinely different layouts, SAME text.
  const styles = [
    { name: 'Bold Yellow', bg: ['#ffc81f', '#e3a500'], fg: '#1c1503', accent: '#e02c2c', pos: 'left' },
    { name: 'Dark Neon', bg: ['#0b1026', '#23307a'], fg: '#ffffff', accent: '#4aa8ff', pos: 'center' },
    { name: 'Red Alert', bg: ['#3a0d0d', '#a8231b'], fg: '#ffffff', accent: '#ffe46b', pos: 'right' },
    { name: 'Clean Mint', bg: ['#06281a', '#157a45'], fg: '#eafff3', accent: '#ffe46b', pos: 'left' },
  ];
  $('makevars').addEventListener('click', async () => {
    const text = $('ttext').value.trim();
    if (!text) { toast('Write the thumbnail text (the same text goes on every version).', true); return; }
    const host = $('vars'); host.innerHTML = '';
    const img = file ? await loadImg(URL.createObjectURL(file)) : null;
    styles.forEach((st, i) => {
      const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; cv.className = 'thumbcv';
      const x = cv.getContext('2d');
      const g = x.createLinearGradient(0, 0, 1280, 720); g.addColorStop(0, st.bg[0]); g.addColorStop(1, st.bg[1]);
      x.fillStyle = g; x.fillRect(0, 0, 1280, 720);
      if (img) { const w = 560; const h = w * img.height / img.width; const ix = st.pos === 'left' ? 660 : st.pos === 'right' ? 60 : 360; x.save(); roundRect(x, ix, 110, w, Math.min(h, 500), 26); x.clip(); x.drawImage(img, ix, 110, w, Math.min(h, 500)); x.restore(); }
      x.fillStyle = st.accent; x.fillRect(st.pos === 'center' ? 340 : 60, 560, 260, 14);
      x.fillStyle = st.fg; x.font = '900 92px Poppins, Arial, sans-serif'; x.textAlign = st.pos === 'center' ? 'center' : 'left';
      wrapText(x, text.toUpperCase(), st.pos === 'center' ? 640 : 70, 200, st.pos === 'center' ? 1100 : 560, 100);
      const card = document.createElement('div'); card.className = 'outcard';
      card.innerHTML = `<b>Version ${i + 1} — ${st.name}</b>`;
      card.appendChild(cv);
      const dl = document.createElement('button'); dl.className = 'btn sm mt'; dl.textContent = 'Download this version';
      dl.addEventListener('click', () => { const a = document.createElement('a'); a.download = `thumbnail-v${i + 1}.png`; a.href = cv.toDataURL('image/png'); a.click(); });
      card.appendChild(dl); host.appendChild(card);
    });
    toast('4 different versions made — same text on all.');
  });
  // Prompt chat box
  const log = [];
  $('chatsend').addEventListener('click', async (e) => {
    if (!requireKey()) return;
    const msg = $('chatin').value.trim();
    if (!msg) return;
    log.push({ me: true, t: msg });
    $('chatin').value = '';
    drawChat();
    const b = e.currentTarget; busy(b, true);
    try {
      let reply, imgUrl = null;
      try { imgUrl = await geminiImage(`Create a YouTube thumbnail image (16:9, bold, high contrast, no watermark) for: ${msg}`, file ? await fileToInline(file) : null); }
      catch { /* fall back to a written concept */ }
      if (imgUrl) { reply = 'Here is your AI-generated thumbnail:'; log.push({ me: false, t: reply, img: imgUrl }); }
      else {
        const concept = await geminiText(`A user wants a YouTube thumbnail from this prompt: "${msg}". Reply with a short, concrete thumbnail concept: main subject, background, colours, exact text to show, and layout — so they can build it in the version maker above. Keep it under 120 words.`);
        log.push({ me: false, t: concept });
      }
    } catch (err) { log.push({ me: false, t: 'Error: ' + err.message }); }
    drawChat();
    busy(b, false, 'Send');
  });
  function drawChat() {
    $('chatlog').innerHTML = log.map(m => `<div class="chatmsg ${m.me ? 'me' : ''}">${esc(m.t)}${m.img ? `<img class="prev mt" src="${m.img}" alt="AI thumbnail">` : ''}</div>`).join('');
    $('chatlog').scrollTop = 1e6;
  }
}

/* ---------- Upload Your Own Video / Lecture Clips (shared video handling) ---------- */
if (tool === 'upload' || tool === 'lecture-clips') {
  let dur = 0;
  const v = $('vid');
  $('vfile').addEventListener('change', (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    v.src = URL.createObjectURL(f); $('stage').classList.remove('hidden');
  });
  v.addEventListener('loadedmetadata', () => {
    dur = v.duration || 0;
    $('in').max = Math.max(1, Math.floor(dur)); $('out').max = Math.max(1, Math.floor(dur)); $('out').value = Math.floor(dur);
    $('dur').textContent = `Length: ${fmt(dur)} · drag the sliders to choose your clip`;
    upd();
  });
  const upd = () => { $('inv').textContent = fmt(Number($('in').value)); $('outv').textContent = fmt(Number($('out').value)); };
  $('in').addEventListener('input', () => { if (Number($('in').value) > Number($('out').value) - 3) $('in').value = Number($('out').value) - 3; v.currentTime = Number($('in').value); upd(); });
  $('out').addEventListener('input', () => { if (Number($('out').value) < Number($('in').value) + 3) $('out').value = Number($('in').value) + 3; upd(); });
  $('playseg').addEventListener('click', () => { v.currentTime = Number($('in').value); v.play(); });
  v.addEventListener('timeupdate', () => { if (v.currentTime >= Number($('out').value)) v.pause(); });
  // In-browser export: records the chosen segment in real time to WebM.
  $('export').addEventListener('click', async () => {
    if (!v.src) { toast('Upload a video first.', true); return; }
    if (!v.captureStream) { toast('This browser cannot export in-page. Use Chrome on Android/desktop.', true); return; }
    const b = $('export'); busy(b, true, 'Export clip (WebM)');
    try {
      const stream = v.captureStream();
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks = [];
      rec.ondataavailable = (x) => chunks.push(x.data);
      const done = new Promise(r => rec.onstop = r);
      v.currentTime = Number($('in').value);
      await v.play(); rec.start(250);
      const stopAt = Number($('out').value);
      await new Promise(r => { const iv = setInterval(() => { if (v.currentTime >= stopAt || v.paused) { clearInterval(iv); r(); } }, 200); });
      v.pause(); rec.stop(); await done;
      const blob = new Blob(chunks, { type: 'video/webm' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'streamclip-clip.webm'; a.click();
      toast('Clip exported as WebM.');
    } catch (err) { toast('Export failed: ' + err.message, true); }
    busy(b, false, 'Export clip (WebM)');
  });
  // AI plan from a pasted transcript (moments / lecture concepts)
  const planBtn = $('plan');
  if (planBtn) planBtn.addEventListener('click', async (e) => {
    if (!requireKey()) return;
    const text = $('transcript').value.trim();
    if (text.length < 120) { toast('Paste a longer transcript so the AI has something to work with.', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const isLecture = tool === 'lecture-clips';
      const d = await geminiJson(isLecture
        ? `From this lecture transcript, find the key concepts a student must revise. Return JSON only: {"items":[{"title":"concept name","at":"timestamp or '—' if none in text","why":"one line: why it matters for the exam","hook":"3-6 word memory hook"}]} Give up to 8 items, in teaching order. Transcript:\n${text.slice(0, 24000)}`
        : `From this video transcript, pick the best moments for short clips. Return JSON only: {"items":[{"title":"catchy clip title","at":"timestamp or '—' if none in text","why":"one line: why this moment works","hook":"3-7 punchy words"}]} Give up to 8 moments, best first. Transcript:\n${text.slice(0, 24000)}`);
      out('planresult', (d.items || []).map((m, i) => `<div class="outcard"><b>${i + 1}. ${esc(m.title)}</b>
        <p class="small dim mt">At: ${esc(m.at || '—')} · ${esc(m.why || '')}</p>
        <p class="mt"><span class="tag y">Hook</span> ${esc(m.hook || '')}</p></div>`).join('') || '<div class="outcard">No strong moments found in this transcript.</div>');
    } catch (err) { toast(err.message, true); }
    busy(b, false, isLectureLabel());
  });
  function isLectureLabel() { return tool === 'lecture-clips' ? 'Find key concepts' : 'Find best moments'; }
}

/* ---------- Stream Clipper (link) ---------- */
if (tool === 'clipper') {
  $('plan').addEventListener('click', async (e) => {
    if (!requireKey()) return;
    const text = $('transcript').value.trim();
    if (text.length < 120) { toast('Paste the stream transcript or chat log first (see the honest note above).', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const d = await geminiJson(`You are a top stream clipper. From this stream transcript, pick up to 8 moments for viral Shorts. Return JSON only: {"items":[{"title":"catchy, max 60 chars","at":"timestamp or '—'","score":0,"hook":"3-7 punchy words","why":"one short line"}]} Score strictly 0-99. Skip silence, menus, sponsor talk, intros. Transcript:\n${text.slice(0, 24000)}`);
      out('planresult', (d.items || []).map((m, i) => `<div class="outcard"><div class="spread"><b>${i + 1}. ${esc(m.title)}</b><span class="tag y">${esc(String(m.score ?? ''))}</span></div>
        <p class="small dim mt">At: ${esc(m.at || '—')} · ${esc(m.why || '')}</p><p class="mt"><span class="tag y">Hook</span> ${esc(m.hook || '')}</p></div>`).join(''));
    } catch (err) { toast(err.message, true); }
    busy(b, false, 'Find best moments');
  });
}

/* ---------- Your Own Branding ---------- */
if (tool === 'branding') {
  const LS = 'sc_branding_v1';
  const saved = JSON.parse(localStorage.getItem(LS) || '{}');
  if (saved.name) $('bname').value = saved.name;
  let logoUrl = saved.logo || '';
  const apply = () => {
    $('blogo').src = logoUrl || ''; $('blogo').style.display = logoUrl ? 'block' : 'none';
    $('bnameov').textContent = $('bname').value || '';
    localStorage.setItem(LS, JSON.stringify({ name: $('bname').value, logo: logoUrl }));
  };
  $('bname').addEventListener('input', apply);
  $('logofile').addEventListener('change', (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => { logoUrl = String(r.result); apply(); }; r.readAsDataURL(f);
  });
  $('bgfile').addEventListener('change', (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const v = $('bvid'); v.src = URL.createObjectURL(f); $('bstage').classList.remove('hidden'); apply();
  });
  $('snap').addEventListener('click', () => {
    const v = $('bvid'); if (!v.videoWidth) { toast('Upload a video and play it to the frame you want.', true); return; }
    const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight;
    const x = cv.getContext('2d'); x.drawImage(v, 0, 0);
    const finish = () => { const a = document.createElement('a'); a.download = 'branded-frame.png'; a.href = cv.toDataURL('image/png'); a.click(); };
    x.fillStyle = '#fff'; x.font = `900 ${Math.round(cv.width * 0.045)}px Poppins, Arial`; x.shadowColor = '#000'; x.shadowBlur = 8;
    x.fillText($('bname').value || '', 24, cv.height - 24);
    if (logoUrl) { const im = new Image(); im.onload = () => { const w = cv.width * 0.16; x.drawImage(im, cv.width - w - 24, cv.height - w * im.height / im.width - 24, w, w * im.height / im.width); finish(); }; im.src = logoUrl; }
    else finish();
  });
  apply();
}

/* ---------- helpers ---------- */
function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click();
}
function fmt(s) { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60), x = s % 60; return `${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; }
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
function roundRect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
function wrapText(x, text, a, b, maxW, lh) {
  const words = text.split(/\s+/); let line = '', y = b;
  for (const w of words) { const test = line ? line + ' ' + w : w; if (x.measureText(test).width > maxW && line) { x.fillText(line, a, y); line = w; y += lh; } else line = test; }
  if (line) x.fillText(line, a, y);
}
