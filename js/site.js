// StreamClip AI — shared helpers (toast) + Settings page logic.
import { getKeys, addKey, removeKey, testKey, esc } from './gemini.js';

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
    b.disabled = true; b.innerHTML = '<span class="spin"></span> Checking…';
    try {
      await testKey(k);
      addKey(k);
      input.value = '';
      render();
      toast('Key added. All AI tools are now unlocked.');
    } catch (e) {
      toast(e.message, true);
    }
    b.disabled = false; b.innerHTML = 'Check and add';
  });
}
