import { supabase } from './supabaseClient.js';

let currentSession = null;
let passwordRecovery = false;
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
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') passwordRecovery = true;
    notify(session);
  });
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

  document.getElementById('forgot-password-btn').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    if (!email) { errorEl.textContent = 'Enter your email above first, then click "Forgot password?".'; return; }
    errorEl.style.color = '';
    errorEl.textContent = '';
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
    errorEl.style.color = error ? '' : 'var(--success)';
    errorEl.textContent = error ? error.message : 'Check your email for a password reset link.';
  });

  const setPasswordForm = document.getElementById('set-password-form');
  const setPasswordError = document.getElementById('set-password-error');
  const setPasswordSubmit = document.getElementById('set-password-submit');

  setPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setPasswordError.textContent = '';

    const pw = document.getElementById('new-password').value;
    const pwConfirm = document.getElementById('new-password-confirm').value;
    if (pw.length < 6) { setPasswordError.textContent = 'Password must be at least 6 characters.'; return; }
    if (pw !== pwConfirm) { setPasswordError.textContent = 'Passwords do not match.'; return; }

    setPasswordSubmit.disabled = true;
    setPasswordSubmit.textContent = 'Saving…';

    const { error } = await supabase.auth.updateUser({ password: pw });

    setPasswordSubmit.disabled = false;
    setPasswordSubmit.textContent = 'Set Password & Continue';

    if (error) {
      setPasswordError.textContent = error.message;
      return;
    }
    passwordRecovery = false;
    applyAuthUI(currentSession);
  });
}

export function applyAuthUI(session) {
  const gate = document.getElementById('login-gate');
  const shell = document.getElementById('app-shell');
  const loginForm = document.getElementById('login-form');
  const setPasswordForm = document.getElementById('set-password-form');

  if (session && passwordRecovery) {
    gate.classList.add('show');
    shell.classList.remove('show');
    loginForm.style.display = 'none';
    setPasswordForm.style.display = '';
    return;
  }

  loginForm.style.display = '';
  setPasswordForm.style.display = 'none';

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
