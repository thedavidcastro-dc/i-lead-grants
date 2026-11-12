import { createAdminClient } from "@/lib/supabase/admin";

/** Payroll module data access (service role; callers check the user's role first). */

export type PayrollPeriod = {
  id: string; period_start: string; period_end: string; pay_date: string | null; provider: string; label: string | null;
  source: string; document_id: string | null; status: "uploaded" | "extracted" | "checked" | "allocated" | "certified";
  extraction: Record<string, unknown> | null; totals: PeriodTotals | null; gl_check: GlCheck | null; gl_note: string | null;
  benefits_pool: number; benefits_note: string | null; notes: string | null;
  certified_by: string | null; certified_at: string | null; allocated_at: string | null; uploaded_by: string | null; created_at: string;
};
export type PeriodTotals = { gross_wages?: number | null; reimbursements?: number | null; employer_taxes?: number | null; net_pay?: number | null; hours?: number | null; employer_tax_detail?: Record<string, number> | null };
export type GlCheck = {
  ran_at: string; window: { from: string; to: string };
  components: Array<{ name: "wages" | "taxes" | "benefits"; report: number; gl: number; difference: number; ok: boolean }>;
  lines: Array<{ id: string; txn_type: string; txn_id: string; txn_date: string; account_name: string; amount: number; component: string }>;
  ok: boolean;
};
export type PeriodEmployee = {
  id: string; payroll_period_id: string; employee_id: string; department_code: string; department_name: string | null; rate: number | null;
  hours_regular: number; hours_overtime: number; hours_other: number; wages_regular: number; wages_overtime: number; wages_other: number;
  gross_wages: number; reimbursements: number; employer_taxes: number; employer_tax_detail: Record<string, number> | null; benefits: number; other: number; net_pay: number | null; sort_order: number;
  employee: Employee;
  allocations: PayrollAllocation[];
};
export type PayrollAllocation = { id: string; grant_id: string | null; budget_line_id: string | null; component: "wages" | "fringe"; amount: number; pct: number | null; profile_id: string | null };
export type Employee = {
  id: string; name: string; employee_no: string | null; title: string | null; department_code: string | null; department_name: string | null;
  pay_type: string | null; active: boolean; notes: string | null; last_seen_at: string | null; qbo_employee_id: string | null;
};
export type Split = { grant_id: string | null; budget_line_id: string | null; fringe_line_id?: string | null; pct: number };
export type AllocationProfile = {
  id: string; employee_id: string; effective_from: string; effective_to: string | null; splits: Split[]; basis: string | null;
  certified_by: string | null; certified_at: string | null; created_at: string;
};

const g = () => createAdminClient().schema("grants");

export async function listPeriods(): Promise<Array<PayrollPeriod & { employees: number; wages: number; employer_taxes: number; to_grants: number }>> {
  const { data: periods } = await g().from("payroll_periods").select("*").order("pay_date", { ascending: false, nullsFirst: false }).order("period_end", { ascending: false });
  if (!periods?.length) return [];
  const ids = periods.map((p) => p.id);
  const { data: rows } = await g().from("payroll_period_employees").select("payroll_period_id, employee_id, gross_wages, employer_taxes, payroll_allocations(grant_id, amount)").in("payroll_period_id", ids);
  const agg = new Map<string, { emp: Set<string>; wages: number; taxes: number; grants: number }>();
  for (const r of rows ?? []) {
    const a = agg.get(r.payroll_period_id) ?? { emp: new Set(), wages: 0, taxes: 0, grants: 0 };
    a.emp.add(r.employee_id); a.wages += Number(r.gross_wages); a.taxes += Number(r.employer_taxes);
    for (const al of (r.payroll_allocations as Array<{ grant_id: string | null; amount: number }>) ?? []) if (al.grant_id) a.grants += Number(al.amount);
    agg.set(r.payroll_period_id, a);
  }
  return periods.map((p) => {
    const a = agg.get(p.id);
    return { ...(p as PayrollPeriod), benefits_pool: Number(p.benefits_pool), employees: a?.emp.size ?? 0, wages: a?.wages ?? 0, employer_taxes: a?.taxes ?? 0, to_grants: a?.grants ?? 0 };
  });
}

export async function getPeriod(id: string): Promise<{ period: PayrollPeriod; rows: PeriodEmployee[] } | null> {
  const { data: p } = await g().from("payroll_periods").select("*").eq("id", id).maybeSingle();
  if (!p) return null;
  const { data: rows } = await g().from("payroll_period_employees")
    .select("*, employee:employees(*), payroll_allocations(id, grant_id, budget_line_id, component, amount, pct, profile_id)")
    .eq("payroll_period_id", id).order("sort_order");
  const out = (rows ?? []).map((r) => {
    const { payroll_allocations, employee, ...rest } = r as Record<string, unknown>;
    const n = (k: string) => Number(rest[k] ?? 0);
    return {
      ...(rest as Omit<PeriodEmployee, "employee" | "allocations">),
      rate: rest.rate == null ? null : Number(rest.rate),
      hours_regular: n("hours_regular"), hours_overtime: n("hours_overtime"), hours_other: n("hours_other"),
      wages_regular: n("wages_regular"), wages_overtime: n("wages_overtime"), wages_other: n("wages_other"),
      gross_wages: n("gross_wages"), reimbursements: n("reimbursements"), employer_taxes: n("employer_taxes"), benefits: n("benefits"), other: n("other"),
      net_pay: rest.net_pay == null ? null : Number(rest.net_pay),
      employee: employee as Employee,
      allocations: ((payroll_allocations as PayrollAllocation[]) ?? []).map((a) => ({ ...a, amount: Number(a.amount), pct: a.pct == null ? null : Number(a.pct) })),
    } satisfies PeriodEmployee;
  });
  return { period: { ...(p as PayrollPeriod), benefits_pool: Number(p.benefits_pool) }, rows: out };
}

export async function listEmployees(): Promise<Array<Employee & { profile: AllocationProfile | null }>> {
  const [{ data: emps }, { data: profiles }] = await Promise.all([
    g().from("employees").select("*").order("active", { ascending: false }).order("name"),
    g().from("allocation_profiles").select("*").order("effective_from", { ascending: false }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const current = new Map<string, AllocationProfile>();
  for (const p of (profiles ?? []) as AllocationProfile[]) {
    if (current.has(p.employee_id)) continue;
    if (p.effective_from <= today && (!p.effective_to || p.effective_to >= today)) current.set(p.employee_id, p);
  }
  return ((emps ?? []) as Employee[]).map((e) => ({ ...e, profile: current.get(e.id) ?? null }));
}

export async function getEmployee(id: string): Promise<{ employee: Employee; profiles: AllocationProfile[]; history: Array<{ pay_date: string | null; period_id: string; department_name: string | null; gross_wages: number; employer_taxes: number; to_grants: number }> } | null> {
  const { data: e } = await g().from("employees").select("*").eq("id", id).maybeSingle();
  if (!e) return null;
  const [{ data: profiles }, { data: rows }] = await Promise.all([
    g().from("allocation_profiles").select("*").eq("employee_id", id).order("effective_from", { ascending: false }),
    g().from("payroll_period_employees").select("department_name, gross_wages, employer_taxes, payroll_periods(id, pay_date), payroll_allocations(grant_id, amount)").eq("employee_id", id).limit(60),
  ]);
  const history = (rows ?? []).map((r) => {
    const pp = r.payroll_periods as unknown as { id: string; pay_date: string | null } | null;
    return {
      pay_date: pp?.pay_date ?? null, period_id: pp?.id ?? "", department_name: r.department_name, gross_wages: Number(r.gross_wages), employer_taxes: Number(r.employer_taxes),
      to_grants: ((r.payroll_allocations as Array<{ grant_id: string | null; amount: number }>) ?? []).filter((a) => a.grant_id).reduce((s, a) => s + Number(a.amount), 0),
    };
  }).sort((a, b) => (b.pay_date ?? "").localeCompare(a.pay_date ?? ""));
  return { employee: e as Employee, profiles: (profiles ?? []) as AllocationProfile[], history };
}

/** Profile in force on a date (effective_from <= date, effective_to null or >= date); latest wins. */
export function profileOn(profiles: AllocationProfile[], date: string): AllocationProfile | null {
  const live = profiles.filter((p) => p.effective_from <= date && (!p.effective_to || p.effective_to >= date));
  live.sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.created_at.localeCompare(a.created_at));
  return live[0] ?? null;
}

/** Active grants with current budget lines, for profile editors and allocation labels. */
export async function grantLineOptions(): Promise<Array<{ grant_id: string; grant_name: string; line_id: string; category: string; amount: number; cost_period_start: string | null; cost_period_end: string | null }>> {
  const { data: grants } = await g().from("grants").select("id, name, cost_period_start, cost_period_end").in("status", ["awarded", "active"]).order("name");
  if (!grants?.length) return [];
  const { data: versions } = await g().from("budget_versions").select("id, grant_id").eq("is_current", true).in("grant_id", grants.map((x) => x.id));
  const vIds = (versions ?? []).map((v) => v.id);
  const { data: lines } = vIds.length ? await g().from("budget_lines").select("id, budget_version_id, category, amount").in("budget_version_id", vIds).order("sort_order") : { data: [] };
  const vByGrant = new Map((versions ?? []).map((v) => [v.grant_id, v.id]));
  const out = [];
  for (const gr of grants) {
    const vId = vByGrant.get(gr.id);
    for (const l of (lines ?? []).filter((l) => l.budget_version_id === vId)) {
      out.push({ grant_id: gr.id, grant_name: gr.name, line_id: l.id, category: l.category, amount: Number(l.amount), cost_period_start: gr.cost_period_start, cost_period_end: gr.cost_period_end });
    }
  }
  return out;
}

/** Payroll expense accounts grouped by component for the GL check. */
export async function payrollAccountGroups(): Promise<{ wages: Set<string>; taxes: Set<string>; benefits: Set<string>; names: Map<string, string> }> {
  const { data: setting } = await g().from("settings").select("value").eq("key", "payroll_account_ids").maybeSingle();
  const ids = new Set(Array.isArray(setting?.value) ? (setting!.value as string[]) : []);
  const { data: accts } = await g().from("qbo_accounts").select("id, name, fully_qualified_name").eq("classification", "Expense");
  const wages = new Set<string>(), taxes = new Set<string>(), benefits = new Set<string>(), names = new Map<string, string>();
  for (const a of accts ?? []) {
    if (!ids.has(a.id)) continue;
    names.set(a.id, a.name);
    const n = a.fully_qualified_name;
    if (/payroll tax|unemployment/i.test(n)) taxes.add(a.id);
    else if (/salar|wage/i.test(n)) wages.add(a.id);
    else benefits.add(a.id);
  }
  return { wages, taxes, benefits, names };
}

export const money = (n: number | null | undefined) => n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
export const pct = (n: number | null | undefined) => n == null ? "—" : `${(n * 100).toFixed(n * 100 % 1 === 0 ? 0 : 2)}%`;
export const fmtDate = (d: string | null | undefined) => d ? new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—";
