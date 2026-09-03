-- Surgeon-billing workflow: persistent per-surgeon colours, optional shift
-- times, and a pending -> submitted -> paid status per calendar entry that
-- links to the invoice it was billed on (supporting partial payment, since
-- status lives per-entry rather than per-invoice).

-- ── SURGEONS ──────────────────────────────────────────────────────────────
-- One colour per surgeon, reused across every booking with them instead of
-- being picked (or re-hashed) per entry.
create table public.surgeons (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  color      text not null default '#14335c',
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.surgeons enable row level security;

create policy "surgeons_select_own" on public.surgeons
  for select using (auth.uid() = user_id);
create policy "surgeons_insert_own" on public.surgeons
  for insert with check (auth.uid() = user_id);
create policy "surgeons_update_own" on public.surgeons
  for update using (auth.uid() = user_id);
create policy "surgeons_delete_own" on public.surgeons
  for delete using (auth.uid() = user_id);

-- ── INVOICES: generalise recipient from "hospital" to hospital OR surgeon ──
alter table public.invoices rename column hospital to recipient_name;
alter table public.invoices
  add column recipient_type text not null default 'hospital' check (recipient_type in ('hospital', 'surgeon'));

-- ── ASSIGNMENTS: optional shift time + invoicing status ────────────────────
alter table public.assignments
  add column start_time text,
  add column end_time text,
  add column invoice_status text not null default 'pending' check (invoice_status in ('pending', 'submitted', 'paid')),
  add column invoice_id uuid references public.invoices(id) on delete set null;

create index assignments_invoice_id_idx on public.assignments (invoice_id);
create index assignments_pending_idx on public.assignments (user_id, invoice_status) where surgeon is not null;
