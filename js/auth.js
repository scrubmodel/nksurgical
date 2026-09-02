import { supabase } from './supabaseClient.js';

let currentSession = null;
const listeners = [];

export function onAuthChange(fn) {
  listeners.push(fn);
  if (currentSession !== undefined) fn(currentSession);
}

function notify(session) {
  currentSession = session;
  listeners.forEach((fn) => fn(session));
}

export function getSession() {
  return currentSession;
}

export async function initAuth() {
  const { data } = await supabase.auth.getSession();
  notify(data.session);
  supabase.auth.onAuthStateChange((_event, session) => notify(session));
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export function initLoginForm() {
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const error = await signIn(email, password);

    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';

    if (error) {
      errorEl.textContent = 'Incorrect email or password.';
    }
  });

  document.getElementById('logout-btn').addEventListener('click', signOut);
}

export function applyAuthUI(session) {
  const gate = document.getElementById('login-gate');
  const shell = document.getElementById('app-shell');
  if (session) {
    gate.classList.remove('show');
    shell.classList.add('show');
    const emailEl = document.getElementById('user-email');
    if (emailEl) emailEl.textContent = session.user.email;
  } else {
    gate.classList.add('show');
    shell.classList.remove('show');
  }
}
