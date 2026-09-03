import { supabase } from './supabaseClient.js';
import { MONTHS, todayISO, escapeHtml, showToast } from './util.js';

let anchorDate = new Date();
let allAssignments = [];
let allInvoices = [];
let linkedByInvoice = new Map(); // invoice_id -> [{date, invoice_status}]

export async function initReports() {
  document.getElementById('rep-prev').addEventListener('click', () => { anchorDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - 1, 1); render(); });
  document.getElementById('rep-next').addEventListener('click', () => { anchorDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 1); render(); });
  document.getElementById('rep-today').addEventListener('click', () => { anchorDate = new Date(); render(); });
  document.getElementById('rep-export-btn').addEventListener('click', exportCsv);
  document.getElementById('pipeline-goto-pending').addEventListener('click', () => {
    document.querySelector('.tab-btn[data-page="invoicing"]').click();
    document.querySelector('.inv-sub-btn[data-inv="pending"]').click();
  });

  // Re-fetch whenever the tab is opened, so it reflects anything changed on
  // the Calendar/Invoicing tabs without needing a full page reload.
  document.querySelector('.tab-btn[data-page="reports"]').addEventListener('click', loadData);

  await loadData();
}

async function loadData() {
  const [{ data: assignments, error: aErr }, { data: invoices, error: iErr }] = await Promise.all([
    supabase.from('assignments').select('*').eq('is_day_off', false),
    supabase.from('invoices').select('*'),
  ]);
  if (aErr) { showToast('Could not load report data: ' + aErr.message); return; }
  if (iErr) { showToast('Could not load report data: ' + iErr.message); return; }
  allAssignments = assignments || [];
  allInvoices = invoices || [];

  linkedByInvoice = new Map();
  const invoiceIds = allAssignments.filter((a) => a.invoice_id).map((a) => a.invoice_id);
  if (invoiceIds.length) {
    for (const a of allAssignments) {
      if (!a.invoice_id) continue;
      if (!linkedByInvoice.has(a.invoice_id)) linkedByInvoice.set(a.invoice_id, []);
      linkedByInvoice.get(a.invoice_id).push({ date: a.date, invoice_status: a.invoice_status });
    }
  }

  render();
}

// ── HELPERS ──
function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function fmtMoney(n) { return `£${(n || 0).toFixed(2)}`; }
function sum(arr) { return arr.reduce((s, n) => s + n, 0); }

function flattenShifts() {
  const rows = [];
  for (const inv of allInvoices) {
    const shifts = Array.isArray(inv.shifts) ? inv.shifts : [];
    for (const s of shifts) rows.push({ date: s.date, rate: Number(s.rate) || 0, invoice: inv });
  }
  return rows;
}

function isInvoicePaid(inv) {
  const linked = linkedByInvoice.get(inv.id);
  if (linked && linked.length) return linked.every((a) => a.invoice_status === 'paid');
  return !!inv.paid_at;
}

function isShiftLinePaid(row) {
  const linked = linkedByInvoice.get(row.invoice.id);
  if (linked && linked.length) {
    const match = linked.find((a) => a.date === row.date);
    return match ? match.invoice_status === 'paid' : false;
  }
  return !!row.invoice.paid_at;
}

function daysSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

// ── RENDER ──
function render() {
  const label = `${MONTHS[anchorDate.getMonth()]} ${anchorDate.getFullYear()}`;
  document.getElementById('rep-period-label').textContent = label;

  const key = monthKey(anchorDate);
  const prevDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - 1, 1);
  const prevKey = monthKey(prevDate);

  const allRows = flattenShifts();
  const monthRows = allRows.filter((r) => r.date.slice(0, 7) === key);
  const prevMonthRows = allRows.filter((r) => r.date.slice(0, 7) === prevKey);

  renderKpis(monthRows, prevMonthRows);
  renderShiftActivity(key);
  renderPipeline();
  renderChart(allRows);
  renderRankings(monthRows, 'surgeon', 'revenue-by-surgeon');
  renderRankings(monthRows, 'hospital', 'revenue-by-hospital');
}

function renderKpis(monthRows, prevMonthRows) {
  const invoiced = sum(monthRows.map((r) => r.rate));
  const collected = sum(monthRows.filter(isShiftLinePaid).map((r) => r.rate));
  const average = monthRows.length ? invoiced / monthRows.length : 0;
  const invoicedPrev = sum(prevMonthRows.map((r) => r.rate));

  document.getElementById('kpi-invoiced').textContent = fmtMoney(invoiced);
  document.getElementById('kpi-collected').textContent = fmtMoney(collected);
  document.getElementById('kpi-average').textContent = fmtMoney(average);

  const deltaEl = document.getElementById('kpi-invoiced-delta');
  if (invoicedPrev > 0) {
    const pct = ((invoiced - invoicedPrev) / invoicedPrev) * 100;
    deltaEl.textContent = `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}% vs last month`;
    deltaEl.className = 'kpi-delta ' + (pct >= 0 ? 'up' : 'down');
  } else {
    deltaEl.textContent = invoiced > 0 ? 'No prior month to compare' : '';
    deltaEl.className = 'kpi-delta';
  }

  const unbilled = allAssignments.filter((a) => a.invoice_status === 'pending' && a.date <= todayISO()).length;
  document.getElementById('kpi-unbilled').textContent = String(unbilled);
}

function renderShiftActivity(key) {
  const monthAssignments = allAssignments.filter((a) => a.date.slice(0, 7) === key);
  const today = todayISO();
  const completed = monthAssignments.filter((a) => a.status === 'confirmed' && a.date <= today).length;
  const upcoming = monthAssignments.filter((a) => a.status === 'confirmed' && a.date > today).length;
  const cancelled = monthAssignments.filter((a) => a.status === 'cancelled').length;
  document.getElementById('ops-completed').textContent = completed;
  document.getElementById('ops-upcoming').textContent = upcoming;
  document.getElementById('ops-cancelled').textContent = cancelled;
}

function renderPipeline() {
  const today = todayISO();
  const pendingSubmission = allAssignments.filter((a) => a.invoice_status === 'pending' && a.date <= today).length;
  document.getElementById('pipeline-submission-count').textContent = pendingSubmission;

  const unpaid = allInvoices.filter((inv) => !isInvoicePaid(inv));
  const overdue = unpaid.filter((inv) => daysSince(inv.generated_date) > 30);

  const pendingTotal = sum(unpaid.map((inv) => Number(inv.total) || 0));
  const overdueTotal = sum(overdue.map((inv) => Number(inv.total) || 0));

  document.getElementById('pipeline-payment-count').textContent = fmtMoney(pendingTotal);
  document.getElementById('pipeline-payment-invoices').textContent = `${unpaid.length} invoice${unpaid.length !== 1 ? 's' : ''}`;
  document.getElementById('pipeline-overdue-count').textContent = fmtMoney(overdueTotal);
  document.getElementById('pipeline-overdue-invoices').textContent = `${overdue.length} invoice${overdue.length !== 1 ? 's' : ''}`;
}

function renderChart(allRows) {
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - i, 1);
    months.push({ key: monthKey(d), label: MONTHS[d.getMonth()].slice(0, 3), isSelected: i === 0 });
  }
  const totals = months.map((m) => ({ ...m, total: sum(allRows.filter((r) => r.date.slice(0, 7) === m.key).map((r) => r.rate)) }));
  const max = Math.max(...totals.map((m) => m.total), 1);

  const w = 760, h = 190, barGap = 10, chartBottom = 150;
  const barWidth = (w - barGap * (totals.length - 1)) / totals.length;

  let bars = '';
  totals.forEach((m, i) => {
    const barH = (m.total / max) * (chartBottom - 20);
    const x = i * (barWidth + barGap);
    const y = chartBottom - barH;
    bars += `<rect class="rev-bar ${m.isSelected ? 'selected' : ''}" x="${x}" y="${y}" width="${barWidth}" height="${Math.max(barH, 1)}" rx="3"><title>${m.label}: ${fmtMoney(m.total)}</title></rect>`;
    if (m.isSelected) {
      bars += `<text class="rev-bar-label" x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle">${fmtMoney(m.total)}</text>`;
    }
    bars += `<text class="rev-month-label" x="${x + barWidth / 2}" y="${chartBottom + 18}" text-anchor="middle">${m.label}</text>`;
  });

  document.getElementById('revenue-chart').innerHTML = `
    <svg class="rev-chart-svg" viewBox="0 0 ${w} ${chartBottom + 30}" width="${w}" height="${chartBottom + 30}">
      <line class="rev-axis-line" x1="0" y1="${chartBottom}" x2="${w}" y2="${chartBottom}"></line>
      ${bars}
    </svg>`;
}

function renderRankings(monthRows, type, containerId) {
  const rows = monthRows.filter((r) => r.invoice.recipient_type === type);
  const byName = new Map();
  for (const r of rows) {
    if (!byName.has(r.invoice.recipient_name)) byName.set(r.invoice.recipient_name, { total: 0, count: 0 });
    const entry = byName.get(r.invoice.recipient_name);
    entry.total += r.rate;
    entry.count += 1;
  }
  const ranked = [...byName.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total);
  const grandTotal = sum(ranked.map((r) => r.total)) || 1;

  const container = document.getElementById(containerId);
  if (ranked.length === 0) {
    container.innerHTML = `<div class="reports-empty">No ${type} invoices for this month.</div>`;
    return;
  }
  container.innerHTML = `<div class="rank-list">${ranked.map((r) => {
    const pct = (r.total / grandTotal) * 100;
    return `
    <div class="rank-row">
      <div class="rank-row-top">
        <span class="rank-name">${escapeHtml(r.name)}</span>
        <span class="rank-amount">${fmtMoney(r.total)}</span>
      </div>
      <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="rank-meta">${r.count} case${r.count !== 1 ? 's' : ''} · ${pct.toFixed(0)}% of this month's income</div>
    </div>`;
  }).join('')}</div>`;
}

// ── EXPORT ──
function exportCsv() {
  const key = monthKey(anchorDate);
  const allRows = flattenShifts();
  const monthRows = allRows.filter((r) => r.date.slice(0, 7) === key);
  const invoiced = sum(monthRows.map((r) => r.rate));
  const collected = sum(monthRows.filter(isShiftLinePaid).map((r) => r.rate));

  const lines = [
    `NK Surgical — Report for ${MONTHS[anchorDate.getMonth()]} ${anchorDate.getFullYear()}`,
    '',
    'Metric,Value',
    `Invoiced,${invoiced.toFixed(2)}`,
    `Collected,${collected.toFixed(2)}`,
    `Average Shift Earnings,${(monthRows.length ? invoiced / monthRows.length : 0).toFixed(2)}`,
    '',
    'Revenue by Surgeon',
    'Name,Total,Cases',
  ];
  addRankingCsvRows(lines, monthRows, 'surgeon');
  lines.push('', 'Revenue by Hospital', 'Name,Total,Cases');
  addRankingCsvRows(lines, monthRows, 'hospital');

  const csv = lines.map((l) => l).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nk-surgical-report-${key}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function addRankingCsvRows(lines, monthRows, type) {
  const rows = monthRows.filter((r) => r.invoice.recipient_type === type);
  const byName = new Map();
  for (const r of rows) {
    if (!byName.has(r.invoice.recipient_name)) byName.set(r.invoice.recipient_name, { total: 0, count: 0 });
    const entry = byName.get(r.invoice.recipient_name);
    entry.total += r.rate;
    entry.count += 1;
  }
  const ranked = [...byName.entries()].sort((a, b) => b[1].total - a[1].total);
  for (const [name, v] of ranked) {
    lines.push(`"${name.replace(/"/g, '""')}",${v.total.toFixed(2)},${v.count}`);
  }
}
