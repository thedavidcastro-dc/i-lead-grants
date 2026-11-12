import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Classification data access (service role; callers check the user's role first).
 */

export type GrantContext = {
  id: string; name: string; program: string | null; funder: string; class_id: string | null; class_name: string | null;
  cost_period_start: string | null; cost_period_end: string | null;
  lines: Array<{ id: string; category: string; description: string | null; amount: number; allowable: boolean; allocated: number; account_ids: string[] }>;
};

const PAYROLL_NAME_RE = /salar|wage|payroll tax|employee benefit|qsehra|disability|workers comp|403\(b\)|medical insurance|health insurance|unemployment/i;

/** Expense account ids treated as payroll (routed to workflow 4). Seeded by name on first use; editable in settings later. */
export async function payrollAccountIds(): Promise<Set<string>> {
  const g = createAdminClient().schema("grants");
  const { data: setting } = await g.from("settings").select("value").eq("key", "payroll_account_ids").maybeSingle();
  if (setting?.value && Array.isArray(setting.value)) return new Set(setting.value as string[]);
  const { data: accts } = await g.from("qbo_accounts").select("id, name, fully_qualified_name").eq("classification", "Expense");
  const ids = (accts ?? []).filter((a) => PAYROLL_NAME_RE.test(a.fully_qualified_name)).map((a) => a.id);
  await g.from("settings").upsert({ key: "payroll_account_ids", value: ids }, { onConflict: "key" });
  return new Set(ids);
}

/**
 * Make sure every live expense line has a disposition. Lines on payroll accounts are
 * routed automatically (kind = payroll, approved, auto = true); everything else starts pending.
 */
export async function ensureDispositions(): Promise<{ created: number; payroll: number }> {
  const g = createAdminClient().schema("grants");
  const payroll = await payrollAccountIds();
  // Page through both tables explicitly: the embedded one-to-one join returned an object,
  // not an array, and the API caps a single select at 1,000 rows.
  const lines: Array<{ id: string; txn_type: string; txn_date: string; account_id: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await g.from("qbo_lines").select("id, txn_type, txn_date, account_id")
      .eq("deleted", false).eq("is_expense", true).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    lines.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const existing = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await g.from("dispositions").select("line_id").order("line_id").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const d of data ?? []) existing.add(d.line_id);
    if (!data || data.length < 1000) break;
  }
  const missing = lines.filter((l) => !existing.has(l.id));
  let payrollCount = 0;
  const rows = missing.map((l) => {
    // Payroll is recognised by account, whatever the transaction type: I-LEAD's payroll
    // provider posts wages and taxes as bank-feed purchases as well as journal entries.
    const isPayroll = l.account_id != null && payroll.has(l.account_id);
    if (isPayroll) payrollCount++;
    return isPayroll
      ? { line_id: l.id, txn_date: l.txn_date, status: "approved", kind: "payroll", auto: true, decided_at: new Date().toISOString(), note: "Payroll entry — allocated through the payroll module" }
      : { line_id: l.id, txn_date: l.txn_date, status: "pending", auto: false, kind: null, decided_at: null, note: null };
  });
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await g.from("dispositions").upsert(rows.slice(i, i + 500), { onConflict: "line_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  return { created: rows.length, payroll: payrollCount };
}

/** Active grants with their current budget lines, mapped accounts and allocated-to-date. */
export async function grantContexts(): Promise<GrantContext[]> {
  const g = createAdminClient().schema("grants");
  const { data: grants } = await g
    .from("grants")
    .select("id, name, program, cost_period_start, cost_period_end, qbo_class_id, funders(name), qbo_classes(name)")
    .in("status", ["awarded", "active"]);
  if (!grants?.length) return [];
  const { data: versions } = await g.from("budget_versions").select("id, grant_id").eq("is_current", true).in("grant_id", grants.map((x) => x.id));
  const vIds = (versions ?? []).map((v) => v.id);
  const { data: lines } = vIds.length ? await g.from("budget_lines").select("id, budget_version_id, category, description, amount, allowable").in("budget_version_id", vIds).order("sort_order") : { data: [] };
  const lineIds = (lines ?? []).map((l) => l.id);
  const [{ data: maps }, { data: actuals }] = await Promise.all([
    lineIds.length ? g.from("budget_line_accounts").select("budget_line_id, account_id").in("budget_line_id", lineIds) : Promise.resolve({ data: [] as Array<{ budget_line_id: string; account_id: string }> }),
    lineIds.length ? g.from("budget_line_actuals").select("budget_line_id, allocated").in("budget_line_id", lineIds) : Promise.resolve({ data: [] as Array<{ budget_line_id: string; allocated: number }> }),
  ]);
  const mapBy = new Map<string, string[]>();
  for (const m of maps ?? []) mapBy.set(m.budget_line_id, [...(mapBy.get(m.budget_line_id) ?? []), m.account_id]);
  const actBy = new Map((actuals ?? []).map((a) => [a.budget_line_id, Number(a.allocated)]));
  const vByGrant = new Map((versions ?? []).map((v) => [v.grant_id, v.id]));

  return grants.map((gr) => {
    const vId = vByGrant.get(gr.id);
    const f = gr.funders as unknown as { name: string } | null;
    const c = gr.qbo_classes as unknown as { name: string } | null;
    return {
      id: gr.id, name: gr.name, program: gr.program, funder: f?.name ?? "", class_id: gr.qbo_class_id, class_name: c?.name ?? null,
      cost_period_start: gr.cost_period_start, cost_period_end: gr.cost_period_end,
      lines: (lines ?? []).filter((l) => l.budget_version_id === vId).map((l) => ({
        id: l.id, category: l.category, description: l.description, amount: Number(l.amount), allowable: l.allowable,
        allocated: actBy.get(l.id) ?? 0, account_ids: mapBy.get(l.id) ?? [],
      })),
    };
  });
}

export type QueueLine = {
  disposition_id: string; status: string; kind: string | null; suggestion: Suggestion | null; note: string | null;
  line_id: string; txn_type: string; txn_id: string; txn_date: string; amount: number; description: string | null;
  entity_name: string | null; entity_id: string | null; account_id: string | null; account_name: string | null; class_id: string | null; class_name: string | null;
  allocations: Array<{ grant_id: string; budget_line_id: string | null; amount: number }>;
  flags: Array<{ kind: string; detected_at: string }>;
};
export type Suggestion = {
  kind: "grant" | "unrestricted" | "excluded";
  allocations: Array<{ grant_id: string; budget_line_id: string | null; amount: number }>;
  confidence: number; rationale: string; model?: string;
};

/** Lines for the queue page. */
export async function queueLines(status: "pending" | "needs_review" | "approved", opts: { month?: string; grantId?: string; limit?: number } = {}): Promise<QueueLine[]> {
  const g = createAdminClient().schema("grants");
  let q = g.from("dispositions")
    .select("id, status, kind, suggestion, note, txn_date, qbo_lines!inner(id, txn_type, txn_id, txn_date, amount, description, entity_name, entity_id, account_id, class_id, deleted), allocations(grant_id, budget_line_id, amount)")
    .eq("status", status).eq("auto", false).eq("qbo_lines.deleted", false)
    .order("txn_date", { ascending: false }).limit(opts.limit ?? 400);
  if (opts.month) q = q.gte("txn_date", `${opts.month}-01`).lt("txn_date", nextMonth(opts.month));
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const lineIds = rows.map((r) => (r.qbo_lines as { id: string }).id);
  const [{ data: accts }, { data: classes }, { data: flags }] = await Promise.all([
    g.from("qbo_accounts").select("id, name"), g.from("qbo_classes").select("id, name"),
    lineIds.length ? g.from("sync_flags").select("line_id, kind, detected_at").in("line_id", lineIds).is("resolved_at", null) : Promise.resolve({ data: [] as Array<{ line_id: string; kind: string; detected_at: string }> }),
  ]);
  const an = new Map((accts ?? []).map((a) => [a.id, a.name])), cn = new Map((classes ?? []).map((c) => [c.id, c.name]));
  const fl = new Map<string, Array<{ kind: string; detected_at: string }>>();
  for (const f of flags ?? []) fl.set(f.line_id, [...(fl.get(f.line_id) ?? []), { kind: f.kind, detected_at: f.detected_at }]);
  let out = rows.map((r) => {
    const l = r.qbo_lines as { id: string; txn_type: string; txn_id: string; txn_date: string; amount: number; description: string | null; entity_name: string | null; entity_id: string | null; account_id: string | null; class_id: string | null };
    return {
      disposition_id: r.id as string, status: r.status as string, kind: (r.kind as string | null), suggestion: (r.suggestion as Suggestion | null), note: r.note as string | null,
      line_id: l.id, txn_type: l.txn_type, txn_id: l.txn_id, txn_date: l.txn_date, amount: Number(l.amount), description: l.description,
      entity_name: l.entity_name, entity_id: l.entity_id, account_id: l.account_id, account_name: l.account_id ? an.get(l.account_id) ?? null : null,
      class_id: l.class_id, class_name: l.class_id ? cn.get(l.class_id) ?? null : null,
      allocations: ((r.allocations as Array<{ grant_id: string; budget_line_id: string | null; amount: number }>) ?? []).map((a) => ({ ...a, amount: Number(a.amount) })),
      flags: fl.get(l.id) ?? [],
    } satisfies QueueLine;
  });
  if (opts.grantId) out = out.filter((r) => r.allocations.some((a) => a.grant_id === opts.grantId) || r.suggestion?.allocations?.some((a) => a.grant_id === opts.grantId));
  return out;
}

/** Vendor history: the most recent approved decisions for the same payee or account, to inform suggestions. */
export async function vendorHistory(entityIds: string[], accountIds: string[]) {
  const g = createAdminClient().schema("grants");
  const { data } = await g.from("dispositions")
    .select("kind, qbo_lines!inner(entity_id, entity_name, account_id, description), allocations(grant_id, budget_line_id)")
    .eq("status", "approved").eq("auto", false)
    .or(`entity_id.in.(${entityIds.filter(Boolean).join(",") || "null"}),account_id.in.(${accountIds.filter(Boolean).join(",") || "null"})`, { foreignTable: "qbo_lines" })
    .order("decided_at", { ascending: false }).limit(200);
  return (data ?? []) as unknown as Array<{ kind: string; qbo_lines: { entity_id: string | null; entity_name: string | null; account_id: string | null; description: string | null }; allocations: Array<{ grant_id: string; budget_line_id: string | null }> }>;
}

export async function counts() {
  const g = createAdminClient().schema("grants");
  const c = async (status: string) => (await g.from("dispositions").select("id", { count: "exact", head: true }).eq("status", status).eq("auto", false)).count ?? 0;
  const [pending, needs_review, approved] = await Promise.all([c("pending"), c("needs_review"), c("approved")]);
  const { count: unsuggested } = await g.from("dispositions").select("id", { count: "exact", head: true }).eq("status", "pending").is("suggestion", null);
  const { count: payroll } = await g.from("dispositions").select("id", { count: "exact", head: true }).eq("kind", "payroll");
  return { pending, needs_review, approved, unsuggested: unsuggested ?? 0, payroll: payroll ?? 0 };
}

export function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}
