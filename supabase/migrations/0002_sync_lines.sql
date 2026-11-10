-- Bundle 2: transaction sync refinements.
alter table grants.qbo_lines
  add column if not exists detail_type text,                 -- AccountBasedExpenseLineDetail | ItemBasedExpenseLineDetail | JournalEntryLineDetail
  add column if not exists is_expense boolean not null default true,   -- account classification = Expense (or unknown account)
  add column if not exists item_id text,
  add column if not exists customer_id text,
  add column if not exists customer_name text;
create index if not exists qbo_lines_deleted_idx on grants.qbo_lines (deleted) where deleted;
create index if not exists qbo_lines_is_expense_idx on grants.qbo_lines (is_expense, txn_date);

alter table grants.qbo_transactions
  add column if not exists payment_type text,
  add column if not exists is_credit boolean not null default false;

-- Where the incremental sync left off, per entity type.
alter table grants.qbo_connection
  add column if not exists initial_load_from date,
  add column if not exists initial_load_to date;

-- Webhook deliveries, kept for audit and replay.
create table if not exists grants.webhook_events (
  id          bigserial primary key,
  received_at timestamptz not null default now(),
  realm_id    text,
  payload     jsonb not null,
  processed_at timestamptz,
  error       text
);
alter table grants.webhook_events enable row level security;
grant select on grants.webhook_events to authenticated;
grant all on grants.webhook_events to service_role;
grant usage, select on all sequences in schema grants to authenticated;
grant all on all sequences in schema grants to service_role;
create policy webhook_events_read on grants.webhook_events for select using (grants.is_member());
create policy webhook_events_admin on grants.webhook_events for all using (grants.is_admin()) with check (grants.is_admin());

-- sync_runs: allow the new kinds.
alter table grants.sync_runs drop constraint if exists sync_runs_kind_check;
alter table grants.sync_runs add constraint sync_runs_kind_check
  check (kind in ('reference','initial','cdc','webhook','manual','payroll_check'));
