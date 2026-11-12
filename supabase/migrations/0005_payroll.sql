-- Bundle 5: payroll periods from uploaded provider reports, employee roster, allocation profiles.

-- Employees are keyed by the payroll provider's employee number (Paycor EE#), not QuickBooks.
alter table grants.employees
  add column if not exists employee_no     text,
  add column if not exists title           text,
  add column if not exists department_code text,       -- most recent department seen on a report
  add column if not exists department_name text,
  add column if not exists pay_type        text,       -- 'hourly' | 'salary' | null
  add column if not exists notes           text,
  add column if not exists last_seen_at    timestamptz;
create unique index if not exists employees_employee_no on grants.employees (employee_no) where employee_no is not null;

-- A period = one pay run from one report.
alter table grants.payroll_periods
  add column if not exists provider      text not null default 'paycor',
  add column if not exists label         text,
  add column if not exists extraction    jsonb,                    -- Claude's read: company totals, warnings, model, cost
  add column if not exists totals        jsonb,                    -- {gross_wages, reimbursements, employer_taxes, net_pay, hours} as extracted (company total page)
  add column if not exists benefits_pool numeric(14,2) not null default 0,  -- employer-paid benefits outside payroll, spread by wages
  add column if not exists benefits_note text,
  add column if not exists gl_note       text,                     -- explanation of GL differences, required to certify when outside tolerance
  add column if not exists notes         text,
  add column if not exists uploaded_by   uuid references public.profiles(id),
  add column if not exists allocated_at  timestamptz;
alter table grants.payroll_periods drop constraint if exists payroll_periods_status_check;
alter table grants.payroll_periods add constraint payroll_periods_status_check
  check (status in ('uploaded','extracted','checked','allocated','certified'));
-- A pay run is identified by its pay date; the same period dates could recur for a correction run.
alter table grants.payroll_periods drop constraint if exists payroll_periods_period_start_period_end_key;
create unique index if not exists payroll_periods_pay_date on grants.payroll_periods (pay_date, provider, coalesce(label, ''));

-- One row per employee per department on the report (an employee can be coded to several).
alter table grants.payroll_period_employees
  add column if not exists department_code text not null default '',
  add column if not exists department_name text,
  add column if not exists rate            numeric(10,4),
  add column if not exists hours_regular   numeric(10,2) not null default 0,
  add column if not exists hours_overtime  numeric(10,2) not null default 0,
  add column if not exists hours_other     numeric(10,2) not null default 0,
  add column if not exists wages_regular   numeric(14,2) not null default 0,
  add column if not exists wages_overtime  numeric(14,2) not null default 0,
  add column if not exists wages_other     numeric(14,2) not null default 0,   -- PTO, sick, retro, bonus
  add column if not exists reimbursements  numeric(14,2) not null default 0,   -- non-taxable, not a wage
  add column if not exists employer_tax_detail jsonb,                           -- {"SOCER": 93.00, ...}
  add column if not exists net_pay         numeric(14,2),
  add column if not exists sort_order      int not null default 0;
alter table grants.payroll_period_employees drop constraint if exists payroll_period_employees_payroll_period_id_employee_id_key;
alter table grants.payroll_period_employees add constraint payroll_period_employees_uniq unique (payroll_period_id, employee_id, department_code);

alter table grants.payroll_allocations
  add column if not exists pct        numeric(7,4),
  add column if not exists profile_id uuid references grants.allocation_profiles(id);
create index if not exists payroll_allocations_pe on grants.payroll_allocations (payroll_period_employee_id);

-- Budget line "spent" now includes certified payroll allocations. Columns are appended, never reordered.
create or replace view grants.budget_line_actuals as
with exp as (
  select a.budget_line_id, sum(a.amount) as amt, count(*) as n
  from grants.allocations a
  join grants.dispositions d on d.id = a.disposition_id
  where d.status = 'approved'
  group by a.budget_line_id
), pay as (
  select pa.budget_line_id,
         coalesce(sum(pa.amount) filter (where pp.status = 'certified'), 0)  as certified,
         coalesce(sum(pa.amount) filter (where pp.status <> 'certified'), 0) as draft
  from grants.payroll_allocations pa
  join grants.payroll_period_employees pe on pe.id = pa.payroll_period_employee_id
  join grants.payroll_periods pp on pp.id = pe.payroll_period_id
  where pa.budget_line_id is not null
  group by pa.budget_line_id
)
select bl.id as budget_line_id, bl.budget_version_id, bv.grant_id,
       coalesce(exp.amt, 0) + coalesce(pay.certified, 0) as allocated,
       coalesce(exp.n, 0)                                  as allocation_count,
       coalesce(exp.amt, 0)                                as expense_allocated,
       coalesce(pay.certified, 0)                          as payroll_allocated,
       coalesce(pay.draft, 0)                              as payroll_draft
from grants.budget_lines bl
join grants.budget_versions bv on bv.id = bl.budget_version_id
left join exp on exp.budget_line_id = bl.id
left join pay on pay.budget_line_id = bl.id;
grant select on grants.budget_line_actuals to authenticated, service_role;
