-- GrantBridge: grant subledger schema. Shares the ilead-ledger Supabase project;
-- everything lives in schema "grants". QuickBooks is read, never written.
--
-- Roles come from public.profiles.role (shared with the ledger app):
--   admin      full access
--   bookkeeper classify expenses, upload payroll, certify allocations
--   viewer     read only
-- After applying: add "grants" to Exposed schemas in Supabase → Settings → API.

create schema if not exists grants;
grant usage on schema grants to authenticated, service_role;

-- ---------------------------------------------------------------- helpers
create or replace function grants.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;
create or replace function grants.is_admin() returns boolean
language sql stable as $$ select grants.my_role() = 'admin' $$;
create or replace function grants.can_classify() returns boolean
language sql stable as $$ select grants.my_role() in ('admin','bookkeeper') $$;
create or replace function grants.is_member() returns boolean
language sql stable as $$ select grants.my_role() is not null $$;

create or replace function grants.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ------------------------------------------------------- QuickBooks sync
create table grants.qbo_connection (
  id                 int primary key default 1 check (id = 1),
  realm_id           text not null,
  environment        text not null check (environment in ('sandbox','production')),
  status             text not null default 'connected' check (status in ('connected','disconnected','error')),
  company_name       text,
  access_token_enc   text,
  refresh_token_enc  text,
  access_expires_at  timestamptz,
  refresh_expires_at timestamptz,
  connected_by       uuid references public.profiles(id),
  connected_at       timestamptz,
  last_cdc_at        timestamptz,
  last_error         text,
  updated_at         timestamptz not null default now()
);
create trigger t_qbo_connection_updated before update on grants.qbo_connection
  for each row execute function grants.set_updated_at();

create table grants.qbo_accounts (
  id                   text primary key,          -- QBO Id
  name                 text not null,
  fully_qualified_name text not null,
  active               boolean not null default true,
  parent_id            text,
  account_type         text not null,
  account_sub_type     text,
  classification       text,                      -- Asset, Liability, Equity, Revenue, Expense
  account_number       text,
  sync_token           text,
  qbo_updated_at       timestamptz,
  raw                  jsonb,
  synced_at            timestamptz not null default now()
);
create index on grants.qbo_accounts (classification, fully_qualified_name);

create table grants.qbo_classes (
  id                   text primary key,
  name                 text not null,
  fully_qualified_name text not null,
  active               boolean not null default true,
  parent_id            text,
  sync_token           text,
  qbo_updated_at       timestamptz,
  raw                  jsonb,
  synced_at            timestamptz not null default now()
);

create table grants.qbo_vendors (
  id             text primary key,
  display_name   text not null,
  active         boolean not null default true,
  sync_token     text,
  qbo_updated_at timestamptz,
  raw            jsonb,
  synced_at      timestamptz not null default now()
);

create table grants.qbo_employees (
  id             text primary key,
  display_name   text not null,
  active         boolean not null default true,
  sync_token     text,
  qbo_updated_at timestamptz,
  raw            jsonb,
  synced_at      timestamptz not null default now()
);

-- Expenditure transactions: Purchase, Bill, JournalEntry, VendorCredit, CreditCardCredit, ...
create table grants.qbo_transactions (
  id              text not null,                  -- QBO Id (unique per txn_type)
  txn_type        text not null,
  txn_date        date not null,
  doc_number      text,
  entity_type     text,                           -- Vendor / Customer / Employee
  entity_id       text,
  entity_name     text,
  total_amount    numeric(14,2),
  private_note    text,
  sync_token      text,
  qbo_updated_at  timestamptz,
  raw             jsonb not null,
  deleted         boolean not null default false,
  synced_at       timestamptz not null default now(),
  primary key (txn_type, id)
);
create index on grants.qbo_transactions (txn_date);

-- One row per expense-side line. Identity: txn_type + txn_id + line_id.
create table grants.qbo_lines (
  id              uuid primary key default gen_random_uuid(),
  txn_type        text not null,
  txn_id          text not null,
  line_id         text not null,
  line_num        int,
  txn_date        date not null,
  account_id      text references grants.qbo_accounts(id),
  class_id        text references grants.qbo_classes(id),
  entity_type     text,
  entity_id       text,
  entity_name     text,
  description     text,
  amount          numeric(14,2) not null,         -- signed: positive = expense/debit
  posting_type    text,                           -- Debit / Credit for journal lines
  content_hash    text not null,                  -- change detection
  deleted         boolean not null default false,
  first_seen_at   timestamptz not null default now(),
  last_changed_at timestamptz not null default now(),
  unique (txn_type, txn_id, line_id),
  foreign key (txn_type, txn_id) references grants.qbo_transactions(txn_type, id) on delete cascade
);
create index on grants.qbo_lines (txn_date);
create index on grants.qbo_lines (account_id);

create table grants.sync_runs (
  id          bigserial primary key,
  kind        text not null check (kind in ('reference','initial','cdc','webhook','manual','payroll_check')),
  status      text not null default 'running' check (status in ('running','ok','error')),
  started_by  uuid references public.profiles(id),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  stats       jsonb,
  error       text
);

-- A synced line changed or vanished after the app classified or reported it.
create table grants.sync_flags (
  id          bigserial primary key,
  line_id     uuid not null references grants.qbo_lines(id) on delete cascade,
  kind        text not null check (kind in ('changed_after_classification','changed_after_report','deleted_after_classification','deleted_after_report')),
  detail      jsonb,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolution  text
);
create index on grants.sync_flags (resolved_at) where resolved_at is null;

-- ---------------------------------------------------------------- grants
create table grants.funders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  short_name  text,
  contact     jsonb,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger t_funders_updated before update on grants.funders for each row execute function grants.set_updated_at();

create table grants.grants (
  id                 uuid primary key default gen_random_uuid(),
  funder_id          uuid not null references grants.funders(id),
  name               text not null,
  program            text,
  award_number       text,
  status             text not null default 'prospect' check (status in ('prospect','proposed','awarded','active','closed')),
  funding_type       text not null default 'reimbursement' check (funding_type in ('reimbursement','advance','hybrid')),
  award_amount       numeric(14,2),
  cost_period_start  date,
  cost_period_end    date,
  indirect_rule      jsonb not null default '{"type":"none"}',   -- {"type":"none"} | {"type":"rate","rate":0.10,"base":"mtdc"}
  match_rule         jsonb not null default '{"type":"none"}',
  reporting          jsonb not null default '[]',                -- [{"kind":"final_report","due":"2029-03-01"}, {"kind":"interim_report","every":"09-30"}]
  funds_received     numeric(14,2) not null default 0,
  qbo_class_id       text references grants.qbo_classes(id),    -- hint only
  notes              text,
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger t_grants_updated before update on grants.grants for each row execute function grants.set_updated_at();
create index on grants.grants (status);

create table grants.documents (
  id            uuid primary key default gen_random_uuid(),
  funder_id     uuid references grants.funders(id),
  grant_id      uuid references grants.grants(id) on delete cascade,
  kind          text not null check (kind in ('budget_instructions','application','agreement','approved_budget','invoicing_instructions','report_template','house_notes','payroll_report','other')),
  title         text not null,
  storage_path  text,                  -- Supabase Storage object path (bucket: grant-documents)
  mime_type     text,
  extracted     jsonb,                 -- Claude's structured read, when applicable
  uploaded_by   uuid references public.profiles(id),
  uploaded_at   timestamptz not null default now()
);
create index on grants.documents (grant_id);

create table grants.budget_versions (
  id                 uuid primary key default gen_random_uuid(),
  grant_id           uuid not null references grants.grants(id) on delete cascade,
  kind               text not null check (kind in ('proposed','approved','amended')),
  version_no         int not null default 1,
  effective_date     date,
  total              numeric(14,2),
  source_document_id uuid references grants.documents(id),
  is_current         boolean not null default false,
  approved_by        uuid references public.profiles(id),
  approved_at        timestamptz,
  notes              text,
  created_at         timestamptz not null default now(),
  unique (grant_id, kind, version_no)
);
create unique index budget_versions_one_current on grants.budget_versions (grant_id) where is_current;

create table grants.budget_lines (
  id                uuid primary key default gen_random_uuid(),
  budget_version_id uuid not null references grants.budget_versions(id) on delete cascade,
  sort_order        int not null default 0,
  category          text not null,               -- funder's category (Salaries, Fringes, Travel, ...)
  description       text,
  amount            numeric(14,2) not null default 0,
  period_start      date,
  period_end        date,
  allowable         boolean not null default true,
  cap_rule          jsonb,                        -- {"max_pct_of_total":0.10} etc.
  report_row        text,                         -- row key on the funder's report template
  planned_curve     jsonb,                        -- {"2026Q3":12000,"2026Q4":...}
  detail            jsonb                         -- e.g. personnel: [{"employee":"...","pct":0.59}]
);
create index on grants.budget_lines (budget_version_id);

-- Which QBO accounts feed a budget line (many-to-many).
create table grants.budget_line_accounts (
  budget_line_id uuid not null references grants.budget_lines(id) on delete cascade,
  account_id     text not null references grants.qbo_accounts(id),
  primary key (budget_line_id, account_id)
);

-- ------------------------------------------------------- classification
-- Every synced expense line gets exactly one disposition.
create table grants.dispositions (
  id           uuid primary key default gen_random_uuid(),
  line_id      uuid not null unique references grants.qbo_lines(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','approved','needs_review')),
  kind         text check (kind in ('grant','unrestricted','excluded','payroll')),
  suggestion   jsonb,                 -- {"kind":"grant","allocations":[{"grant_id":..,"budget_line_id":..,"amount":..}],"confidence":0.92,"rationale":"..."}
  suggested_at timestamptz,
  decided_by   uuid references public.profiles(id),
  decided_at   timestamptz,
  note         text,
  updated_at   timestamptz not null default now()
);
create trigger t_dispositions_updated before update on grants.dispositions for each row execute function grants.set_updated_at();
create index on grants.dispositions (status);

-- Approved split of a line across grants (absent for unrestricted/excluded).
create table grants.allocations (
  id             uuid primary key default gen_random_uuid(),
  disposition_id uuid not null references grants.dispositions(id) on delete cascade,
  grant_id       uuid not null references grants.grants(id),
  budget_line_id uuid references grants.budget_lines(id),
  amount         numeric(14,2) not null,
  created_at     timestamptz not null default now()
);
create index on grants.allocations (grant_id);
create index on grants.allocations (budget_line_id);

-- ---------------------------------------------------------------- payroll
create table grants.employees (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  qbo_employee_id text references grants.qbo_employees(id),
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- Fixed-percentage allocation profiles, certified periodically.
create table grants.allocation_profiles (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references grants.employees(id) on delete cascade,
  effective_from date not null,
  effective_to   date,
  splits         jsonb not null,       -- [{"grant_id": uuid|null, "budget_line_id": uuid|null, "pct": 0.59}]  null grant = unrestricted
  basis          text,                 -- "effort certification 2026-07", "timesheets", ...
  certified_by   uuid references public.profiles(id),
  certified_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index on grants.allocation_profiles (employee_id, effective_from);

create table grants.payroll_periods (
  id           uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end   date not null,
  pay_date     date,
  source       text not null default 'report_upload' check (source in ('report_upload','qbo_payroll_api')),
  document_id  uuid references grants.documents(id),
  status       text not null default 'uploaded' check (status in ('uploaded','extracted','checked','certified')),
  gl_check     jsonb,                 -- {"report_total":..,"gl_total":..,"difference":..,"accounts":[...]}
  certified_by uuid references public.profiles(id),
  certified_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (period_start, period_end)
);

create table grants.payroll_period_employees (
  id                uuid primary key default gen_random_uuid(),
  payroll_period_id uuid not null references grants.payroll_periods(id) on delete cascade,
  employee_id       uuid not null references grants.employees(id),
  gross_wages       numeric(14,2) not null default 0,
  employer_taxes    numeric(14,2) not null default 0,
  benefits          numeric(14,2) not null default 0,
  other             numeric(14,2) not null default 0,
  raw               jsonb,
  unique (payroll_period_id, employee_id)
);

create table grants.payroll_allocations (
  id                         uuid primary key default gen_random_uuid(),
  payroll_period_employee_id uuid not null references grants.payroll_period_employees(id) on delete cascade,
  grant_id                   uuid references grants.grants(id),      -- null = unrestricted
  budget_line_id             uuid references grants.budget_lines(id),
  component                  text not null check (component in ('wages','fringe')),
  amount                     numeric(14,2) not null,
  source_line_ids            uuid[],                                  -- synced payroll GL lines this ties to
  created_at                 timestamptz not null default now()
);
create index on grants.payroll_allocations (grant_id);

-- ------------------------------------------------------------ submissions
-- A funder submission: reimbursement invoice, interim report, or final report.
create table grants.submissions (
  id            uuid primary key default gen_random_uuid(),
  grant_id      uuid not null references grants.grants(id),
  kind          text not null check (kind in ('invoice','interim_report','final_report')),
  period_start  date,
  period_end    date,
  status        text not null default 'draft' check (status in ('draft','review','approved','sent','paid','closed','void')),
  template_document_id uuid references grants.documents(id),
  draft         jsonb,                -- Claude's structured draft + flags
  package_paths text[],               -- generated files in Storage
  amount        numeric(14,2),
  approved_by   uuid references public.profiles(id),
  approved_at   timestamptz,
  sent_at       timestamptz,
  paid_at       timestamptz,
  notes         text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger t_submissions_updated before update on grants.submissions for each row execute function grants.set_updated_at();
create index on grants.submissions (grant_id, status);

-- The reported ledger: a source can appear on at most one non-void submission.
create table grants.submission_lines (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references grants.submissions(id) on delete cascade,
  budget_line_id uuid references grants.budget_lines(id),
  source_kind    text not null check (source_kind in ('allocation','payroll_allocation')),
  source_id      uuid not null,
  amount         numeric(14,2) not null,
  unique (source_kind, source_id)
);
create index on grants.submission_lines (submission_id);

-- ------------------------------------------------------------------ audit
create table grants.audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  user_id    uuid,
  action     text not null,
  entity     text not null,
  entity_id  text,
  before     jsonb,
  after      jsonb
);
create index on grants.audit_log (entity, entity_id);

create table grants.ai_calls (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  task          text not null,          -- extract_budget | map_lines | classify | draft_submission | extract_payroll | allocate_payroll
  model         text not null,
  input_tokens  int,
  output_tokens int,
  cost_usd      numeric(10,4),
  status        text not null default 'ok',
  entity        text,
  entity_id     text,
  request_ref   text,                  -- Storage path of the prompt/inputs
  response      jsonb,
  user_id       uuid
);

-- ------------------------------------------------------------------- RLS
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'grants' loop
    execute format('alter table grants.%I enable row level security', t);
    execute format('grant select on grants.%I to authenticated', t);
    execute format('grant all on grants.%I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema grants to authenticated;
grant all on all sequences in schema grants to service_role;

-- Members read everything except the token row.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'grants' and tablename <> 'qbo_connection' loop
    execute format('create policy %I_read on grants.%I for select using (grants.is_member())', t, t);
  end loop;
end $$;
create policy qbo_connection_admin_read on grants.qbo_connection for select
  using (grants.is_admin());
-- (token columns are only ever read by the service role in server code)

-- Admin writes on everything.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'grants' loop
    execute format('grant insert, update, delete on grants.%I to authenticated', t);
    execute format('create policy %I_admin_write on grants.%I for all using (grants.is_admin()) with check (grants.is_admin())', t, t);
  end loop;
end $$;

-- Bookkeeper writes: classification, payroll, flag resolution, payroll-report documents.
create policy dispositions_bk on grants.dispositions for all using (grants.can_classify()) with check (grants.can_classify());
create policy allocations_bk on grants.allocations for all using (grants.can_classify()) with check (grants.can_classify());
create policy employees_bk on grants.employees for all using (grants.can_classify()) with check (grants.can_classify());
create policy allocation_profiles_bk on grants.allocation_profiles for all using (grants.can_classify()) with check (grants.can_classify());
create policy payroll_periods_bk on grants.payroll_periods for all using (grants.can_classify()) with check (grants.can_classify());
create policy payroll_period_employees_bk on grants.payroll_period_employees for all using (grants.can_classify()) with check (grants.can_classify());
create policy payroll_allocations_bk on grants.payroll_allocations for all using (grants.can_classify()) with check (grants.can_classify());
create policy sync_flags_bk on grants.sync_flags for update using (grants.can_classify()) with check (grants.can_classify());
create policy documents_bk_payroll on grants.documents for insert with check (grants.can_classify() and kind = 'payroll_report');

-- ---------------------------------------------------------- storage bucket
insert into storage.buckets (id, name, public) values ('grant-documents', 'grant-documents', false)
  on conflict (id) do nothing;
create policy grant_docs_read on storage.objects for select
  using (bucket_id = 'grant-documents' and grants.is_member());
create policy grant_docs_write on storage.objects for insert
  with check (bucket_id = 'grant-documents' and grants.can_classify());
create policy grant_docs_admin on storage.objects for all
  using (bucket_id = 'grant-documents' and grants.is_admin())
  with check (bucket_id = 'grant-documents' and grants.is_admin());
