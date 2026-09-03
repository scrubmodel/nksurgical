import { supabase } from './supabaseClient.js';
import {
  MONTHS, WEEKDAYS, PALETTE, colorForLabel, toISODate, fromISODate, todayISO,
  formatShortDate, mondayIndex, startOfWeek, addDays, addMonths, isSameDate, showToast, escapeHtml,
} from './util.js';
import { guardLocked } from './lock.js';

let viewMode = 'month';
let anchorDate = new Date();
let customStart = null;
let customEnd = null;

let allAssignments = [];
let byDate = new Map();
let surgeonNames = [];
let hospitalNames = [];
let surgeonColorMap = new Map();

let manualColor = null;
let editingId = null;

// Entries the user has flagged from the calendar to be billed. The
// Invoicing -> Pending screen pre-checks whatever is in here; both screens
// read/write the same Set so priming from either side stays in sync.
export const primedForInvoice = new Set();

const STATUS_LABEL = { pending: 'Invoice Pending', submitted: 'Invoice Submitted', paid: 'Invoice Paid' };
const STATUS_COLOR = { pending: '#9aa4b2', submitted: '#b8862a', paid: '#1c8c56' };

export async function initCalendar() {
  document.getElementById('cal-prev').addEventListener('click', () => navigate(-1));
  document.getElementById('cal-next').addEventListener('click', () => navigate(1));
  document.getElementById('cal-today').addEventListener('click', () => { anchorDate = new Date(); renderCurrentView(); });

  document.querySelectorAll('.cal-view-btn').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  document.getElementById('cal-add-entry').addEventListener('click', () => { if (guardLocked()) return; openDayModal(todayISO()); });
  document.getElementById('day-modal-close').addEventListener('click', closeDayModal);
  document.getElementById('day-modal').addEventListener('click', (e) => { if (e.target.id === 'day-modal') closeDayModal(); });
  document.getElementById('day-add-entry-btn').addEventListener('click', () => { if (guardLocked()) return; showEntryForm(); });
  document.getElementById('entry-cancel-btn').addEventListener('click', hideEntryForm);
  document.getElementById('entry-day-off').addEventListener('change', (e) => {
    document.getElementById('entry-work-fields').style.display = e.target.checked ? 'none' : '';
  });
  document.getElementById('entry-surgeon').addEventListener('input', onSurgeonFieldInput);
  document.getElementById('entry-form').addEventListener('submit', onSaveEntry);

  const today = new Date();
  customStart = new Date(today.getFullYear(), today.getMonth(), 1);
  customEnd = today;
  document.getElementById('custom-start').value = toISODate(customStart);
  document.getElementById('custom-end').value = toISODate(customEnd);
  document.getElementById('custom-start').addEventListener('change', (e) => { customStart = fromISODate(e.target.value); renderCustom(); });
  document.getElementById('custom-end').addEventListener('change', (e) => { customEnd = fromISODate(e.target.value); renderCustom(); });

  buildColorSwatches();
  await loadSurgeons();
  await loadAssignments();
}

export async function loadSurgeons() {
  const { data, error } = await supabase.from('surgeons').select('*').order('name');
  if (error) { showToast('Could not load surgeons: ' + error.message); return; }
  surgeonColorMap = new Map((data || []).map((s) => [s.name, s.color]));
}

async function saveSurgeonColor(name, color) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('surgeons').upsert({ user_id: user.id, name, color }, { onConflict: 'user_id,name' });
  if (error) { showToast('Could not save surgeon colour: ' + error.message); return; }
  surgeonColorMap.set(name, color);
}

export async function loadAssignments() {
  const { data, error } = await supabase.from('assignments').select('*').order('date');
  if (error) { showToast('Could not load calendar: ' + error.message); return; }
  allAssignments = data || [];
  byDate = new Map();
  const surgeonSet = new Set();
  const hospitalSet = new Set();
  for (const a of allAssignments) {
    if (!byDate.has(a.date)) byDate.set(a.date, []);
    byDate.get(a.date).push(a);
    if (a.surgeon) surgeonSet.add(a.surgeon);
    if (a.hospital) hospitalSet.add(a.hospital);
  }
  surgeonNames = [...surgeonSet].sort();
  hospitalNames = [...hospitalSet].sort();
  populateDatalists();
  renderCurrentView();
}

function populateDatalists() {
  document.getElementById('surgeon-list').innerHTML = surgeonNames.map((n) => `<option value="${escapeHtml(n)}">`).join('');
  document.getElementById('hospital-list').innerHTML = hospitalNames.map((n) => `<option value="${escapeHtml(n)}">`).join('');
}

function entryLabel(a) {
  if (a.is_day_off) return 'Day Off';
  if (a.surgeon && a.hospital) return `${a.surgeon} @ ${a.hospital}`;
  return a.surgeon || a.hospital || '';
}

function resolveColor(a) {
  if (a.surgeon && surgeonColorMap.has(a.surgeon)) return surgeonColorMap.get(a.surgeon);
  return a.color;
}

function timeRangeLabel(a) {
  if (a.start_time && a.end_time) return `${a.start_time}–${a.end_time}`;
  return a.start_time || a.end_time || '';
}

function statusStarHtml(a, size) {
  if (a.is_day_off) return '';
  const status = a.invoice_status || 'pending';
  return `<span class="status-star ${size || ''}" style="color:${STATUS_COLOR[status]}" title="${STATUS_LABEL[status]}">★</span>`;
}

// ── VIEW SWITCHING ──
function setView(mode) {
  viewMode = mode;
  document.querySelectorAll('.cal-view-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === mode));
  ['month', 'week', 'year', 'custom'].forEach((v) => {
    document.getElementById(`${v}-view`).style.display = v === mode ? '' : 'none';
  });
  const toolbarLeft = document.querySelector('.cal-toolbar-left');
  toolbarLeft.style.visibility = mode === 'custom' ? 'hidden' : 'visible';
  renderCurrentView();
}

function navigate(dir) {
  if (viewMode === 'month') anchorDate = addMonths(anchorDate, dir);
  else if (viewMode === 'week') anchorDate = addDays(anchorDate, dir * 7);
  else if (viewMode === 'year') anchorDate = new Date(anchorDate.getFullYear() + dir, anchorDate.getMonth(), 1);
  renderCurrentView();
}

function renderCurrentView() {
  if (viewMode === 'month') renderMonth();
  else if (viewMode === 'week') renderWeek();
  else if (viewMode === 'year') renderYear();
  else renderCustom();
}

// ── MONTH VIEW ──
function renderMonth() {
  document.getElementById('cal-period-label').textContent = `${MONTHS[anchorDate.getMonth()]} ${anchorDate.getFullYear()}`;

  const firstOfMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const gridStart = addDays(firstOfMonth, -mondayIndex(firstOfMonth));
  const today = new Date();

  let html = WEEKDAYS.map((w) => `<div class="month-weekday">${w}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const iso = toISODate(d);
    const outside = d.getMonth() !== anchorDate.getMonth();
    const isToday = !outside && isSameDate(d, today);
    const entries = byDate.get(iso) || [];
    const shown = entries.slice(0, 3);
    const more = entries.length - shown.length;
    html += `
      <div class="month-day ${outside ? 'outside' : ''} ${isToday ? 'today' : ''}" data-date="${iso}">
        <div class="day-num">${d.getDate()}</div>
        <div class="day-entries">
          ${shown.map((a) => chipHtml(a)).join('')}
          ${more > 0 ? `<div class="day-more">+${more} more</div>` : ''}
        </div>
      </div>`;
  }
  const grid = document.getElementById('month-view');
  grid.innerHTML = `<div class="month-grid">${html}</div>`;
  grid.querySelectorAll('.month-day').forEach((el) => el.addEventListener('click', () => openDayModal(el.dataset.date)));
}

function chipHtml(a) {
  const cls = ['entry-chip'];
  if (a.status === 'cancelled') cls.push('cancelled');
  if (a.is_day_off) cls.push('day-off');
  return `<div class="${cls.join(' ')}" style="background:${resolveColor(a)}">
    <span class="entry-chip-label">${escapeHtml(entryLabel(a))}</span>${statusStarHtml(a, 'sm')}
  </div>`;
}

// ── WEEK VIEW ──
function renderWeek() {
  const start = startOfWeek(anchorDate);
  const end = addDays(start, 6);
  const label = start.getMonth() === end.getMonth()
    ? `${start.getDate()} – ${end.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()}`
    : `${start.getDate()} ${MONTHS[start.getMonth()].slice(0, 3)} – ${end.getDate()} ${MONTHS[end.getMonth()].slice(0, 3)} ${end.getFullYear()}`;
  document.getElementById('cal-period-label').textContent = label;

  const today = new Date();
  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const iso = toISODate(d);
    const isToday = isSameDate(d, today);
    const entries = byDate.get(iso) || [];
    html += `
      <div class="week-day-col ${isToday ? 'today' : ''}" data-date="${iso}">
        <div class="week-day-header">
          <div class="week-day-name">${WEEKDAYS[i]}</div>
          <div class="week-day-num">${d.getDate()}</div>
        </div>
        ${entries.map((a) => `
          <div class="week-entry ${a.status === 'cancelled' ? 'cancelled' : ''} ${a.is_day_off ? 'day-off' : ''}" style="background:${resolveColor(a)}">
            <div class="week-entry-top">
              <span>${escapeHtml(entryLabel(a))}</span>${statusStarHtml(a)}
            </div>
            ${(a.note || timeRangeLabel(a)) ? `<span class="entry-note">${escapeHtml([timeRangeLabel(a), a.note].filter(Boolean).join(' · '))}</span>` : ''}
          </div>`).join('')}
      </div>`;
  }
  const el = document.getElementById('week-view');
  el.innerHTML = `<div class="week-grid">${html}</div>`;
  el.querySelectorAll('.week-day-col').forEach((c) => c.addEventListener('click', () => openDayModal(c.dataset.date)));
}

// ── YEAR VIEW ──
function renderYear() {
  const year = anchorDate.getFullYear();
  document.getElementById('cal-period-label').textContent = `${year}`;
  const today = new Date();

  let html = '';
  for (let m = 0; m < 12; m++) {
    const firstOfMonth = new Date(year, m, 1);
    const gridStart = addDays(firstOfMonth, -mondayIndex(firstOfMonth));
    let days = '';
    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      const iso = toISODate(d);
      const outside = d.getMonth() !== m;
      const isToday = !outside && isSameDate(d, today);
      const entries = outside ? [] : (byDate.get(iso) || []);
      const hasEntries = entries.length > 0;
      const onlyCancelled = hasEntries && entries.every((a) => a.status === 'cancelled');
      const cls = ['mini-day'];
      if (outside) cls.push('outside');
      if (isToday) cls.push('today');
      if (hasEntries) cls.push('has-entries');
      if (onlyCancelled) cls.push('has-cancelled-only');
      days += `<div class="${cls.join(' ')}" data-date="${iso}">${outside ? '' : d.getDate()}</div>`;
    }
    html += `
      <div class="mini-month" data-month="${m}">
        <div class="mini-month-title">${MONTHS[m]}</div>
        <div class="mini-grid">
          ${WEEKDAYS.map((w) => `<div class="mini-weekday">${w[0]}</div>`).join('')}
          ${days}
        </div>
      </div>`;
  }
  const el = document.getElementById('year-view');
  el.innerHTML = `<div class="year-grid">${html}</div>`;
  el.querySelectorAll('.mini-day').forEach((d) => {
    if (!d.dataset.date) return;
    d.addEventListener('click', (e) => { e.stopPropagation(); openDayModal(d.dataset.date); });
  });
  el.querySelectorAll('.mini-month-title').forEach((t, i) => {
    t.style.cursor = 'pointer';
    t.addEventListener('click', () => { anchorDate = new Date(year, i, 1); setView('month'); });
  });
}

// ── CUSTOM RANGE VIEW ──
function renderCustom() {
  document.getElementById('cal-period-label').textContent = 'Custom Range';
  const listEl = document.getElementById('custom-list');
  const summaryEl = document.getElementById('custom-summary');

  if (!customStart || !customEnd || customStart > customEnd) {
    listEl.innerHTML = `<div class="custom-empty">Choose a valid start and end date.</div>`;
    summaryEl.textContent = '';
    return;
  }

  const rows = [];
  let entryCount = 0;
  for (let d = new Date(customStart); d <= customEnd; d = addDays(d, 1)) {
    const iso = toISODate(d);
    const entries = byDate.get(iso) || [];
    if (entries.length === 0) continue;
    entryCount += entries.length;
    rows.push(`
      <div class="custom-day-row" data-date="${iso}" style="cursor:pointer;">
        <div class="custom-day-date">${formatShortDate(iso)}</div>
        <div class="custom-day-entries">${entries.map((a) => chipHtml(a)).join('')}</div>
      </div>`);
  }

  const dayCount = Math.round((customEnd - customStart) / 86400000) + 1;
  summaryEl.innerHTML = `<strong>${entryCount}</strong> entr${entryCount === 1 ? 'y' : 'ies'} across <strong>${dayCount}</strong> day${dayCount === 1 ? '' : 's'}.`;

  listEl.innerHTML = rows.length ? rows.join('') : `<div class="custom-empty">No entries in this range.</div>`;
  listEl.querySelectorAll('.custom-day-row').forEach((r) => r.addEventListener('click', () => openDayModal(r.dataset.date)));
}

// ── DAY DETAIL MODAL ──
function openDayModal(iso) {
  document.getElementById('day-modal-title').textContent = formatShortDate(iso) + ', ' + fromISODate(iso).getFullYear();
  document.getElementById('entry-date').value = iso;
  hideEntryForm();
  renderAssignmentList(iso);
  document.getElementById('day-modal').classList.add('open');
}

function closeDayModal() {
  document.getElementById('day-modal').classList.remove('open');
}

function renderAssignmentList(iso) {
  const entries = byDate.get(iso) || [];
  const listEl = document.getElementById('assignment-list');
  if (entries.length === 0) {
    listEl.innerHTML = `<div style="color:var(--muted); font-size:0.85rem; padding:8px 0;">No entries yet for this day.</div>`;
    return;
  }
  listEl.innerHTML = entries.map((a) => {
    const status = a.invoice_status || 'pending';
    const meta = [timeRangeLabel(a), a.note].filter(Boolean).join(' · ');
    return `
    <div class="assignment-row" data-id="${a.id}">
      <div class="assignment-swatch" style="background:${resolveColor(a)}"></div>
      <div class="assignment-label">
        <span class="${a.status === 'cancelled' ? 'lbl-cancelled' : ''}">${escapeHtml(entryLabel(a))}</span>
        ${meta ? `<span class="lbl-note">${escapeHtml(meta)}</span>` : ''}
        ${!a.is_day_off && status === 'pending' ? `
          <label class="prime-invoice-toggle">
            <input type="checkbox" class="prime-checkbox" ${primedForInvoice.has(a.id) ? 'checked' : ''}>
            Send to Invoicing
          </label>` : ''}
      </div>
      ${!a.is_day_off ? `<button class="status-star-btn ${status === 'pending' ? 'disabled' : ''}" style="color:${STATUS_COLOR[status]}" title="${STATUS_LABEL[status]}${status !== 'pending' ? ' — click to change' : ''}">★</button>` : ''}
      <div class="assignment-row-actions">
        <button class="edit-btn" title="Edit">✎</button>
        <button class="delete-btn" title="Delete">🗑</button>
      </div>
    </div>`;
  }).join('');

  listEl.querySelectorAll('.edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (guardLocked()) return;
      const id = btn.closest('.assignment-row').dataset.id;
      const a = entries.find((e) => e.id === id);
      showEntryForm(a);
    });
  });
  listEl.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (guardLocked()) return;
      const id = btn.closest('.assignment-row').dataset.id;
      if (!confirm('Delete this entry?')) return;
      const { error } = await supabase.from('assignments').delete().eq('id', id);
      if (error) { showToast('Delete failed: ' + error.message); return; }
      primedForInvoice.delete(id);
      showToast('Entry deleted.');
      await loadAssignments();
      renderAssignmentList(document.getElementById('entry-date').value);
    });
  });
  listEl.querySelectorAll('.prime-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (guardLocked()) { cb.checked = !cb.checked; return; }
      const id = cb.closest('.assignment-row').dataset.id;
      if (cb.checked) { primedForInvoice.add(id); showToast('Added to invoicing queue.'); }
      else primedForInvoice.delete(id);
    });
  });
  listEl.querySelectorAll('.status-star-btn:not(.disabled)').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (guardLocked()) return;
      const id = btn.closest('.assignment-row').dataset.id;
      const a = entries.find((e) => e.id === id);
      const next = a.invoice_status === 'submitted' ? 'paid' : 'submitted';
      const { error } = await supabase.from('assignments').update({ invoice_status: next }).eq('id', id);
      if (error) { showToast('Update failed: ' + error.message); return; }
      showToast(next === 'paid' ? '✅ Marked as paid.' : 'Marked as submitted.');
      await loadAssignments();
      renderAssignmentList(iso);
    });
  });
}

function buildColorSwatches() {
  const row = document.getElementById('entry-color-row');
  row.innerHTML = PALETTE.map((c) => `<div class="color-swatch" data-color="${c}" style="background:${c}"></div>`).join('');
  row.querySelectorAll('.color-swatch').forEach((sw) => {
    sw.addEventListener('click', () => {
      manualColor = sw.dataset.color;
      row.querySelectorAll('.color-swatch').forEach((s) => s.classList.toggle('selected', s === sw));
    });
  });
}

function onSurgeonFieldInput(e) {
  const name = e.target.value.trim();
  const colorGroup = document.getElementById('entry-color-group');
  if (!name) { colorGroup.style.display = 'none'; manualColor = null; return; }
  colorGroup.style.display = '';
  manualColor = surgeonColorMap.get(name) || colorForLabel(name);
  document.querySelectorAll('#entry-color-row .color-swatch').forEach((s) => s.classList.toggle('selected', s.dataset.color === manualColor));
}

function showEntryForm(existing) {
  editingId = existing ? existing.id : null;
  document.getElementById('entry-id').value = editingId || '';
  document.getElementById('entry-day-off').checked = existing ? existing.is_day_off : false;
  document.getElementById('entry-work-fields').style.display = existing && existing.is_day_off ? 'none' : '';
  document.getElementById('entry-surgeon').value = existing ? (existing.surgeon || '') : '';
  document.getElementById('entry-hospital').value = existing ? (existing.hospital || '') : '';
  document.getElementById('entry-note').value = existing ? (existing.note || '') : '';
  document.getElementById('entry-start-time').value = existing ? (existing.start_time || '') : '';
  document.getElementById('entry-end-time').value = existing ? (existing.end_time || '') : '';
  document.getElementById('entry-cancelled').checked = existing ? existing.status === 'cancelled' : false;

  const surgeon = existing ? (existing.surgeon || '') : '';
  const colorGroup = document.getElementById('entry-color-group');
  if (surgeon) {
    colorGroup.style.display = '';
    manualColor = surgeonColorMap.get(surgeon) || existing.color;
  } else {
    colorGroup.style.display = 'none';
    manualColor = null;
  }
  document.querySelectorAll('#entry-color-row .color-swatch').forEach((s) => s.classList.toggle('selected', s.dataset.color === manualColor));

  document.getElementById('entry-form').style.display = '';
  document.getElementById('entry-form-footer').style.display = 'flex';
  document.getElementById('day-add-entry-btn').style.display = 'none';
}

function hideEntryForm() {
  editingId = null;
  document.getElementById('entry-form').style.display = 'none';
  document.getElementById('entry-form-footer').style.display = 'none';
  document.getElementById('day-add-entry-btn').style.display = '';
}

async function onSaveEntry(e) {
  e.preventDefault();
  if (guardLocked()) return;
  const iso = document.getElementById('entry-date').value;
  const isDayOff = document.getElementById('entry-day-off').checked;
  const surgeon = document.getElementById('entry-surgeon').value.trim();
  const hospital = document.getElementById('entry-hospital').value.trim();
  const note = document.getElementById('entry-note').value.trim();
  const startTime = document.getElementById('entry-start-time').value;
  const endTime = document.getElementById('entry-end-time').value;
  const cancelled = document.getElementById('entry-cancelled').checked;

  if (!isDayOff && !surgeon && !hospital) {
    showToast('⚠️ Enter a surgeon or hospital, or mark this as a day off.');
    return;
  }

  const label = isDayOff ? 'Day Off' : [surgeon, hospital].filter(Boolean).join(' @ ');
  const color = manualColor || colorForLabel(label);

  const payload = {
    date: iso,
    surgeon: isDayOff ? null : (surgeon || null),
    hospital: isDayOff ? null : (hospital || null),
    note: isDayOff ? null : (note || null),
    start_time: isDayOff ? null : (startTime || null),
    end_time: isDayOff ? null : (endTime || null),
    is_day_off: isDayOff,
    status: cancelled ? 'cancelled' : 'confirmed',
    color,
  };

  let error;
  if (editingId) {
    ({ error } = await supabase.from('assignments').update(payload).eq('id', editingId));
  } else {
    const { data: { user } } = await supabase.auth.getUser();
    ({ error } = await supabase.from('assignments').insert({ ...payload, user_id: user.id }));
  }

  if (error) { showToast('Save failed: ' + error.message); return; }

  if (!isDayOff && surgeon) await saveSurgeonColor(surgeon, color);

  showToast(editingId ? '✅ Entry updated.' : '✅ Entry added.');
  hideEntryForm();
  await loadAssignments();
  renderAssignmentList(iso);
}
