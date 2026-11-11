-- Bundle 3: grant onboarding, documents, budget drafts, mapping suggestions.
alter table grants.budget_versions
  add column if not exists status text not null default 'draft' check (status in ('draft','approved','superseded')),
  add column if not exists extraction jsonb;             -- the raw extracted budget (warnings, header fields) for the review screen

alter table grants.budget_lines
  add column if not exists suggested_accounts jsonb;     -- [{"account_id":..,"confidence":..,"rationale":..}] from the mapping proposal

alter table grants.documents
  add column if not exists text_content text,            -- converted text for non-PDF documents (search, re-use)
  add column if not exists size_bytes bigint;

alter table grants.funders
  add column if not exists contact_name text,
  add column if not exists contact_email text;

-- A grant's "current" budget is the approved version flagged is_current (one per grant).
-- Drafts never carry is_current. Enforced in application code; the partial unique index already limits to one.
