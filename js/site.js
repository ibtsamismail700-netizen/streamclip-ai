// StreamClip AI — shared helpers (toast) + Settings page logic.
import { getKeys, addKey, removeKey, checkKey, esc } from './gemini.js';

export function toast(msg, bad = false) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.toggle('bad', bad);
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 3400);
}
window.__toast = toast;

// Settings page (settings.html)
const keyList = document.getElementById('keylist');
if (keyList) {
  const render = () => {
    const keys = getKeys();
    keyList.innerHTML = keys.length
      ? keys.map((k, i) => `<div class="spread mt"><span class="tag">Key ${i + 1} · ••••${esc(k.slice(-6))}</span><button class="chip" data-del="${i}">Remove</button></div>`).join('')
      : '<p class="sub mt">No key added yet. Follow the steps below to create yours — it takes about a minute.</p>';
    keyList.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { removeKey(Number(b.dataset.del)); render(); toast('Key removed.'); }));
  };
  render();
  document.getElementById('addkey').addEventListener('click', async (ev) => {
    const input = document.getElementById('keyinput');
    const k = input.value.trim();
    if (k.length < 20) { toast('That does not look like a Gemini key. Copy the full key.', true); return; }
    if (getKeys().includes(k)) { toast('This key is already added.'); return; }
    const b = ev.currentTarget;
    b.disabled = true; b.innerHTML = '<span class="spin"></span> Adding…';
    // The visitor's own key is saved FIRST — adding a key never depends on
    // our check. The check only reports the key's status afterwards.
    addKey(k);
    input.value = '';
    render();
    const r = await checkKey(k);
    if (r.state === 'verified') toast('Key added and verified with Google. All AI tools are now unlocked.');
    else if (r.state === 'rejected') toast('Key added, but Google says this key is not valid. Check you copied the full key, or create a fresh one and add that instead.', true);
    else toast('Key added. Google could not be reached to verify it just now — the tools will use it as-is.');
    b.disabled = false; b.innerHTML = 'Check and add';
  });
}
