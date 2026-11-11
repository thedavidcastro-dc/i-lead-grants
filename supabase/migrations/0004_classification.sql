-- Bundle 4: classification queue.
create table if not exists grants.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table grants.settings enable row level security;
grant select on grants.settings to authenticated;
grant all on grants.settings to service_role;
create policy settings_read on grants.settings for select using (grants.is_member());
create policy settings_admin on grants.settings for all using (grants.is_admin()) with check (grants.is_admin());

-- Which line produced a disposition's suggestion batch, and when it was last touched by sync.
alter table grants.dispositions
  add column if not exists auto boolean not null default false,     -- set by a rule (payroll routing), not a person or the model
  add column if not exists txn_date date;                            -- denormalized for queue ordering
create index if not exists dispositions_status_date on grants.dispositions (status, txn_date);

-- Budget line "spent" is the sum of approved allocations; a view keeps that in one place.
create or replace view grants.budget_line_actuals as
select bl.id as budget_line_id, bl.budget_version_id, bv.grant_id,
       coalesce(sum(a.amount) filter (where d.status = 'approved'), 0) as allocated,
       count(a.id) filter (where d.status = 'approved') as allocation_count
from grants.budget_lines bl
join grants.budget_versions bv on bv.id = bl.budget_version_id
left join grants.allocations a on a.budget_line_id = bl.id
left join grants.dispositions d on d.id = a.disposition_id
group by bl.id, bl.budget_version_id, bv.grant_id;
grant select on grants.budget_line_actuals to authenticated, service_role;
