import { supabase } from './supabaseClient.js';
import { MONTHS, getOrdinal, fromISODate, todayISO, showToast, escapeHtml } from './util.js';
import { primedForInvoice, loadAssignments as reloadCalendarAssignments } from './calendar.js';

const DEFAULT_SETTINGS = {
  companyName: 'Khanz Healthcare Services Limited',
  address: '7 Norgarth Close, Batley, WF17 6HF',
  bankName: 'Khanz Healthcare Services Limited',
  sortCode: '40-27-15',
  accountNumber: '25032792',
  bank: 'HSBC',
};

const STATUS_LABEL = { pending: 'Pending', submitted: 'Submitted', paid: 'Paid' };

let shiftIdCounter = 0;
let shifts = [];
let settings = { ...DEFAULT_SETTINGS };
let records = [];
let recordStatusById = new Map();
let currentUserId = null;

let recipientType = 'hospital';
let pendingSourceIds = [];
let pendingAssignments = [];

export async function initInvoicing() {
  const { data: { user } } = await supabase.auth.getUser();
  currentUserId = user.id;

  document.querySelectorAll('.inv-sub-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.inv === 'form') clearForm('hospital');
      showInvView(btn.dataset.inv);
    });
  });
  document.getElementById('records-new-btn').addEventListener('click', () => { clearForm('hospital'); showInvView('form'); });

  document.getElementById('add-shift-btn').addEventListener('click', () => addShift());
  document.getElementById('inv-clear-btn').addEventListener('click', () => clearForm('hospital'));
  document.getElementById('inv-preview-btn').addEventListener('click', previewInvoice);

  document.getElementById('settings-save-btn').addEventListener('click', saveSettingsFromForm);

  document.getElementById('invoice-modal-close').addEventListener('click', closeInvoiceModal);
  document.getElementById('invoice-modal').addEventListener('click', (e) => { if (e.target.id === 'invoice-modal') closeInvoiceModal(); });
  document.getElementById('invoice-print-btn').addEventListener('click', () => window.print());

  await loadSettings();
  await refreshPendingCount();
  clearForm('hospital');
}

function formatFull(iso) {
  const d = fromISODate(iso);
  return `${getOrdinal(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function todayDisplay() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// ── SUB-VIEWS ──
function showInvView(name) {
  document.querySelectorAll('.inv-view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.inv-sub-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById('inv-view-' + name).classList.add('active');
  document.querySelector(`.inv-sub-btn[data-inv="${name}"]`).classList.add('active');
  if (name === 'records') loadRecords();
  if (name === 'settings') populateSettingsForm();
  if (name === 'pending') loadPending();
}

// ── SETTINGS ──
async function loadSettings() {
  const { data, error } = await supabase.from('app_settings').select('data').eq('user_id', currentUserId).maybeSingle();
  if (error) { showToast('Could not load settings: ' + error.message); return; }
  settings = { ...DEFAULT_SETTINGS, ...(data ? data.data : {}) };
}

function populateSettingsForm() {
  document.getElementById('s-company-name').value = settings.companyName;
  document.getElementById('s-address').value = settings.address;
  document.getElementById('s-bank-name').value = settings.bankName;
  document.getElementById('s-sort-code').value = settings.sortCode;
  document.getElementById('s-account-number').value = settings.accountNumber;
  document.getElementById('s-bank').value = settings.bank;
}

async function saveSettingsFromForm() {
  settings = {
    companyName: document.getElementById('s-company-name').value.trim() || DEFAULT_SETTINGS.companyName,
    address: document.getElementById('s-address').value.trim() || DEFAULT_SETTINGS.address,
    bankName: document.getElementById('s-bank-name').value.trim() || DEFAULT_SETTINGS.bankName,
    sortCode: document.getElementById('s-sort-code').value.trim() || DEFAULT_SETTINGS.sortCode,
    accountNumber: document.getElementById('s-account-number').value.trim() || DEFAULT_SETTINGS.accountNumber,
    bank: document.getElementById('s-bank').value.trim() || DEFAULT_SETTINGS.bank,
  };
  const { error } = await supabase.from('app_settings').upsert({ user_id: currentUserId, data: settings, updated_at: new Date().toISOString() });
  if (error) { showToast('Save failed: ' + error.message); return; }
  showToast('✅ Settings saved.');
}

// ── SHIFTS STATE ──
function addShift(dateVal, rateVal) {
  shiftIdCounter++;
  shifts.push({ id: shiftIdCounter, date: dateVal || '', rate: rateVal || '' });
  renderShifts();
  updateTotal();
}

function removeShift(id) {
  const idx = shifts.findIndex((s) => s.id === id);
  if (idx > -1) shifts.splice(idx, 1);
  renderShifts();
  updateTotal();
}

function onShiftChange(id, field, val) {
  const s = shifts.find((s) => s.id === id);
  if (s) s[field] = val;
  updateTotal();
}
window.__nkOnShiftChange = onShiftChange;
window.__nkRemoveShift = removeShift;

function renderShifts() {
  const list = document.getElementById('shifts-list');
  list.innerHTML = `
    <div class="shifts-col-headers"><span></span><span>Date</span><span>Rate (£)</span><span></span></div>
    ${shifts.map((s, i) => `
    <div class="shift-row">
      <span class="shift-row-num">${i + 1}</span>
      <input type="date" value="${s.date}" onchange="__nkOnShiftChange(${s.id},'date',this.value)">
      <div class="shift-rate-wrap">
        <span class="prefix">£</span>
        <input type="number" placeholder="0.00" step="0.01" min="0" value="${s.rate}" oninput="__nkOnShiftChange(${s.id},'rate',this.value)">
      </div>
      <button type="button" class="shift-remove" onclick="__nkRemoveShift(${s.id})" ${shifts.length === 1 ? 'disabled' : ''} title="Remove shift">✕</button>
    </div>`).join('')}`;
  const n = shifts.length;
  document.getElementById('shift-count').textContent = `${n} shift${n !== 1 ? 's' : ''}`;
}

function updateTotal() {
  const lines = shifts.map((s, i) => `Shift ${i + 1}: <span>£${(parseFloat(s.rate) || 0).toFixed(2)}</span>`);
  const total = shifts.reduce((sum, s) => sum + (parseFloat(s.rate) || 0), 0);
  document.getElementById('total-calc-text').innerHTML = lines.join(' &nbsp;·&nbsp; ');
  document.getElementById('total-display').textContent = `£${total.toFixed(2)}`;
}

function applyRecipientLabels() {
  const isSurgeon = recipientType === 'surgeon';
  document.getElementById('form-title').textContent = isSurgeon ? `Generate Invoice — ${document.getElementById('f-hospital').value || 'Surgeon'}` : 'Generate New Invoice';
  document.getElementById('form-subtitle').textContent = isSurgeon
    ? 'Billing this surgeon for the sessions selected from Pending — add a rate for each.'
    : 'Add each shift with its own date and rate — total calculates automatically.';
  document.getElementById('f-recipient-label').textContent = isSurgeon ? 'Surgeon Name' : 'Hospital / Client Name';
  document.getElementById('f-location-label').textContent = isSurgeon ? 'Note (optional)' : 'Hospital Location';
}

function clearForm(type) {
  recipientType = type || recipientType;
  pendingSourceIds = [];
  document.getElementById('f-hospital').value = '';
  document.getElementById('f-location').value = '';
  shifts = [];
  shiftIdCounter = 0;
  addShift();
  applyRecipientLabels();
}

// ── INVOICE NUMBER ──
async function generateInvoiceNumber() {
  const [y, m, d] = todayISO().split('-');
  const base = `${d}${m}${y}`;
  const { count, error } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('generated_date', todayISO());
  if (error || !count) return base;
  return `${base}-${String(count).padStart(2, '0')}`;
}

// ── BUILD INVOICE DOCUMENT ──
function buildInvoiceHTML(inv) {
  const sorted = [...inv.shifts].sort((a, b) => a.date.localeCompare(b.date));
  const first = fromISODate(sorted[0].date);
  const isSurgeon = inv.recipient_type === 'surgeon';
  const shiftLines = sorted.map((s, i) => {
    const timeRange = s.start_time && s.end_time ? ` (${s.start_time}–${s.end_time})` : '';
    const verb = isSurgeon ? `Assisted ${escapeHtml(inv.recipient_name)}` : 'Worked as a Surgical Practitioner';
    return `<div class="inv-shift-line">${i + 1}) ${verb} on ${formatFull(s.date)}${timeRange}.</div>`;
  }).join('');
  const bodyIntro = isSurgeon
    ? `In respect of Clinical Services provided in ${MONTHS[first.getMonth()]}, ${first.getFullYear()} assisting ${escapeHtml(inv.recipient_name)} are documented below:`
    : `In respect of Clinical Services provided in ${MONTHS[first.getMonth()]}, ${first.getFullYear()} @ ${escapeHtml(inv.recipient_name)} are documented below:`;

  return `
    <div class="inv-number">Invoice No: ${inv.invoice_number}</div>
    <div class="inv-header">
      <div class="inv-sender">
        ${inv.display_date}<br>
        <span class="inv-sender-name">${escapeHtml(settings.companyName)}</span><br>
        ${settings.address.split(',').map((l) => escapeHtml(l.trim())).join('<br>')}
      </div>
    </div>
    <div class="inv-to"><strong>${escapeHtml(inv.recipient_name)}</strong>${inv.location ? `<br>${escapeHtml(inv.location)}` : ''}</div>
    <div class="inv-body">
      ${bodyIntro}
      <div class="inv-shifts">${shiftLines}</div>
    </div>
    <div class="inv-total">Total Invoice: <strong>£${parseFloat(inv.total).toFixed(2)}</strong></div>
    <div class="inv-bank">
      <div class="inv-bank-title">Payment Details</div>
      Account Name: ${escapeHtml(settings.bankName)}<br>
      Sort Code: ${escapeHtml(settings.sortCode)}<br>
      Account No: ${escapeHtml(settings.accountNumber)}<br>
      ${escapeHtml(settings.bank)}.
    </div>`;
}

// ── PREVIEW & SAVE ──
async function previewInvoice() {
  const recipientName = document.getElementById('f-hospital').value.trim();
  const location = document.getElementById('f-location').value.trim();

  if (!recipientName) { showToast(recipientType === 'surgeon' ? '⚠️ Missing surgeon name.' : '⚠️ Please enter the hospital name.'); return; }
  const emptyDate = shifts.some((s) => !s.date);
  const emptyRate = shifts.some((s) => !s.rate || parseFloat(s.rate) <= 0);
  if (emptyDate) { showToast('⚠️ Please fill in all shift dates.'); return; }
  if (emptyRate) { showToast('⚠️ Please enter a rate for each shift.'); return; }

  const invoice_number = await generateInvoiceNumber();
  const total = shifts.reduce((sum, s) => sum + (parseFloat(s.rate) || 0), 0);

  const inv = {
    user_id: currentUserId,
    invoice_number,
    recipient_type: recipientType,
    recipient_name: recipientName,
    location,
    shifts: shifts.map((s) => ({
      date: s.date,
      rate: parseFloat(s.rate),
      ...(s.start_time ? { start_time: s.start_time } : {}),
      ...(s.end_time ? { end_time: s.end_time } : {}),
    })),
    total,
    generated_date: todayISO(),
    display_date: todayDisplay(),
  };

  const { data, error } = await supabase.from('invoices').insert(inv).select().single();
  if (error) { showToast('Save failed: ' + error.message); return; }

  const wasFromPending = pendingSourceIds.length > 0;
  if (wasFromPending) {
    const { error: linkError } = await supabase
      .from('assignments')
      .update({ invoice_status: 'submitted', invoice_id: data.id })
      .in('id', pendingSourceIds);
    if (linkError) showToast('Invoice saved, but linking bookings failed: ' + linkError.message);
    pendingSourceIds.forEach((id) => primedForInvoice.delete(id));
    await reloadCalendarAssignments();
    await refreshPendingCount();
  }

  document.getElementById('invoice-doc').innerHTML = buildInvoiceHTML(data);
  document.getElementById('invoice-payment-panel').style.display = 'none';
  document.getElementById('invoice-modal').classList.add('open');
  showToast('✅ Invoice saved.');
  clearForm('hospital');
  showInvView(wasFromPending ? 'pending' : 'records');
}

// ── MODAL ──
function closeInvoiceModal() { document.getElementById('invoice-modal').classList.remove('open'); }

// ── PENDING ──
async function loadPending() {
  const { data, error } = await supabase
    .from('assignments')
    .select('*')
    .eq('invoice_status', 'pending')
    .not('surgeon', 'is', null)
    .order('date');
  if (error) { showToast('Could not load pending bookings: ' + error.message); return; }
  pendingAssignments = data || [];
  renderPending();
  document.getElementById('pending-count').textContent = pendingAssignments.length;
}

async function refreshPendingCount() {
  const { count } = await supabase
    .from('assignments')
    .select('id', { count: 'exact', head: true })
    .eq('invoice_status', 'pending')
    .not('surgeon', 'is', null);
  document.getElementById('pending-count').textContent = count || 0;
}

function renderPending() {
  const container = document.getElementById('pending-container');
  if (pendingAssignments.length === 0) {
    container.innerHTML = `<div class="card pending-empty">No bookings waiting to be invoiced. Add a surgeon to a calendar entry, or send one to invoicing from its day view.</div>`;
    return;
  }

  const groups = new Map();
  for (const a of pendingAssignments) {
    if (!groups.has(a.surgeon)) groups.set(a.surgeon, []);
    groups.get(a.surgeon).push(a);
  }

  container.innerHTML = [...groups.entries()].map(([surgeon, entries]) => `
    <div class="card pending-group" data-surgeon="${escapeHtml(surgeon)}" style="padding:16px;">
      <div class="pending-group-header">
        <input type="checkbox" class="group-select-all">
        <span>${escapeHtml(surgeon)}</span>
        <span class="badge">${entries.length}</span>
      </div>
      <div class="pending-rows">
        ${entries.map((a) => `
          <label class="pending-row">
            <input type="checkbox" class="pending-checkbox" value="${a.id}" ${primedForInvoice.has(a.id) ? 'checked' : ''}>
            <span class="pending-row-date">${formatFull(a.date)}</span>
            <span class="pending-row-meta">${[a.hospital, a.start_time && a.end_time ? `${a.start_time}–${a.end_time}` : '', a.note].filter(Boolean).map(escapeHtml).join(' · ') || '—'}</span>
          </label>`).join('')}
      </div>
      <div class="pending-action-bar">
        <span class="selected-count" style="font-size:0.82rem; color:var(--muted);">0 selected</span>
        <button class="btn btn-teal btn-sm generate-btn" disabled>Generate Invoice</button>
      </div>
    </div>`).join('');

  container.querySelectorAll('.pending-group').forEach((groupEl) => {
    const surgeon = groupEl.dataset.surgeon;
    const checkboxes = [...groupEl.querySelectorAll('.pending-checkbox')];
    const countEl = groupEl.querySelector('.selected-count');
    const generateBtn = groupEl.querySelector('.generate-btn');
    const selectAll = groupEl.querySelector('.group-select-all');

    function refreshGroupUI() {
      const checked = checkboxes.filter((cb) => cb.checked);
      countEl.textContent = `${checked.length} selected`;
      generateBtn.disabled = checked.length === 0;
      selectAll.checked = checked.length === checkboxes.length;
      checked.forEach((cb) => primedForInvoice.add(cb.value));
    }

    checkboxes.forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) primedForInvoice.add(cb.value); else primedForInvoice.delete(cb.value);
        refreshGroupUI();
      });
    });
    selectAll.addEventListener('change', () => {
      checkboxes.forEach((cb) => { cb.checked = selectAll.checked; if (cb.checked) primedForInvoice.add(cb.value); else primedForInvoice.delete(cb.value); });
      refreshGroupUI();
    });
    generateBtn.addEventListener('click', () => {
      const selectedIds = checkboxes.filter((cb) => cb.checked).map((cb) => cb.value);
      const selected = pendingAssignments.filter((a) => selectedIds.includes(a.id));
      startInvoiceFromPending(surgeon, selected);
    });

    refreshGroupUI();
  });
}

function startInvoiceFromPending(surgeon, selected) {
  clearForm('surgeon');
  document.getElementById('f-hospital').value = surgeon;
  pendingSourceIds = selected.map((a) => a.id);
  shifts = [];
  shiftIdCounter = 0;
  [...selected].sort((a, b) => a.date.localeCompare(b.date)).forEach((a) => {
    shiftIdCounter++;
    shifts.push({ id: shiftIdCounter, date: a.date, rate: '', start_time: a.start_time || '', end_time: a.end_time || '' });
  });
  renderShifts();
  updateTotal();
  applyRecipientLabels();
  showInvView('form');
}

// ── RECORDS ──
async function loadRecords() {
  const { data, error } = await supabase.from('invoices').select('*').order('created_at', { ascending: false });
  if (error) { showToast('Could not load records: ' + error.message); return; }
  records = data || [];

  const surgeonInvoiceIds = records.filter((r) => r.recipient_type === 'surgeon').map((r) => r.id);
  recordStatusById = new Map();
  if (surgeonInvoiceIds.length) {
    const { data: linked, error: linkedError } = await supabase
      .from('assignments')
      .select('invoice_id, invoice_status')
      .in('invoice_id', surgeonInvoiceIds);
    if (!linkedError) {
      const grouped = new Map();
      for (const a of linked || []) {
        if (!grouped.has(a.invoice_id)) grouped.set(a.invoice_id, []);
        grouped.get(a.invoice_id).push(a.invoice_status);
      }
      for (const [id, statuses] of grouped) {
        const paidCount = statuses.filter((s) => s === 'paid').length;
        recordStatusById.set(id, paidCount === statuses.length ? 'paid' : paidCount > 0 ? 'partial' : 'submitted');
      }
    }
  }

  renderRecords();
}

function renderRecords() {
  document.getElementById('records-count').textContent = records.length;
  const container = document.getElementById('records-container');
  if (records.length === 0) {
    container.innerHTML = `<div class="card records-empty"><div class="empty-icon">🗂️</div><h3>No invoices yet</h3><p>Generate your first invoice to see it here.</p></div>`;
    return;
  }
  container.innerHTML = `<div class="records-list">${records.map((inv) => {
    const n = inv.shifts.length;
    const sorted = [...inv.shifts].sort((a, b) => a.date.localeCompare(b.date));
    const first = fromISODate(sorted[0].date);
    const status = recordStatusById.get(inv.id);
    const statusBadge = status ? `<span class="record-status-badge status-${status}">${status === 'partial' ? 'Partially Paid' : status}</span>` : '';
    return `
    <div class="card record-card" data-id="${inv.id}">
      <div class="record-num">${inv.invoice_number}</div>
      <div class="record-info">
        <div class="record-hospital">${escapeHtml(inv.recipient_name)}${inv.location ? ', ' + escapeHtml(inv.location) : ''} ${statusBadge}</div>
        <div class="record-date">${n} shift${n !== 1 ? 's' : ''} · ${MONTHS[first.getMonth()]} ${first.getFullYear()} · Generated: ${inv.display_date || inv.generated_date}</div>
      </div>
      <div class="record-amount">£${parseFloat(inv.total).toFixed(2)}</div>
      <div class="record-actions">
        <button class="btn btn-outline btn-sm view-btn">View</button>
        <button class="btn btn-danger btn-sm delete-btn">Delete</button>
      </div>
    </div>`;
  }).join('')}</div>`;

  container.querySelectorAll('.record-card').forEach((card) => {
    const id = card.dataset.id;
    card.querySelector('.view-btn').addEventListener('click', (e) => { e.stopPropagation(); viewRecord(id); });
    card.addEventListener('click', () => viewRecord(id));
    card.querySelector('.delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this invoice record? This cannot be undone.')) return;
      const { error } = await supabase.from('invoices').delete().eq('id', id);
      if (error) { showToast('Delete failed: ' + error.message); return; }
      showToast('🗑️ Invoice deleted.');
      await loadRecords();
      await reloadCalendarAssignments();
    });
  });
}

async function viewRecord(id) {
  const inv = records.find((r) => r.id === id);
  document.getElementById('invoice-doc').innerHTML = buildInvoiceHTML(inv);
  document.getElementById('invoice-modal').classList.add('open');

  const panel = document.getElementById('invoice-payment-panel');
  if (inv.recipient_type !== 'surgeon') { panel.style.display = 'none'; return; }

  const { data: linked, error } = await supabase.from('assignments').select('*').eq('invoice_id', id).order('date');
  if (error || !linked || linked.length === 0) { panel.style.display = 'none'; return; }

  renderPaymentPanel(linked);
  panel.style.display = '';
}

function renderPaymentPanel(linked) {
  const panel = document.getElementById('invoice-payment-panel');
  panel.innerHTML = `<div class="payment-panel-title">Payment Status</div>` + linked.map((a) => {
    const isPaid = a.invoice_status === 'paid';
    return `
    <div class="payment-line" data-id="${a.id}">
      <span class="payment-line-date">${formatFull(a.date)}</span>
      <button class="payment-status-btn" style="background:${isPaid ? 'var(--success-pale)' : '#f5e9d0'}; color:${isPaid ? 'var(--success)' : '#b8862a'};">
        ${isPaid ? '✓ Paid' : 'Mark Paid'}
      </button>
    </div>`;
  }).join('');

  panel.querySelectorAll('.payment-status-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.payment-line').dataset.id;
      const current = linked.find((a) => a.id === id);
      const next = current.invoice_status === 'paid' ? 'submitted' : 'paid';
      const { error } = await supabase.from('assignments').update({ invoice_status: next }).eq('id', id);
      if (error) { showToast('Update failed: ' + error.message); return; }
      current.invoice_status = next;
      renderPaymentPanel(linked);
      showToast(next === 'paid' ? '✅ Marked as paid.' : 'Marked as submitted.');
      await reloadCalendarAssignments();
      await loadRecords();
    });
  });
}
