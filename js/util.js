export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const WEEKDAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

export const PALETTE = [
  '#14335c', '#1c8c86', '#c0392b', '#b8862a',
  '#6a4c93', '#2d6a4f', '#c2578b', '#3d5a80',
  '#e07a3f', '#4a5568', '#0f766e', '#9d4edd',
];

export function colorForLabel(label) {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export function pad2(n) { return String(n).padStart(2, '0'); }

export function toISODate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fromISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO() {
  return toISODate(new Date());
}

export function getOrdinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function formatFullDate(iso) {
  const d = fromISODate(iso);
  return `${getOrdinal(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatShortDate(iso) {
  const d = fromISODate(iso);
  return `${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

// Monday-first weekday index: 0 = Monday ... 6 = Sunday
export function mondayIndex(d) {
  return (d.getDay() + 6) % 7;
}

export function startOfWeek(d) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() - mondayIndex(copy));
  return copy;
}

export function addDays(d, n) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

export function addMonths(d, n) {
  const copy = new Date(d.getFullYear(), d.getMonth() + n, 1);
  return copy;
}

export function isSameDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 3200);
}
