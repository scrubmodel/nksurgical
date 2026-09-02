-- NK Surgical: schedule + invoicing schema
-- Single-user app (Niaz Khan). RLS scopes every row to auth.uid() so the
-- public anon key embedded in the static frontend can never see another
-- account's data even though the frontend code itself is public.

-- ── ASSIGNMENTS ───────────────────────────────────────────────────────────
-- One row per calendar entry. A day can hold many rows (multiple shifts).
-- Name autocomplete is derived client-side from distinct surgeon/hospital
-- values already used, so no separate contacts table is needed. color
-- defaults client-side to a deterministic hash of the surgeon+hospital
-- combo, and can be overridden per entry.
create table public.assignments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  date         date not null,
  surgeon      text,
  hospital     text,
  note         text,
  is_day_off   boolean not null default false,
  status       text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  color        text not null default '#14335c',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint assignment_has_content check (
    is_day_off or surgeon is not null or hospital is not null
  )
);

create index assignments_user_date_idx on public.assignments (user_id, date);

alter table public.assignments enable row level security;

create policy "assignments_select_own" on public.assignments
  for select using (auth.uid() = user_id);
create policy "assignments_insert_own" on public.assignments
  for insert with check (auth.uid() = user_id);
create policy "assignments_update_own" on public.assignments
  for update using (auth.uid() = user_id);
create policy "assignments_delete_own" on public.assignments
  for delete using (auth.uid() = user_id);

-- ── INVOICES ──────────────────────────────────────────────────────────────
-- Ported from the standalone Khanz Healthcare invoicing app (localStorage +
-- Google Sheets) so records now live in Supabase and sync across devices.
create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  invoice_number text not null,
  hospital       text not null,
  location       text,
  shifts         jsonb not null default '[]'::jsonb, -- [{date, rate}, ...]
  total          numeric(10, 2) not null default 0,
  generated_date date not null,
  display_date   text,
  created_at     timestamptz not null default now()
);

create index invoices_user_idx on public.invoices (user_id);

alter table public.invoices enable row level security;

create policy "invoices_select_own" on public.invoices
  for select using (auth.uid() = user_id);
create policy "invoices_insert_own" on public.invoices
  for insert with check (auth.uid() = user_id);
create policy "invoices_update_own" on public.invoices
  for update using (auth.uid() = user_id);
create policy "invoices_delete_own" on public.invoices
  for delete using (auth.uid() = user_id);

-- ── APP SETTINGS ──────────────────────────────────────────────────────────
-- One row per user holding the invoice letterhead / bank details shown on
-- every generated invoice document.
create table public.app_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

create policy "app_settings_select_own" on public.app_settings
  for select using (auth.uid() = user_id);
create policy "app_settings_insert_own" on public.app_settings
  for insert with check (auth.uid() = user_id);
create policy "app_settings_update_own" on public.app_settings
  for update using (auth.uid() = user_id);
