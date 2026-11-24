// StreamClip AI — clip editor for a picked Stream Clipper moment.
// The preview is the official YouTube embed (start/end) inside a 9:16 frame,
// with CSS overlays for top text, captions and Add-boxes, so the user SEES
// every choice. Every control writes into the moment's brief object — the
// same brief the "Make N shorts" flow renders. Nothing here renders a video
// file; the honest note in the editor section says so.
import { requireKey, hasKey, geminiText, geminiTTS, geminiPartsJson, esc } from './gemini.js';
import { toast } from './site.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function fmtT(s) { s = Math.max(0, Math.round(Number(s) || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; }
function fmtCut(s) { s = Math.max(0, Number(s) || 0); const whole = Math.floor(s), t = Math.round((s - whole) * 10); const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), sec = whole % 60; return (h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`) + `.${t}`; }

export function initEditor(ctx) {
  const edReadyBtn = $('ed-ready');
  if (edReadyBtn) edReadyBtn.addEventListener('click', () => { const t = document.getElementById(ctx.getMode() === 'tx' ? 'txmake' : 'ytmake'); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  if (!$('editor')) return { open() {}, close() {} };
  let cur = null;

  // Provenance link under the header line ("Watch this scene on YouTube ↗").
  const watchP = document.createElement('p');
  watchP.className = 'small';
  watchP.innerHTML = '<a id="ed-watchlink" href="#" target="_blank" rel="noopener">Watch this scene on YouTube ↗</a>';
  $('ed-sub').after(watchP);

  function ensureBrief(m) {
    if (!m.brief) {
      m.brief = {
        frameMode: 'blur', zoom: 1, fx: 50, fy: 50,
        cutStart: m.startSec != null ? m.startSec : null,
        cutEnd: m.endSec != null ? m.endSec : (m.startSec != null ? m.startSec + 45 : null),
        capOn: true, capStyle: 'bold', capFont: 'poppins', capSize: 100,
        overlays: [],
        voiceMode: ctx.getVoiceMode(), voiceText: m.voiceScript || '', voiceUrl: m.voiceUrl || '',
        vvol: 100, svol: 100,
        musicName: '',
        topOn: true, topText: '', topTitle: m.title || '', postCaption: '',
      };
    }
    return m.brief;
  }

  const paintChips = (boxId, attr, val) => { const box = $(boxId); if (!box) return; box.querySelectorAll(`[data-${attr}]`).forEach(c => c.classList.toggle('on', c.dataset[attr] === String(val))); };
  const wireChips = (boxId, attr, fn) => { const box = $(boxId); if (!box) return; box.querySelectorAll(`[data-${attr}]`).forEach(c => c.addEventListener('click', () => fn(c.dataset[attr]))); };

  /* ---------- preview painters ---------- */
  function setIframe() {
    if (!cur || ctx.getMode() !== 'yt' || !ctx.getVideoId()) return;
    const b = cur.brief;
    const s = Math.max(0, Math.floor(b.cutStart != null ? b.cutStart : (cur.startSec || 0)));
    const e = Math.ceil(b.cutEnd != null ? b.cutEnd : (cur.endSec || s + 45));
    $('ed-iframe').src = `https://www.youtube-nocookie.com/embed/${ctx.getVideoId()}?start=${s}&end=${e}&rel=0`;
  }
  function applyFrame() {
    if (!cur) return;
    const b = cur.brief, f = $('ed-frame'), w = $('ed-vidwrap');
    f.classList.toggle('fill', b.frameMode === 'fill');
    const zx = (b.fx - 50) * (b.frameMode === 'fill' ? 0.9 : 0.35);
    const zy = (b.fy - 50) * (b.frameMode === 'fill' ? 0.9 : 0.35);
    w.style.transform = `translate(calc(-50% + ${zx}%), calc(-50% + ${zy}%)) scale(${b.zoom})`;
  }
  function applyCaption() {
    if (!cur) return;
    const b = cur.brief, cap = $('ed-caption');
    const text = cur.captionText || cur.title || '';
    cap.className = 'ed-caption cap-' + b.capStyle + ' f-' + b.capFont + (!b.capOn || !text ? ' hidden' : '');
    $('ed-caption-in').textContent = text;
    cap.style.fontSize = `${Math.round(18 * b.capSize / 100)}px`;
  }
  function applyTopText() {
    if (!cur) return;
    const b = cur.brief, host = $('ed-toptext');
    const show = b.topOn && b.topText.trim();
    host.classList.toggle('hidden', !show);
    if (!show) { host.innerHTML = ''; return; }
    const words = b.topText.trim().split(/\s+/).map(w => {
      const hot = w.length > 2 && w.startsWith('*') && w.endsWith('*');
      return hot ? `<span class="hot">${esc(w.replace(/\*/g, ''))}</span>` : esc(w.replace(/\*/g, ''));
    }).join(' ');
    host.innerHTML = `<span>${words}</span>`;
  }

  /* ---------- overlays (Add tab) ---------- */
  function renderOverlays() {
    const host = $('ed-overlays');
    host.innerHTML = '';
    if (!cur) return;
    cur.brief.overlays.forEach((ov) => {
      const d = document.createElement('div');
      d.className = 'ed-ov ' + ov.kind;
      d.style.left = ov.x + '%'; d.style.top = ov.y + '%'; d.style.width = ov.w + '%'; d.style.height = ov.h + '%';
      if (ov.kind === 'text') d.textContent = ov.text || 'Text';
      const h = document.createElement('span');
      h.className = 'rsz';
      d.appendChild(h);
      d.addEventListener('pointerdown', (e) => startDrag(e, ov, d, e.target === h ? 'size' : 'move'));
      host.appendChild(d);
    });
  }
  function startDrag(e, ov, el, mode) {
    e.preventDefault();
    const frame = $('ed-frame').getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, o = { ...ov };
    const move = (ev) => {
      const dx = (ev.clientX - sx) / frame.width * 100, dy = (ev.clientY - sy) / frame.height * 100;
      if (mode === 'move') { ov.x = clamp(o.x + dx, 0, 100 - ov.w); ov.y = clamp(o.y + dy, 0, 100 - ov.h); }
      else { ov.w = clamp(o.w + dx, 4, 100 - ov.x); ov.h = clamp(o.h + dy, 3, 100 - ov.y); }
      el.style.left = ov.x + '%'; el.style.top = ov.y + '%'; el.style.width = ov.w + '%'; el.style.height = ov.h + '%';
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); renderOvList(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function renderOvList() {
    const host = $('ed-ovlist');
    if (!cur) { host.innerHTML = ''; return; }
    const names = { blur: 'Blur box', color: 'Color box', text: 'Text' };
    host.innerHTML = cur.brief.overlays.map((ov, i) => `<div class="ovitem"><span class="tag">${names[ov.kind] || ov.kind}</span>${ov.kind === 'text' ? `<input class="input" data-ovtext="${i}" value="${esc(ov.text || '')}" placeholder="Text on the video">` : `<span class="small dim">${Math.round(ov.w)}% × ${Math.round(ov.h)}% at ${Math.round(ov.x)}%, ${Math.round(ov.y)}%</span>`}<button class="chip" data-ovdel="${i}">Remove</button></div>`).join('');
    host.querySelectorAll('[data-ovtext]').forEach(inp => inp.addEventListener('input', () => { cur.brief.overlays[Number(inp.dataset.ovtext)].text = inp.value; renderOverlays(); }));
    host.querySelectorAll('[data-ovdel]').forEach(btn => btn.addEventListener('click', () => { cur.brief.overlays.splice(Number(btn.dataset.ovdel), 1); renderOverlays(); renderOvList(); }));
  }
  function addOverlay(kind) {
    if (!cur) return;
    cur.brief.overlays.push({ kind, x: 35, y: 40, w: 30, h: 16, text: kind === 'text' ? 'Your text' : '' });
    renderOverlays(); renderOvList();
  }
  function blobToInline(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ inlineData: { mimeType: blob.type || 'image/jpeg', data: String(r.result).split(',')[1] } }); r.onerror = rej; r.readAsDataURL(blob); });
  }
  async function findCamera() {
    if (!cur) return;
    if (!requireKey()) return;
    const st = $('ed-camstatus'), id = ctx.getVideoId();
    if (ctx.getMode() !== 'yt' || !id) { st.textContent = 'Find the camera needs a YouTube video — add a blur box yourself.'; return; }
    st.textContent = 'Looking for the camera…';
    try {
      const r = await fetch(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
      if (!r.ok) throw new Error('frame load failed');
      const part = await blobToInline(await r.blob());
      const d = await geminiPartsJson([part, { text: 'This is a frame from a live stream video. Find the streamer\'s webcam / facecam rectangle (the small window showing the person). Return JSON only: {"found": true, "x": 0, "y": 0, "w": 0, "h": 0} where x and y are the top-left corner and w/h the size, all as percentages 0-100 of the image. If there is no webcam window, return {"found": false}.' }], { temperature: 0.2 });
      if (d && d.found && Number.isFinite(Number(d.x))) {
        // The image is the 16:9 video; in the blurred-sides preview that band
        // takes roughly the middle 31.6% of the 9:16 frame's height.
        cur.brief.overlays.push({ kind: 'blur', x: clamp(Number(d.x) || 0, 0, 96), y: clamp(34.2 + (Number(d.y) || 0) * 0.316, 0, 96), w: clamp(Number(d.w) || 20, 4, 100), h: clamp((Number(d.h) || 20) * 0.316, 3, 60), text: '' });
        renderOverlays(); renderOvList();
        st.textContent = 'Camera found — a blur box was placed over it. Drag it if it needs adjusting.';
      } else st.textContent = "Couldn't find the camera — add a blur box yourself.";
    } catch { st.textContent = "Couldn't find the camera — add a blur box yourself. (The frame could not be loaded to check.)"; }
  }

  /* ---------- voice & caption generation ---------- */
  function paintVoiceAudio() {
    const host = $('ed-voice-audio');
    if (!cur) { host.innerHTML = ''; return; }
    host.innerHTML = cur.brief.voiceUrl ? `<audio controls src="${cur.brief.voiceUrl}" style="width:100%"></audio><a class="btn dark sm mt" href="${cur.brief.voiceUrl}" download="clip-voice.wav">Download voice (.wav)</a>` : '';
  }
  async function makeVoice() {
    if (!cur) return;
    if (!requireKey()) return;
    const b = cur.brief;
    if (b.voiceMode === 'off') { toast('Pick Hook line or Tell the story first.', true); return; }
    const btn = $('ed-voice-make');
    btn.disabled = true; btn.textContent = 'Making the voice…';
    try {
      let text = $('ed-voice-text').value.trim();
      if (!text) {
        text = await geminiText(b.voiceMode === 'hook'
          ? `Write ONE punchy spoken hook line (max 12 words) for a short clip titled "${cur.title}". What happens: ${cur.why || ''}. Return only the line, no quotes.`
          : `Write a short spoken narration (2-3 sentences, max 45 words) telling the story of this clip moment for a vertical short. Title: "${cur.title}". What happens: ${cur.why || ''}. Return only the narration.`, { temperature: 0.7 });
        $('ed-voice-text').value = text;
      }
      b.voiceText = text; cur.voiceScript = text;
      const blob = await geminiTTS(text, 'Kore');
      b.voiceUrl = URL.createObjectURL(blob); cur.voiceUrl = b.voiceUrl;
      paintVoiceAudio();
      $('ed-voicestatus').textContent = 'Voice ready — press play to hear it.';
      toast('Voice made.');
    } catch (err) { toast('Voice failed: ' + err.message, true); }
    btn.disabled = false; btn.textContent = '🎙 Make the voice again';
  }
  async function genCaption(manual) {
    if (!cur) return;
    if (!requireKey()) return;
    const btn = $('ed-top-gen');
    if (btn) { btn.disabled = true; btn.textContent = 'Writing…'; }
    try {
      const cap = await geminiText(`Write a posting caption for a short vertical clip. Title: "${cur.brief.topTitle || cur.title}". What happens: ${cur.why || ''}. Hook: ${cur.hook || ''}. Return only the caption: one or two short lines, then a blank line, then 4-6 hashtags.`, { temperature: 0.7 });
      cur.brief.postCaption = cap;
      $('ed-top-caption').value = cap;
      if (manual) toast('Caption written.');
    } catch (err) { if (manual) toast('Caption failed: ' + err.message, true); }
    if (btn) { btn.disabled = false; btn.textContent = 'Generate caption'; }
  }

  /* ---------- control sync ---------- */
  function updCutLabels() {
    if (!cur) return;
    const b = cur.brief;
    if (b.cutStart == null) return;
    $('ed-startv').textContent = fmtCut(b.cutStart);
    $('ed-endv').textContent = fmtCut(b.cutEnd);
    $('ed-length').textContent = `Length: ${(b.cutEnd - b.cutStart).toFixed(1)}s`;
    $('ed-sub').textContent = `${fmtT(b.cutEnd - b.cutStart)} · from ${ctx.getStreamTitle()}${ctx.getQuality ? ` · Quality ${ctx.getQuality()}` : ''}`;
  }
  function syncControls() {
    const b = cur.brief;
    paintChips(null, 'fmode', b.frameMode);
    document.querySelectorAll('[data-fmode]').forEach(c => c.classList.toggle('on', c.dataset.fmode === b.frameMode));
    $('ed-zoom').value = b.zoom; $('ed-zoomv').textContent = `${Number(b.zoom).toFixed(2)}x`;
    $('ed-x').value = b.fx; $('ed-xv').textContent = `${b.fx}%`;
    $('ed-y').value = b.fy; $('ed-yv').textContent = `${b.fy}%`;
    const cs = $('ed-start'), ce = $('ed-end');
    if (b.cutStart != null) {
      const dur = ctx.getDuration() || 0;
      const w0 = Math.max(0, Math.floor(b.cutStart - 60));
      let w1 = Math.ceil((b.cutEnd != null ? b.cutEnd : b.cutStart + 45) + 60);
      if (dur > 0) w1 = Math.min(w1, Math.ceil(dur));
      if (w1 <= w0 + 2) w1 = w0 + 120;
      cs.min = w0; cs.max = w1; ce.min = w0; ce.max = w1;
      cs.value = b.cutStart; ce.value = b.cutEnd;
      cs.disabled = ce.disabled = false;
      $('ed-cut-note').textContent = '';
      updCutLabels();
    } else {
      cs.disabled = ce.disabled = true;
      $('ed-cut-note').textContent = 'This moment has no timestamp, so cut points cannot be set for it.';
      $('ed-startv').textContent = '—'; $('ed-endv').textContent = '—'; $('ed-length').textContent = '';
    }
    $('ed-cap-on').checked = !!b.capOn;
    paintChips('ed-capstyles', 'capstyle', b.capStyle);
    paintChips('ed-capfonts', 'capfont', b.capFont);
    $('ed-capsize').value = b.capSize; $('ed-capsizev').textContent = `${b.capSize}%`;
    paintChips('ed-vmodes', 'vmode', b.voiceMode);
    $('ed-voice-text').value = b.voiceText || '';
    $('ed-voicestatus').textContent = b.voiceUrl ? 'Voice ready — press play to hear it.' : 'No AI voice yet. Write a line and make one.';
    paintVoiceAudio();
    $('ed-vvol').value = b.vvol; $('ed-vvolv').textContent = `${b.vvol}%`;
    $('ed-svol').value = b.svol; $('ed-svolv').textContent = `${b.svol}%`;
    $('ed-musicname').textContent = b.musicName ? `Picked: ${b.musicName} — saved into the brief (metadata only; mixed in when the video is rendered). Use music you are allowed to use.` : 'No music picked yet. The file name is saved into the brief — the music itself is mixed in when the video is rendered.';
    $('ed-top-on').checked = !!b.topOn;
    $('ed-top-text').value = b.topText || '';
    $('ed-top-title').value = b.topTitle || '';
    $('ed-top-caption').value = b.postCaption || '';
    $('ed-camstatus').textContent = '';
  }

  /* ---------- open / close ---------- */
  function open(m) {
    cur = m;
    const b = ensureBrief(m);
    $('editor').classList.remove('hidden');
    $('ed-title').textContent = b.topTitle || m.title || 'Clip';
    const dur = (b.cutStart != null && b.cutEnd != null) ? b.cutEnd - b.cutStart : null;
    $('ed-sub').textContent = `${dur != null ? fmtT(dur) : '—'} · from ${ctx.getStreamTitle()}${ctx.getQuality ? ` · Quality ${ctx.getQuality()}` : ''}`;
    const wl = $('ed-watchlink');
    if (ctx.getMode() === 'yt' && ctx.getVideoId() && m.startSec != null) {
      wl.href = `https://www.youtube.com/watch?v=${ctx.getVideoId()}&t=${Math.max(0, Math.floor(m.startSec))}s`;
      watchP.style.display = '';
    } else watchP.style.display = 'none';
    const yt = ctx.getMode() === 'yt' && !!ctx.getVideoId();
    $('ed-vidwrap').style.display = yt ? '' : 'none';
    $('ed-bg').style.display = yt ? '' : 'none';
    $('ed-novid').classList.toggle('hidden', yt);
    if (yt) { $('ed-bg').src = `https://i.ytimg.com/vi/${ctx.getVideoId()}/hqdefault.jpg`; setIframe(); }
    else { $('ed-novid-title').textContent = m.title || ''; $('ed-novid-why').textContent = m.why || ''; $('ed-novid-hook').textContent = m.hook || ''; }
    syncControls();
    applyFrame(); applyCaption(); applyTopText(); renderOverlays(); renderOvList();
    $('ed-ready').textContent = ctx.pickedCount() ? `${ctx.pickedCount()} shorts are ready` : '';
    $('editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!b.postCaption && !b._capTried && hasKey()) { b._capTried = true; genCaption(false); }
  }
  function close() {
    $('editor').classList.add('hidden');
    cur = null;
    ctx.rerender();
  }

  /* ---------- wiring (once) ---------- */
  $('ed-back').addEventListener('click', close);
  $('ed-adjust').addEventListener('click', () => $('ed-tabs').classList.toggle('hidden'));
  document.querySelectorAll('[data-etab]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-etab]').forEach(x => x.classList.toggle('on', x === btn));
    for (const t of ['frame', 'cut', 'captions', 'add', 'voice', 'music', 'toptext']) $('ed-p-' + t).classList.toggle('hidden', t !== btn.dataset.etab);
  }));
  document.querySelectorAll('[data-fmode]').forEach(c => c.addEventListener('click', () => { if (!cur) return; cur.brief.frameMode = c.dataset.fmode; document.querySelectorAll('[data-fmode]').forEach(x => x.classList.toggle('on', x === c)); applyFrame(); }));
  const frameSlider = (id, label, fn) => $(id).addEventListener('input', () => { if (!cur) return; fn(Number($(id).value)); $(label).textContent = id === 'ed-zoom' ? `${Number($(id).value).toFixed(2)}x` : `${$(id).value}%`; applyFrame(); });
  frameSlider('ed-zoom', 'ed-zoomv', v => { cur.brief.zoom = v; });
  frameSlider('ed-x', 'ed-xv', v => { cur.brief.fx = v; });
  frameSlider('ed-y', 'ed-yv', v => { cur.brief.fy = v; });
  $('ed-center').addEventListener('click', () => { if (!cur) return; Object.assign(cur.brief, { zoom: 1, fx: 50, fy: 50 }); syncControls(); applyFrame(); });
  const cutSlider = (id, key) => {
    $(id).addEventListener('input', () => {
      if (!cur || cur.brief.cutStart == null) return;
      let v = Number($(id).value);
      if (key === 'cutStart') v = Math.min(v, cur.brief.cutEnd - 1); else v = Math.max(v, cur.brief.cutStart + 1);
      cur.brief[key] = v;
      if (key === 'cutStart') cur.startSec = v; else cur.endSec = v;
      updCutLabels();
    });
    $(id).addEventListener('change', () => setIframe());
  };
  cutSlider('ed-start', 'cutStart');
  cutSlider('ed-end', 'cutEnd');
  $('ed-cap-on').addEventListener('change', () => { if (!cur) return; cur.brief.capOn = $('ed-cap-on').checked; applyCaption(); });
  wireChips('ed-capstyles', 'capstyle', v => { if (!cur) return; cur.brief.capStyle = v; paintChips('ed-capstyles', 'capstyle', v); applyCaption(); });
  wireChips('ed-capfonts', 'capfont', v => { if (!cur) return; cur.brief.capFont = v; paintChips('ed-capfonts', 'capfont', v); applyCaption(); });
  $('ed-capsize').addEventListener('input', () => { if (!cur) return; cur.brief.capSize = Number($('ed-capsize').value); $('ed-capsizev').textContent = `${cur.brief.capSize}%`; applyCaption(); });
  $('ed-add-blur').addEventListener('click', () => addOverlay('blur'));
  $('ed-add-color').addEventListener('click', () => addOverlay('color'));
  $('ed-add-text').addEventListener('click', () => addOverlay('text'));
  $('ed-findcam').addEventListener('click', findCamera);
  wireChips('ed-vmodes', 'vmode', v => { if (!cur) return; cur.brief.voiceMode = v; paintChips('ed-vmodes', 'vmode', v); });
  $('ed-voice-text').addEventListener('input', () => { if (!cur) return; cur.brief.voiceText = $('ed-voice-text').value; });
  $('ed-voice-make').addEventListener('click', makeVoice);
  $('ed-vvol').addEventListener('input', () => { if (!cur) return; cur.brief.vvol = Number($('ed-vvol').value); $('ed-vvolv').textContent = `${cur.brief.vvol}%`; });
  $('ed-svol').addEventListener('input', () => { if (!cur) return; cur.brief.svol = Number($('ed-svol').value); $('ed-svolv').textContent = `${cur.brief.svol}%`; });
  $('ed-music').addEventListener('change', () => {
    if (!cur) return;
    const f = $('ed-music').files && $('ed-music').files[0];
    cur.brief.musicName = f ? f.name : '';
    $('ed-musicname').textContent = f ? `Picked: ${f.name} — saved into the brief (metadata only; mixed in when the video is rendered). Use music you are allowed to use.` : 'No music picked yet.';
  });
  $('ed-top-on').addEventListener('change', () => { if (!cur) return; cur.brief.topOn = $('ed-top-on').checked; applyTopText(); });
  $('ed-top-text').addEventListener('input', () => { if (!cur) return; cur.brief.topText = $('ed-top-text').value; applyTopText(); });
  $('ed-top-title').addEventListener('input', () => { if (!cur) return; cur.brief.topTitle = $('ed-top-title').value; $('ed-title').textContent = cur.brief.topTitle || cur.title || 'Clip'; });
  $('ed-top-caption').addEventListener('input', () => { if (!cur) return; cur.brief.postCaption = $('ed-top-caption').value; });
  $('ed-top-gen').addEventListener('click', () => genCaption(true));
  $('ed-top-copy').addEventListener('click', () => {
    if (!cur) return;
    const cap = $('ed-top-caption').value.trim();
    if (!cap) { toast('No caption yet — generate or write one first.', true); return; }
    navigator.clipboard.writeText(cap).then(() => toast('Caption copied.')).catch(() => toast('Copy failed — select the text manually.', true));
  });
  $('ed-make').addEventListener('click', () => { if (!cur) return; cur.picked = true; ctx.onMake(cur); });
  $('ed-delete').addEventListener('click', () => { if (!cur) return; ctx.onDelete(cur); });

  return { open, close };
}
