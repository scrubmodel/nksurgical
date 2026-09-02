import { supabase } from './supabaseClient.js';
import { MONTHS, getOrdinal, fromISODate, todayISO, showToast } from './util.js';

const DEFAULT_SETTINGS = {
  companyName: 'Khanz Healthcare Services Limited',
  address: '7 Norgarth Close, Batley, WF17 6HF',
  bankName: 'Khanz Healthcare Services Limited',
  sortCode: '40-27-15',
  accountNumber: '25032792',
  bank: 'HSBC',
};

let shiftIdCounter = 0;
let shifts = [];
let settings = { ...DEFAULT_SETTINGS };
let records = [];
let currentUserId = null;

export async function initInvoicing() {
  const { data: { user } } = await supabase.auth.getUser();
  currentUserId = user.id;

  document.querySelectorAll('.inv-sub-btn').forEach((btn) => {
    btn.addEventListener('click', () => showInvView(btn.dataset.inv));
  });
  document.getElementById('records-new-btn').addEventListener('click', () => showInvView('form'));

  document.getElementById('add-shift-btn').addEventListener('click', () => addShift());
  document.getElementById('inv-clear-btn').addEventListener('click', clearForm);
  document.getElementById('inv-preview-btn').addEventListener('click', previewInvoice);

  document.getElementById('settings-save-btn').addEventListener('click', saveSettingsFromForm);

  document.getElementById('invoice-modal-close').addEventListener('click', closeInvoiceModal);
  document.getElementById('invoice-modal').addEventListener('click', (e) => { if (e.target.id === 'invoice-modal') closeInvoiceModal(); });
  document.getElementById('invoice-print-btn').addEventListener('click', () => window.print());

  await loadSettings();
  clearForm();
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

function clearForm() {
  document.getElementById('f-hospital').value = '';
  document.getElementById('f-location').value = '';
  shifts = [];
  shiftIdCounter = 0;
  addShift();
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
  const shiftLines = sorted.map((s, i) => `<div class="inv-shift-line">${i + 1}) Worked as a Surgical Practitioner on ${formatFull(s.date)}.</div>`).join('');
  return `
    <div class="inv-number">Invoice No: ${inv.invoice_number}</div>
    <div class="inv-header">
      <div class="inv-sender">
        ${inv.display_date}<br>
        <span class="inv-sender-name">${settings.companyName}</span><br>
        ${settings.address.split(',').map((l) => l.trim()).join('<br>')}
      </div>
    </div>
    <div class="inv-to"><strong>${inv.hospital}</strong><br>${inv.location || ''}</div>
    <div class="inv-body">
      In respect of Clinical Services provided in ${MONTHS[first.getMonth()]}, ${first.getFullYear()} @ ${inv.hospital} are documented below:
      <div class="inv-shifts">${shiftLines}</div>
    </div>
    <div class="inv-total">Total Invoice: <strong>£${parseFloat(inv.total).toFixed(2)}</strong></div>
    <div class="inv-bank">
      <div class="inv-bank-title">Payment Details</div>
      Account Name: ${settings.bankName}<br>
      Sort Code: ${settings.sortCode}<br>
      Account No: ${settings.accountNumber}<br>
      ${settings.bank}.
    </div>`;
}

// ── PREVIEW & SAVE ──
async function previewInvoice() {
  const hospital = document.getElementById('f-hospital').value.trim();
  const location = document.getElementById('f-location').value.trim();

  if (!hospital) { showToast('⚠️ Please enter the hospital name.'); return; }
  const emptyDate = shifts.some((s) => !s.date);
  const emptyRate = shifts.some((s) => !s.rate || parseFloat(s.rate) <= 0);
  if (emptyDate) { showToast('⚠️ Please fill in all shift dates.'); return; }
  if (emptyRate) { showToast('⚠️ Please enter a rate for each shift.'); return; }

  const invoice_number = await generateInvoiceNumber();
  const total = shifts.reduce((sum, s) => sum + (parseFloat(s.rate) || 0), 0);

  const inv = {
    user_id: currentUserId,
    invoice_number,
    hospital,
    location,
    shifts: shifts.map((s) => ({ date: s.date, rate: parseFloat(s.rate) })),
    total,
    generated_date: todayISO(),
    display_date: todayDisplay(),
  };

  const { data, error } = await supabase.from('invoices').insert(inv).select().single();
  if (error) { showToast('Save failed: ' + error.message); return; }

  document.getElementById('invoice-doc').innerHTML = buildInvoiceHTML(data);
  document.getElementById('invoice-modal').classList.add('open');
  showToast('✅ Invoice saved.');
  clearForm();
}

// ── MODAL ──
function closeInvoiceModal() { document.getElementById('invoice-modal').classList.remove('open'); }

// ── RECORDS ──
async function loadRecords() {
  const { data, error } = await supabase.from('invoices').select('*').order('created_at', { ascending: false });
  if (error) { showToast('Could not load records: ' + error.message); return; }
  records = data || [];
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
    return `
    <div class="card record-card" data-id="${inv.id}">
      <div class="record-num">${inv.invoice_number}</div>
      <div class="record-info">
        <div class="record-hospital">${inv.hospital}${inv.location ? ', ' + inv.location : ''}</div>
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
    });
  });
}

function viewRecord(id) {
  const inv = records.find((r) => r.id === id);
  document.getElementById('invoice-doc').innerHTML = buildInvoiceHTML(inv);
  document.getElementById('invoice-modal').classList.add('open');
}
