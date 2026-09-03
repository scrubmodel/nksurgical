-- Invoices generated ad-hoc (not sourced from a calendar booking) have no
-- linked assignments, so there was no way to mark them paid at all — only
-- invoices generated from Pending could track payment, via their linked
-- assignments' invoice_status. Add an invoice-level paid marker so every
-- invoice can be tracked for reporting/collections, regardless of how it
-- was created. Where an invoice does have linked assignments, their
-- per-shift status remains the source of truth (this column is unused for
-- those, since partial payment across shifts needs the finer-grained data).
alter table public.invoices add column paid_at timestamptz;
