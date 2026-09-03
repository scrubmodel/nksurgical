import { supabase } from './supabaseClient.js';

// Accounts are created directly (by an admin, via the Supabase dashboard/API)
// with username + password — no email/sign-up flow. Supabase Auth still
// needs an email internally, so a bare username is mapped to a synthetic,
// non-deliverable address under this fixed domain. A value that already
// contains "@" is used as-is, so a real email still works if one was set
// up that way.
const AUTH_DOMAIN = 'nksurgical.local';

function resolveLoginEmail(input) {
  const trimmed = input.trim();
  return trimmed.includes('@') ? trimmed : `${trimmed.toLowerCase()}@${AUTH_DOMAIN}`;
}

export function usernameFromEmail(email) {
  return (email || '').split('@')[0];
}

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

export async function signIn(usernameOrEmail, password) {
  const { error } = await supabase.auth.signInWithPassword({ email: resolveLoginEmail(usernameOrEmail), password });
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

    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const error = await signIn(username, password);

    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';

    if (error) {
      errorEl.textContent = 'Incorrect username or password.';
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
    const nameEl = document.getElementById('user-email');
    if (nameEl) nameEl.textContent = usernameFromEmail(session.user.email);
  } else {
    gate.classList.add('show');
    shell.classList.remove('show');
  }
}
