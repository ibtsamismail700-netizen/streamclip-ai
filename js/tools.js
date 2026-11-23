// StreamClip AI — tool logic. All AI runs in the browser on the visitor's key.
import { requireKey, hasKey, geminiText, geminiJson, geminiImage, geminiParts, geminiPartsJson, geminiYouTubeJson, geminiTTS, GEMINI_VOICES, fileToInline, esc } from './gemini.js';
import { toast } from './site.js';
import { initEditor } from './editor.js';

const $ = (id) => document.getElementById(id);
const tool = document.body.dataset.tool;
const busy = (btn, on, label) => { btn.disabled = on; btn.innerHTML = on ? '<span class="spin"></span> Working…' : label; };
// Visible retry progress: when Google rate-limits a call, gemini.js waits
// and retries — this callback makes the wait VISIBLE on the busy button
// (and a status line, when the tool has one) instead of a silent spinner.
const retryNote = (btn, el) => ({ attempt, total }) => {
  const msg = `Google is busy — retrying (${attempt}/${total})…`;
  if (btn) btn.innerHTML = `<span class="spin"></span> ${msg}`;
  if (el) el.textContent = msg;
};
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
function saveShort(title, videoEl) {
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
    arr.unshift({ title: title || 'Untitled short', thumb, when: Date.now() });
    localStorage.setItem(SHORTS_LS, JSON.stringify(arr.slice(0, 12)));
  } catch {}
}
function chunkText(text, size = 5000) {
  const blocks = text.split(/\n\s*\n/); const chunks = []; let cur = '';
  for (const b of blocks) { if ((cur + '\n\n' + b).length > size && cur) { chunks.push(cur); cur = b; } else cur = cur ? cur + '\n\n' + b : b; }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [text];
}

/* ---------- Hooks + Title Generator ---------- */
if (tool === 'hooks') {
  on('go', 'click', async (e) => {
    if (!requireKey()) return;
    const topic = $('topic').value.trim();
    if (!topic) { toast('Write your topic first.', true); return; }
    const n = Number($('hcount').value);
    const b = e.currentTarget; busy(b, true);
    try {
      const d = await geminiJson(`You are a viral short-form content strategist. Topic: "${topic}". Platform: ${$('platform').value}. Tone: ${$('tone').value}. Hook style: ${$('hstyle').value}. Language: ${$('hlang').value}.
Return JSON only: {"hooks":["..."],"titles":["..."],"hashtags":["..."]}
Give exactly ${n} hooks (3-7 punchy words each, all in the chosen hook style, no emojis), ${Math.max(4, n - 2)} titles (max 60 characters each), ${n} hashtags (no # symbol, single words or short phrases). Write hooks and titles in the chosen language.`, { onRetry: retryNote(b) });
      const hooks = d.hooks || [], titles = d.titles || [], tags = (d.hashtags || []).map(h => '#' + String(h).replace(/\s+/g, ''));
      out('result', `
        <div class="outcard"><div class="spread"><b>Hooks — say one in the first 2 seconds</b><button class="chip" id="ch">Copy hooks</button></div><ol>${hooks.map(h => `<li>${esc(h)}</li>`).join('')}</ol></div>
        <div class="outcard"><div class="spread"><b>Titles</b><button class="chip" id="ct">Copy titles</button></div><ol>${titles.map(t => `<li>${esc(t)}</li>`).join('')}</ol></div>
        <div class="outcard"><div class="spread"><b>Hashtags</b><button class="chip" id="ctags">Copy hashtags</button></div><p class="out mt">${tags.map(esc).join(' ')}</p></div>
        <button class="btn dark block mt" id="call">Copy everything</button>`);
      on('ch', 'click', () => copyText(hooks.join('\n'), 'Hooks copied.'));
      on('ct', 'click', () => copyText(titles.join('\n'), 'Titles copied.'));
      on('ctags', 'click', () => copyText(tags.join(' '), 'Hashtags copied.'));
      on('call', 'click', () => copyText(`HOOKS\n${hooks.join('\n')}\n\nTITLES\n${titles.join('\n')}\n\n${tags.join(' ')}`, 'Everything copied.'));
    } catch (err) { toast(err.message, true); }
    busy(b, false, 'Generate hooks & titles');
  });
}

/* ---------- Caption Translation ---------- */
if (tool === 'translate') {
  on('go', 'click', async (e) => {
    if (!requireKey()) return;
    const text = $('src').value.trim();
    if (!text) { toast('Paste your captions first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    const st = $('tstatus');
    try {
      const chunks = chunkText(text, 4500);
      const parts = [];
      for (let i = 0; i < chunks.length; i++) {
        if (st) st.textContent = chunks.length > 1 ? `Translating part ${i + 1} of ${chunks.length}…` : 'Translating…';
        parts.push(await geminiText(`Translate these video captions from ${$('sfrom').value} into ${$('lang').value}. Style: ${$('tstyle').value}. Keep every line break and every timestamp exactly as it is. Translate only the spoken words. Do not add explanations, do not wrap in code fences.\n\n${chunks[i]}`, { temperature: 0.3, onRetry: retryNote(b, st) }));
      }
      const r = parts.join('\n\n');
      if (st) st.textContent = 'Done — translation ready below.';
      out('result', `<div class="outcard"><div class="spread"><b>Translated captions (${esc($('lang').value)})</b><span class="tag y">${chunks.length} part${chunks.length > 1 ? 's' : ''}</span></div><p class="out mt">${esc(r)}</p>
        <div class="btns two mt"><button class="btn dark sm" id="copytr">Copy translation</button><button class="btn sm" id="dltr">Download (.srt)</button></div></div>`);
      on('copytr', 'click', () => copyText(r, 'Translation copied.'));
      on('dltr', 'click', () => download('translated-captions.srt', r, 'text/plain'));
    } catch (err) { toast(err.message, true); if (st) st.textContent = ''; }
    busy(b, false, 'Translate captions');
  });
}

/* ---------- Lecture to Notes ---------- */
if (tool === 'notes') {
  on('go', 'click', async (e) => {
    if (!requireKey()) return;
    const text = $('src').value.trim();
    if (text.length < 80) { toast('Paste a longer lecture transcript (at least a few paragraphs).', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const d = await geminiJson(`You are a study-notes writer. Detail level: ${$('nlevel').value}. Write the notes in: ${$('nlang').value}. From this lecture transcript, make clean revision notes.
Return JSON only: {"title":"...","summary":"...","keyPoints":["..."],"definitions":[{"term":"...","meaning":"..."}],"formulas":["..."],"examTraps":["..."],"remember":["..."]}
Keep points short and exact to the transcript. Transcript:\n${text.slice(0, 30000)}`, { onRetry: retryNote(b) });
      const md = `# ${d.title}\n\n## Summary\n${d.summary}\n\n## Key points\n${(d.keyPoints || []).map(p => '- ' + p).join('\n')}\n\n## Definitions\n${(d.definitions || []).map(x => `- **${x.term}**: ${x.meaning}`).join('\n')}\n\n## Formulas & facts\n${(d.formulas || []).map(f => '- ' + f).join('\n')}\n\n## Exam traps\n${(d.examTraps || []).map(f => '- ' + f).join('\n')}\n\n## Remember\n${(d.remember || []).map(r => '- ' + r).join('\n')}`;
      out('result', `<div class="outcard"><h3>${esc(d.title || 'Lecture notes')}</h3>
        <p class="out mt"><b>Summary:</b> ${esc(d.summary || '')}</p>
        <b class="mt" style="display:block">Key points</b><ul>${(d.keyPoints || []).map(p => `<li>${esc(p)}</li>`).join('')}</ul>
        ${(d.definitions || []).length ? `<b style="display:block" class="mt">Definitions</b><ul>${d.definitions.map(x => `<li><b>${esc(x.term)}:</b> ${esc(x.meaning)}</li>`).join('')}</ul>` : ''}
        ${(d.formulas || []).length ? `<b style="display:block" class="mt">Formulas & facts</b><ul>${d.formulas.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
        ${(d.examTraps || []).length ? `<b style="display:block" class="mt">Exam traps</b><ul>${d.examTraps.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
        <div class="btns two mt"><button class="btn sm" id="dln">Download notes (.md)</button><button class="btn dark sm" id="cpn">Copy notes</button></div></div>`);
      on('dln', 'click', () => download('lecture-notes.md', md, 'text/markdown'));
      on('cpn', 'click', () => copyText(md, 'Notes copied.'));
    } catch (err) { toast(err.message, true); }
    busy(b, false, 'Make my notes');
  });
}

/* ---------- Flashcards + Quiz ---------- */
if (tool === 'flashcards') {
  let cards = [], ci = 0, flipped = false, quizData = [], answered = 0, score = 0;
  on('go', 'click', async (e) => {
    if (!requireKey()) return;
    const text = $('src').value.trim();
    if (text.length < 80) { toast('Paste more study text first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const nc = Number($('fccount').value), nq = Number($('fqcount').value);
      const d = await geminiJson(`Make study material from this text. Difficulty: ${$('fdiff').value}. Return JSON only:
{"flashcards":[{"front":"question or term","back":"answer"}],"quiz":[{"q":"...","options":["a","b","c","d"],"answer":0,"why":"one line"}]}
Exactly ${nc} flashcards and ${nq} quiz questions. Exact to the text.\n${text.slice(0, 30000)}`, { onRetry: retryNote(b) });
      cards = d.flashcards || []; quizData = d.quiz || []; ci = 0; flipped = false; answered = 0; score = 0;
      out('result', `${cards.length ? `<h3 class="mt2">Flashcards — tap a card to flip</h3><div class="flashcard" id="fc"></div>
        <div class="btns three mt"><button class="btn dark" id="prev">Previous</button><button class="btn dark" id="shuf">Shuffle</button><button class="btn dark" id="next">Next</button></div>
        <p class="small dim mt" id="fcn"></p>
        <button class="btn sm mt" id="dldeck">Download deck (.txt)</button>` : ''}
        ${quizData.length ? `<h3 class="mt2">Quiz — tap an answer</h3><div class="outcard spread"><b>Your score</b><span class="tag y" id="qscore">0 / ${quizData.length}</span></div>
        ${quizData.map((q, qi) => `<div class="outcard"><b>Q${qi + 1}. ${esc(q.q)}</b>
        <div class="chips mt">${q.options.map((o, oi) => `<button class="chip" data-q="${qi}" data-o="${oi}">${esc(o)}</button>`).join('')}</div>
        <p class="small dim mt hidden" id="why-${qi}"></p></div>`).join('')}
        <p class="small dim mt" id="qfinal"></p>` : ''}`);
      const draw = () => { if (!cards.length) return; $('fc').textContent = flipped ? cards[ci].back : cards[ci].front; $('fcn').textContent = `Card ${ci + 1} of ${cards.length} — ${flipped ? 'answer' : 'question'} side`; };
      if (cards.length) {
        draw();
        on('fc', 'click', () => { flipped = !flipped; draw(); });
        on('prev', 'click', () => { ci = (ci - 1 + cards.length) % cards.length; flipped = false; draw(); });
        on('next', 'click', () => { ci = (ci + 1) % cards.length; flipped = false; draw(); });
        on('shuf', 'click', () => { for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; } ci = 0; flipped = false; draw(); toast('Deck shuffled.'); });
        on('dldeck', 'click', () => download('flashcards.txt', cards.map((c, i) => `CARD ${i + 1}\nQ: ${c.front}\nA: ${c.back}`).join('\n\n'), 'text/plain'));
      }
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
        if (answered === quizData.length) { const f = $('qfinal'); if (f) f.textContent = `Quiz finished — you scored ${score} out of ${quizData.length} (${Math.round(score / quizData.length * 100)}%). ${score === quizData.length ? 'Perfect — exam ready.' : 'Review the red ones above, then regenerate for a fresh round.'}`; }
      }));
    } catch (err) { toast(err.message, true); }
    busy(b, false, 'Make flashcards & quiz');
  });
}

/* ---------- Video Presentation Maker ---------- */
if (tool === 'presentation') {
  // Populate the Gemini voice picker.
  const vsel = $('pvoice');
  if (vsel) vsel.innerHTML = GEMINI_VOICES.map(v => `<option${v === 'Kore' ? ' selected' : ''}>${v}</option>`).join('');
  on('go', 'click', async (e) => {
    if (!requireKey()) return;
    const topic = $('topic').value.trim();
    if (!topic) { toast('Write your presentation topic first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const d = await geminiJson(`Plan a student class-presentation video. Topic: "${topic}". Extra points from the student: "${$('points').value.trim()}". Slides: ${$('slides').value}. Audience level: ${$('level').value}. Narration language: ${$('plang').value}. Speaking tone: ${$('ptone').value}.
Return JSON only: {"title":"...","slides":[{"title":"...","bullets":["..."],"narration":"..."}]}
Narration per slide: 2-4 natural spoken sentences in the chosen language and tone, written to be read aloud by an AI voice. No greetings on every slide.`, { onRetry: retryNote(b) });
      const script = (d.slides || []).map((s, i) => `SLIDE ${i + 1}: ${s.title}\n${s.narration}`).join('\n\n');
      out('result', `<div class="outcard"><h3>${esc(d.title || topic)}</h3><p class="small dim mt">Voice for playback: <b>${esc(vsel ? vsel.value : 'Kore')}</b> (change it above and re-play any slide). Play uses Gemini's AI voice on your key.</p></div>
        ${(d.slides || []).map((s, i) => `<div class="outcard slidecard"><b>Slide ${i + 1} — ${esc(s.title)}</b>
          <ul>${(s.bullets || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
          <p class="small dim mt"><b>Voice script:</b> ${esc(s.narration)}</p>
          <div class="btns two mt"><button class="btn sm" data-tts="${i}">▶ Play AI voice</button><button class="btn dark sm" data-dla="${i}">Download voice (.wav)</button></div>
          <div id="aud-${i}" class="mt"></div></div>`).join('')}
        <button class="btn sm mt" id="dls">Download voice script (.txt)</button>`);
      on('dls', 'click', () => download('presentation-script.txt', `${d.title || topic}\n\n${script}`, 'text/plain'));
      const speak = async (i, dl) => {
        const s = (d.slides || [])[i]; if (!s) return;
        try {
          toast('Generating the AI voice…');
          const blob = await geminiTTS(s.narration, vsel ? vsel.value : 'Kore', { onRetry: ({ attempt, total }) => { const host = $(`aud-${i}`); if (host) host.textContent = `Google is busy — retrying the voice (${attempt}/${total})…`; } });
          const url = URL.createObjectURL(blob);
          if (dl) { const a = document.createElement('a'); a.href = url; a.download = `slide-${i + 1}-voice.wav`; a.click(); }
          else { const host = $(`aud-${i}`); if (host) host.innerHTML = `<audio controls autoplay src="${url}" style="width:100%"></audio>`; }
        } catch (err) { toast('Voice failed: ' + err.message, true); }
      };
      document.querySelectorAll('[data-tts]').forEach(x => x.addEventListener('click', () => speak(Number(x.dataset.tts), false)));
      document.querySelectorAll('[data-dla]').forEach(x => x.addEventListener('click', () => speak(Number(x.dataset.dla), true)));
    } catch (err) { toast(err.message, true); }
    busy(b, false, 'Plan my presentation');
  });
}

/* ---------- Thumbnail Creator / Redesigner ---------- */
if (tool === 'thumbnail') {
  const RATIOS = { '16:9': [1280, 720], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:3': [1280, 960], '3:4': [1080, 1440] };
  let ratio = '16:9';
  let file = null, subjectImg = null, analysisText = '';
  // Tabs
  const setTab = (which) => {
    $('tab-creator').classList.toggle('on', which === 'creator');
    $('tab-redesigner').classList.toggle('on', which === 'redesigner');
    $('panel-creator').classList.toggle('hidden', which !== 'creator');
    $('panel-redesigner').classList.toggle('hidden', which !== 'redesigner');
  };
  on('tab-creator', 'click', () => setTab('creator'));
  on('tab-redesigner', 'click', () => setTab('redesigner'));
  // Ratio chips (both panels share one state)
  const paintRatios = () => { document.querySelectorAll('[data-ratio]').forEach(c => c.classList.toggle('on', c.dataset.ratio === ratio)); const rl = $('ratiolabel'); if (rl) rl.textContent = ratio; };
  document.querySelectorAll('[data-ratio]').forEach(c => c.addEventListener('click', () => { ratio = c.dataset.ratio; paintRatios(); }));
  paintRatios();
  on('plusbtn', 'click', () => $('ratiopop').classList.toggle('hidden'));
  // Text colour swatches
  let inkColor = '#ffffff';
  document.querySelectorAll('[data-ink]').forEach(c => c.addEventListener('click', () => { inkColor = c.dataset.ink; document.querySelectorAll('[data-ink]').forEach(x => x.classList.toggle('on', x === c)); }));
  // Upload for redesign
  on('tfile', 'change', async (e) => {
    file = e.target.files?.[0] || null;
    if (file) { const u = URL.createObjectURL(file); $('tprev').src = u; $('tprev').classList.remove('hidden'); subjectImg = await loadImg(u).catch(() => null); }
  });
  on('analyse', 'click', async (e) => {
    if (!requireKey()) return;
    if (!file) { toast('Upload a thumbnail first.', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const part = await fileToInline(file);
      const d = await geminiPartsJson([part, { text: `Analyse this YouTube thumbnail like a top thumbnail designer. Return JSON only:
{"topic":"what the video is about","textOnThumbnail":"the EXACT text written on the thumbnail, word for word","subject":"the main subject/face/object","works":["what works, short"],"weak":["what is weak, short"],"directions":["4 redesign directions that look completely different from each other but keep the SAME text"]}` }], { temperature: 0.4, onRetry: retryNote(b) });
      analysisText = d.textOnThumbnail || '';
      if (analysisText && !$('ttext').value.trim()) $('ttext').value = analysisText;
      out('aresult', `<div class="outcard"><b>Analysis</b>
        <p class="out mt"><b>Topic:</b> ${esc(d.topic || '')}\n<b>Text on it:</b> ${esc(d.textOnThumbnail || '(none found)')}\n<b>Main subject:</b> ${esc(d.subject || '')}</p>
        ${(d.works || []).length ? `<b style="display:block" class="mt">What works</b><ul>${d.works.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        ${(d.weak || []).length ? `<b style="display:block" class="mt">What is weak</b><ul>${d.weak.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        ${(d.directions || []).length ? `<b style="display:block" class="mt">Redesign directions (used below)</b><ul>${d.directions.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        <p class="small dim mt">The text box below now holds the exact text from your thumbnail — every version keeps it word for word.</p></div>`);
    } catch (err) { toast(err.message, true); }
    busy(b, false, 'Analyse thumbnail');
  });
  // Canvas thumbnail painter: exact pixel size for the chosen ratio.
  function paintThumb(cv, st, text, img) {
    const [W, H] = RATIOS[ratio]; cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, st.bg[0]); g.addColorStop(1, st.bg[1]);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const portrait = H > W;
    if (img) {
      // Subject image: side panel on landscape, top panel on portrait.
      const box = portrait ? [W * 0.06, H * 0.05, W * 0.88, H * 0.42] : (st.pos === 'right' ? [W * 0.04, H * 0.12, W * 0.44, H * 0.76] : [W * 0.52, H * 0.12, W * 0.44, H * 0.76]);
      x.save(); roundRect(x, box[0], box[1], box[2], box[3], 26); x.clip();
      const sc = Math.max(box[2] / img.width, box[3] / img.height);
      x.drawImage(img, box[0] + (box[2] - img.width * sc) / 2, box[1] + (box[3] - img.height * sc) / 2, img.width * sc, img.height * sc);
      x.restore();
    }
    const tx = portrait ? W * 0.06 : (img && st.pos !== 'right' ? W * 0.05 : W * 0.52);
    const tw = portrait ? W * 0.88 : (img ? W * 0.43 : W * 0.9);
    const ty = portrait ? H * 0.58 : H * 0.3;
    x.fillStyle = st.accent; x.fillRect(tx, ty - H * 0.075, Math.min(260, tw * 0.45), Math.max(10, H * 0.018));
    x.fillStyle = inkColor; x.strokeStyle = 'rgba(0,0,0,.85)'; x.lineWidth = Math.max(6, W * 0.008); x.lineJoin = 'round';
    const fs = Math.round(W * (String(text).length > 18 ? 0.062 : 0.078));
    x.font = `900 ${fs}px Poppins, Arial, sans-serif`; x.textAlign = 'left';
    const words = String(text).toUpperCase().split(/\s+/); let line = '', yy = ty;
    const lines = [];
    for (const w of words) { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > tw && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    for (const ln of lines.slice(0, 4)) { x.strokeText(ln, tx, yy); x.fillText(ln, tx, yy); yy += fs * 1.08; }
    x.fillStyle = st.accent; x.fillRect(tx, yy + H * 0.01, Math.min(260, tw * 0.45), Math.max(10, H * 0.018));
    return cv;
  }
  const varStyles = [
    { name: 'Bold Yellow', bg: ['#ffc81f', '#e3a500'], accent: '#e02c2c', pos: 'left' },
    { name: 'Dark Neon', bg: ['#0b1026', '#23307a'], accent: '#4aa8ff', pos: 'right' },
    { name: 'Red Alert', bg: ['#3a0d0d', '#a8231b'], accent: '#ffe46b', pos: 'left' },
    { name: 'Clean Mint', bg: ['#06281a', '#157a45'], accent: '#ffe46b', pos: 'right' },
    { name: 'Purple Pop', bg: ['#2a0a4a', '#7b2ff7'], accent: '#ffe46b', pos: 'left' },
    { name: 'Mono Contrast', bg: ['#0a0a0a', '#2e2e2e'], accent: '#ffffff', pos: 'right' },
  ];
  on('makevars', 'click', async (e) => {
    const text = $('ttext').value.trim();
    if (!text) { toast('Write the thumbnail text first (analyse fills it automatically).', true); return; }
    const b = e.currentTarget; busy(b, true);
    const host = $('vars'); host.innerHTML = '';
    varStyles.forEach((st, i) => {
      const cv = paintThumb(document.createElement('canvas'), st, text, subjectImg);
      cv.className = 'thumbcv';
      const card = document.createElement('div'); card.className = 'outcard';
      card.innerHTML = `<div class="spread"><b>Version ${i + 1} — ${st.name}</b><span class="tag y">${ratio} · ${RATIOS[ratio][0]}×${RATIOS[ratio][1]}</span></div>`;
      card.appendChild(cv);
      const dl = document.createElement('button'); dl.className = 'btn sm mt'; dl.textContent = 'Download this version';
      dl.addEventListener('click', () => { const a = document.createElement('a'); a.download = `thumbnail-${ratio.replace(':', 'x')}-v${i + 1}.png`; a.href = cv.toDataURL('image/png'); a.click(); });
      card.appendChild(dl); host.appendChild(card);
    });
    busy(b, false, 'Generate different versions');
    toast('6 different versions made — same text on all, in ' + ratio + '.');
  });
  // Creator: AI background + your headline text design, composed at exact ratio size.
  on('cgo', 'click', async (e) => {
    if (!requireKey()) return;
    const prompt = $('cprompt').value.trim();
    const head = $('chead').value.trim();
    if (!prompt && !head) { toast('Describe the thumbnail or write its headline text.', true); return; }
    const b = e.currentTarget; busy(b, true);
    try {
      const [W, H] = RATIOS[ratio];
      let bg = null;
      try {
        const url = await geminiImage(`YouTube thumbnail background art, ${$('cstyle').value} style, dramatic, high contrast, no text, no letters, no watermark: ${prompt || head}`, null, ratio, { onRetry: retryNote(b) });
        bg = await loadImg(url);
      } catch { /* gradient fallback below */ }
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const x = cv.getContext('2d');
      if (bg) { const sc = Math.max(W / bg.width, H / bg.height); x.drawImage(bg, (W - bg.width * sc) / 2, (H - bg.height * sc) / 2, bg.width * sc, bg.height * sc); }
      else { const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#23307a'); g.addColorStop(1, '#0b1026'); x.fillStyle = g; x.fillRect(0, 0, W, H); }
      const sh = x.createLinearGradient(0, H * 0.45, 0, H); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.72)');
      x.fillStyle = sh; x.fillRect(0, 0, W, H);
      if (head) {
        const fs = Math.round(W * (head.length > 18 ? 0.07 : 0.088));
        x.font = `900 ${fs}px Poppins, Arial, sans-serif`; x.textAlign = 'center';
        x.lineWidth = Math.max(8, W * 0.01); x.strokeStyle = 'rgba(0,0,0,.9)'; x.lineJoin = 'round'; x.fillStyle = inkColor;
        const words = head.toUpperCase().split(/\s+/); const lines = []; let line = '';
        for (const w of words) { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > W * 0.9 && line) { lines.push(line); line = w; } else line = t; }
        if (line) lines.push(line);
        let yy = H - (lines.length - 1) * fs * 1.08 - H * 0.06;
        for (const ln of lines.slice(0, 4)) { x.strokeText(ln, W / 2, yy); x.fillText(ln, W / 2, yy); yy += fs * 1.08; }
      }
      out('cresult', '');
      const host = $('cresult');
      const card = document.createElement('div'); card.className = 'outcard';
      card.innerHTML = `<div class="spread"><b>Your thumbnail</b><span class="tag y">${ratio} · ${W}×${H}px</span></div>`;
      cv.className = 'thumbcv'; card.appendChild(cv);
      const dl = document.createElement('button'); dl.className = 'btn sm mt'; dl.textContent = 'Download thumbnail (PNG)';
      dl.addEventListener('click', () => { const a = document.createElement('a'); a.download = `thumbnail-${ratio.replace(':', 'x')}.png`; a.href = cv.toDataURL('image/png'); a.click(); });
      card.appendChild(dl); host.appendChild(card);
      toast(bg ? 'AI thumbnail made at ' + ratio + '.' : 'Made with a designed background (image model did not answer) at ' + ratio + '.');
    } catch (err) { toast(err.message, true); }
    busy(b, false, 'Create thumbnail');
  });
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
  // In-browser export: records the chosen segment in real time to WebM.
  // Vertical mode renders through a 1080x1920 canvas (centre-crop) instead.
  on('export', 'click', async () => {
    if (!v.src) { toast('Upload a video first.', true); return; }
    const mime = pickRecorderMime();
    if (mime === null) { toast('This browser cannot export in-page. Use Chrome on Android/desktop.', true); return; }
    const vertical = $('fmt') && $('fmt').value === 'vertical';
    const b = $('export'); busy(b, true, 'Export clip (WebM)');
    try {
      let stream;
      let raf = 0;
      if (vertical) {
        const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1920;
        const cx = cv.getContext('2d');
        const draw = () => { const sc = Math.max(1080 / v.videoWidth, 1920 / v.videoHeight); cx.fillStyle = '#000'; cx.fillRect(0, 0, 1080, 1920); cx.drawImage(v, (1080 - v.videoWidth * sc) / 2, (1920 - v.videoHeight * sc) / 2, v.videoWidth * sc, v.videoHeight * sc); raf = requestAnimationFrame(draw); };
        draw();
        stream = cv.captureStream(30);
        if (v.captureStream) v.captureStream().getAudioTracks().forEach(t => stream.addTrack(t));
        b._stopDraw = () => cancelAnimationFrame(raf);
      } else {
        if (!v.captureStream) { toast('This browser cannot export in-page. Use Chrome on Android/desktop.', true); busy(b, false, 'Export clip (WebM)'); return; }
        stream = v.captureStream();
      }
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      rec.ondataavailable = (x) => chunks.push(x.data);
      const done = new Promise(r => rec.onstop = r);
      v.currentTime = Number($('in').value);
      await v.play(); rec.start(250);
      const stopAt = Number($('out').value);
      await new Promise(r => { const iv = setInterval(() => { if (v.currentTime >= stopAt || v.paused) { clearInterval(iv); r(); } }, 200); });
      v.pause(); rec.stop(); await done;
      if (b._stopDraw) b._stopDraw();
      const name = ($('ctitle')?.value.trim() || 'streamclip-clip').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'streamclip-clip';
      download(`${name}.webm`, new Blob(chunks, { type: 'video/webm' }));
      saveShort(($('ctitle')?.value.trim() || name), v);
      toast(vertical ? 'Vertical 9:16 clip exported as WebM.' : 'Clip exported as WebM.');
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
  let scanRange = 'whole', shortLen = 45, pickCount = 3, voiceMode = 'none';
  let scannedRanges = [], scannedUrl = '';

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
      hook: b.hookText || m.hook || '',
      cut: (b.cutStart != null && b.cutEnd != null) ? `${fmt(b.cutStart)} – ${fmt(b.cutEnd)}` : timeLine(m),
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
    return picks.map((m, i) => {
      const br = momentBrief(m);
      return `## Short ${i + 1}: ${br.title}\n- Time: ${br.time} (score ${br.score})\n- Watch this scene: ${br.watch || '—'}\n- Cut: ${br.cut}\n- Hook: ${br.hook || '—'}\n- Frame: ${br.frame}\n- Captions: ${br.captions}\n- Voice: ${br.voice} (${br.voiceVolumes})\n- Music: ${br.music}\n- Top text: ${br.topText}\n- Overlays: ${br.overlays.join('; ') || 'none'}\n- Posting caption: ${br.postCaption || '—'}`;
    }).join('\n\n');
  }
  function renderBrief() {
    const host = $('briefhost'); if (!host) return;
    const picks = found.filter(m => m.picked);
    if (!picks.length) { host.innerHTML = '<div class="outcard mt"><b>No moments picked.</b><p class="small dim mt">Pick at least one moment above first.</p></div>'; return; }
    host.innerHTML = `<h3 class="mt2">Your shorts plan — ${picks.length} picked</h3>` + picks.map((m) => {
      const br = momentBrief(m);
      return `<div class="outcard"><div class="spread"><b>${esc(br.title)}</b><span class="tag y">${esc(br.time)}</span></div>
      <p class="small dim mt">Score ${br.score}${br.watch ? ` · <a href="${br.watch}" target="_blank" rel="noopener">▶ Watch this scene</a>` : ''}</p>
      <p class="small mt"><b>Cut:</b> ${esc(br.cut)}<br><b>Hook:</b> ${esc(br.hook || '—')}<br><b>Frame:</b> ${esc(br.frame)}<br><b>Captions:</b> ${esc(br.captions)}<br><b>Voice:</b> ${esc(br.voice)} (${esc(br.voiceVolumes)})<br><b>Music:</b> ${esc(br.music)}<br><b>Top text:</b> ${esc(br.topText)}${br.overlays.length ? `<br><b>Overlays:</b> ${esc(br.overlays.join('; '))}` : ''}${br.postCaption ? `<br><b>Posting caption:</b> ${esc(br.postCaption)}` : ''}</p>
      <button class="chip mt" data-editb="${found.indexOf(m)}">Open editor</button></div>`;
    }).join('') +
      `<div class="note mt"><div><b>Render queue.</b><div class="small dim">These briefs are saved for the render engine — the final downloadable videos are queued, not rendered here, because this website does not run a render engine yet. Nothing above fakes a finished file.</div></div></div>
      <div class="btns two mt"><button class="btn sm" id="copybrief">Copy brief</button><button class="btn dark sm" id="dlbrief">Download brief (.md)</button></div>`;
    host.querySelectorAll('[data-editb]').forEach(btn => btn.addEventListener('click', () => { const m = found[Number(btn.dataset.editb)]; if (m && editorHandle) editorHandle.open(m); }));
    on('copybrief', 'click', () => copyText(briefText(picks), 'Brief copied.'));
    on('dlbrief', 'click', () => download('streamclip-brief.md', briefText(picks), 'text/markdown'));
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function finishPick(count, minScore) {
    found.sort((a, b) => b.score - a.score);
    let n = 0;
    for (const m of found) { m.picked = m.score >= minScore && n < count; if (m.picked) n++; }
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
  const stepEl = (id, state, text) => { const el = $(id); if (!el) return; el.className = 'step' + (state ? ' ' + state : ''); el.querySelector('span:last-child').textContent = text; };
  const scanRetry = (id) => ({ attempt, total }) => stepEl(id, 'now', `Google is busy — retrying (${attempt}/${total})…`);
  const PROBE_PROMPT = 'Return JSON only: {"durationSec": 0, "title": ""} — durationSec is the total length of this video in seconds (a number), title is its title. If you truly cannot tell the length, use 0.';

  /* ----- YouTube scan: Gemini watches the video in time windows ----- */
  async function scanWindow(url, s, en) {
    const niche = $('cniche').value, style = $('cstyle').value;
    return geminiYouTubeJson(url, `You are a top stream clipper. Watch ONLY the segment of this video you were given (it starts at ${fmt(s)} of the full video). Niche: ${niche}. Clip style: ${style}. Aim for moments about ${shortLen} seconds long.
Find the moments in THIS segment that would make viral Shorts. Return JSON only:
{"beyondEnd": false, "moments": [{"startSec": 0, "endSec": 0, "score": 0, "title": "...", "hook": "...", "why": "..."}]}
startSec/endSec are seconds FROM THE START OF THIS SEGMENT. score is a strict viral score 0-99. title max 60 chars. hook is 3-7 punchy words. why is one short line. Skip silence, menus, sponsor reads, intros and outros. If this segment is past the end of the video, return {"beyondEnd": true, "moments": []}.`, { startSec: s, endSec: en, onRetry: scanRetry('st2') });
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
      found.push({ startSec: st, endSec: en, startLabel: `${fmt(st)}${en != null ? ' – ' + fmt(en) : ''}`, score: Math.max(0, Math.min(99, Number(m.score) || 0)), title: m.title || 'Moment', hook: m.hook || '', why: m.why || '', picked: false });
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
    $('scansteps').classList.remove('hidden');
    stepEl('st1', 'now', 'Asking Gemini about this video…');
    stepEl('st2', '', 'Watching in 10-minute windows and scoring moments');
    stepEl('st3', '', 'Ranking and pre-picking the best');
    try {
      if (!(durationSec > 0 && probedId === videoId)) {
        try {
          const probe = await geminiYouTubeJson(url, PROBE_PROMPT, { timeoutMs: 120000, onRetry: scanRetry('st1') });
          durationSec = Number(probe.durationSec) || 0;
          if (probe.title && !streamTitle) { streamTitle = probe.title; $('sc-title').textContent = streamTitle; }
          probedId = videoId;
          updateCalls();
        } catch { /* probe is best-effort; windows below still run */ }
      }
      stepEl('st1', 'ok', streamTitle ? `Video found: ${streamTitle}${durationSec ? ` · ${fmt(durationSec)} long` : ''}` : 'Video accepted by Gemini');
      stepEl('st2', 'now', 'Watching…');
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
        if (scanRange !== 'whole') stepEl('st2', 'now', 'Length unknown — scanning the whole video instead…');
        for (let w = 0; w < winsTotal; w++) winList.push([w * WIN, Math.min(total, w * WIN + WIN)]);
      }
      let beyond = false, droppedTotal = 0;
      for (let k = 0; k < winList.length && !beyond; k++) {
        const [s, en] = winList[k];
        stepEl('st2', 'now', `Watching ${fmt(s)} – ${fmt(en)} (window ${k + 1} of ${winList.length})…`);
        try {
          const d = await scanWindow(url, s, en);
          if (d.beyondEnd) { beyond = true; break; }
          droppedTotal += addMoments(d.moments, s).dropped;
          scannedRanges.push([s, en]);
          found.sort((a, b2) => b2.score - a.score);
          renderFound();
        } catch (err) {
          if (k === 0) throw err; // first window failing = the link itself failed
          stepEl('st2', 'now', `Window ${k + 1} could not be watched (${err.message}) — continuing…`);
        }
      }
      stepEl('st2', 'ok', `Watched the video — ${found.length} moments found${droppedTotal ? ` · Ignored ${droppedTotal} moment${droppedTotal > 1 ? 's' : ''} past the video's end` : ''}`);
      finishPick(pickCount, Number($('cmin').value));
      renderFound();
      stepEl('st3', 'ok', `Best ${found.filter(m => m.picked).length} moments pre-picked (score ≥ ${$('cmin').value})`);
      if (!found.length) toast('Gemini watched it but found no strong moments. Try the transcript mode, or a different stream.', true);
    } catch (err) {
      stepEl('st1', '', 'Scan stopped');
      stepEl('st2', '', '');
      toast('YouTube scan failed: ' + err.message + ' — private/age-restricted or very long videos can fail; the Transcript tab always works.', true);
    }
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
    $('scansteps').classList.remove('hidden');
    stepEl('st2', 'now', 'Checking the newest part…');
    try {
      try {
        const p = await geminiYouTubeJson(url, PROBE_PROMPT, { timeoutMs: 120000, onRetry: scanRetry('st1') });
        if (Number(p.durationSec)) durationSec = Number(p.durationSec);
      } catch { /* keep the duration we have */ }
      const WIN = 600;
      const total = durationSec > 0 ? Math.min(durationSec, 4 * 3600) : 3600;
      const winsTotal = Math.max(1, Math.ceil(total / WIN));
      const ts = (winsTotal - 1) * WIN, te = total;
      const covered = scannedRanges.some(([s, en]) => s <= ts && en >= te);
      stepEl('st2', 'now', covered
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
      stepEl('st2', 'ok', `Newest part scanned — ${found.length} moments in total${dropped ? ` · Ignored ${dropped} moment${dropped > 1 ? 's' : ''} past the video's end` : ''}`);
    } catch (err) { toast('Newest-part scan failed: ' + err.message, true); renderFound(); }
  }

  /* ----- Transcript mode: same scoring engine, chunk by chunk ----- */
  on('tscan', 'click', async (e) => {
    if (!requireKey()) return;
    const text = $('transcript').value.trim();
    if (text.length < 120) { toast('Paste the stream transcript first (at least a few minutes of it).', true); return; }
    const b = e.currentTarget; busy(b, true);
    found = []; renderFound();
    const st = $('txstatus'); if (st) st.textContent = 'Reading the transcript…';
    try {
      const chunks = chunkText(text, 9000);
      for (let i = 0; i < chunks.length; i++) {
        if (st) st.textContent = `Scoring part ${i + 1} of ${chunks.length}… (${found.length} moments so far)`;
        const d = await geminiJson(`You are a top stream clipper. From this part of a stream transcript, pick the moments for viral Shorts. Return JSON only: {"items":[{"title":"catchy, max 60 chars","at":"timestamp as written in the text, or '—'","score":0,"hook":"3-7 punchy words","why":"one short line"}]} Score strictly 0-99. Skip silence, menus, sponsor talk, intros. Transcript part:\n${chunks[i]}`, { onRetry: retryNote(null, st) });
        for (const m of (d.items || [])) found.push({ startSec: parseTs(m.at), endSec: null, startLabel: m.at || '—', score: Math.max(0, Math.min(99, Number(m.score) || 0)), title: m.title || 'Moment', hook: m.hook || '', why: m.why || '', picked: false });
        found.sort((a, b2) => b2.score - a.score);
        renderFound();
      }
      finishPick(Number($('tcount').value), Number($('tmin').value));
      renderFound();
      if (st) st.textContent = `Done — ${found.length} moments found, best ${found.filter(m => m.picked).length} pre-picked.`;
    } catch (err) { toast(err.message, true); if (st) st.textContent = ''; }
    busy(b, false, 'Find best moments');
  });

  /* ----- clip editor (js/editor.js) ----- */
  editorHandle = initEditor({
    getFound: () => found,
    getMode: () => mode,
    getVideoId: () => videoId,
    getStreamTitle: () => streamTitle || 'this stream',
    getVoiceMode: () => voiceMode,
    getDuration: () => durationSec,
    pickedCount: () => found.filter(m => m.picked).length,
    rerender: () => renderFound(),
    onMake: () => { if (editorHandle) editorHandle.close(); renderFound(); renderBrief(); toast('Saved into the render queue — brief below.'); },
    onDelete: (m) => { found = found.filter(x => x !== m); if (editorHandle) editorHandle.close(); renderFound(); toast('Short deleted.'); },
  });
}

/* ---------- Your Own Branding ---------- */
if (tool === 'branding') {
  const LS = 'sc_branding_v1';
  const saved = JSON.parse(localStorage.getItem(LS) || '{}');
  if (saved.name) $('bname').value = saved.name;
  if (saved.pos) $('bpos').value = saved.pos;
  if (saved.size) $('bsize').value = saved.size;
  if (saved.op) $('bop').value = saved.op;
  let logoUrl = saved.logo || '', logoImg = null;
  const POS = {
    br: { logo: { right: '12px', bottom: '12px', left: 'auto', top: 'auto' }, name: { left: '12px', bottom: '12px', right: 'auto', top: 'auto' } },
    bl: { logo: { left: '12px', bottom: '12px', right: 'auto', top: 'auto' }, name: { right: '12px', bottom: '12px', left: 'auto', top: 'auto' } },
    tr: { logo: { right: '12px', top: '12px', left: 'auto', bottom: 'auto' }, name: { left: '12px', bottom: '12px', right: 'auto', top: 'auto' } },
    tl: { logo: { left: '12px', top: '12px', right: 'auto', bottom: 'auto' }, name: { right: '12px', bottom: '12px', left: 'auto', top: 'auto' } },
  };
  const setBox = (el, css) => { Object.assign(el.style, { left: '', right: '', top: '', bottom: '' }, css); };
  const apply = () => {
    const pos = POS[$('bpos').value] || POS.br;
    const lg = $('blogo'), nm = $('bnameov');
    lg.src = logoUrl || ''; lg.style.display = logoUrl ? 'block' : 'none';
    lg.style.maxWidth = `${$('bsize').value}px`; lg.style.maxHeight = `${Math.round($('bsize').value * 0.6)}px`;
    lg.style.opacity = $('bop').value / 100;
    setBox(lg, pos.logo);
    nm.textContent = $('bname').value || '';
    nm.style.opacity = $('bop').value / 100;
    nm.style.fontSize = `${Math.max(13, $('bsize').value / 6)}px`;
    setBox(nm, pos.name);
    if ($('bsizev')) $('bsizev').textContent = $('bsize').value;
    if ($('bopv')) $('bopv').textContent = $('bop').value + '%';
    localStorage.setItem(LS, JSON.stringify({ name: $('bname').value, logo: logoUrl, pos: $('bpos').value, size: $('bsize').value, op: $('bop').value }));
    if (logoUrl) { const im = new Image(); im.onload = () => { logoImg = im; }; im.src = logoUrl; }
  };
  ['bname'].forEach(id => on(id, 'input', apply));
  ['bpos', 'bsize', 'bop'].forEach(id => on(id, 'input', apply));
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
      const lx = (pos === 'bl' || pos === 'tl') ? 24 : W - w - 24;
      const ly = (pos === 'tl' || pos === 'tr') ? 24 : H - h - 24;
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
      const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight;
      const x = cv.getContext('2d');
      let raf = 0;
      const draw = () => { x.drawImage(v, 0, 0); drawBrand(x, cv.width, cv.height); raf = requestAnimationFrame(draw); };
      const stream = cv.captureStream(30);
      v.captureStream().getAudioTracks().forEach(t => stream.addTrack(t));
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = []; rec.ondataavailable = (xx) => chunks.push(xx.data);
      const done = new Promise(r => rec.onstop = r);
      v.currentTime = 0; draw(); await v.play(); rec.start(250);
      const tick = setInterval(() => { if (prog && v.duration) prog.textContent = `Rendering your branding onto the video… ${Math.round(v.currentTime / v.duration * 100)}%`; }, 300);
      await new Promise(r => { if (v.ended) return r(); v.addEventListener('ended', () => r(), { once: true }); setTimeout(r, (v.duration + 2) * 1000); });
      clearInterval(tick); cancelAnimationFrame(raf);
      rec.stop(); await done;
      download('branded-video.webm', new Blob(chunks, { type: 'video/webm' }));
      saveShort(($('bname').value.trim() || 'Branded clip'), v);
      if (prog) prog.textContent = 'Done — branded video downloaded. Your logo and name are burned into every frame.';
      toast('Branded video exported.');
    } catch (err) { toast('Export failed: ' + err.message, true); if (prog) prog.textContent = ''; }
    busy(b, false, 'Export branded video (WebM)');
  });
  apply();
}
