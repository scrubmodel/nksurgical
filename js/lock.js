import { showToast } from './util.js';

const KEY = 'nk_locked';
let locked = localStorage.getItem(KEY) === 'true';

export function isLocked() {
  return locked;
}

// Call at the top of any action that adds/edits/deletes data. Returns true
// (and shows a toast) if the action should be blocked.
export function guardLocked() {
  if (locked) showToast('🔒 Locked — tap the lock icon to make changes.');
  return locked;
}

export function initLock() {
  const btn = document.getElementById('lock-toggle-btn');
  applyLockUI(btn);
  btn.addEventListener('click', () => {
    locked = !locked;
    localStorage.setItem(KEY, String(locked));
    applyLockUI(btn);
    showToast(locked ? '🔒 Locked. Editing is disabled.' : '🔓 Unlocked. Editing is enabled.');
  });
}

function applyLockUI(btn) {
  btn.textContent = locked ? '🔒' : '🔓';
  btn.title = locked ? 'Unlock editing' : 'Lock editing';
  btn.classList.toggle('locked', locked);
}
