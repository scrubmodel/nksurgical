import { initAuth, initLoginForm, applyAuthUI, onAuthChange } from './auth.js';
import { initCalendar } from './calendar.js';
import { initInvoicing } from './invoicing.js';

function setupTabNav() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('page-' + btn.dataset.page).classList.add('active');
    });
  });
}

let appInitialized = false;

async function boot() {
  initLoginForm();
  onAuthChange(async (session) => {
    applyAuthUI(session);
    if (session && !appInitialized) {
      appInitialized = true;
      setupTabNav();
      await initCalendar();
      await initInvoicing();
    }
  });
  await initAuth();
}

boot();
