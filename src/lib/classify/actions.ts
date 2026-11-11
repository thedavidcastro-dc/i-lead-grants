"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile, canClassify, isAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureDispositions, grantContexts, queueLines, vendorHistory, type Suggestion, type GrantContext } from "@/lib/classify/data";
import { suggestClassifications } from "@/lib/ai/tasks/classify";

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" && v.trim() !== "" ? v.trim() : null; };
const num = (fd: FormData, k: string) => { const v = str(fd, k); return v == null ? null : Number(v.replace(/[,$]/g, "")); };

async function audit(action: string, entity: string, entityId: string, after: unknown, userId: string) {
  await createAdminClient().schema("grants").from("audit_log").insert({ user_id: userId, action, entity, entity_id: entityId, after });
}

/** Check that a set of allocations is legal against the current grants/lines. Returns an error message or null. */
function validateAllocations(kind: string, allocs: Array<{ grant_id: string; budget_line_id: string | null; amount: number }>, lineAmount: number, grants: GrantContext[], txnDate: string): string | null {
  if (kind !== "grant") return allocs.length ? "Unrestricted/excluded lines carry no allocations" : null;
  if (!allocs.length) return "A grant disposition needs at least one allocation";
  const total = allocs.reduce((s, a) => s + a.amount, 0);
  const sign = lineAmount < 0 ? -1 : 1;
  if (sign * total > sign * lineAmount + 0.005) return `Allocations (${total.toFixed(2)}) exceed the line amount (${lineAmount.toFixed(2)})`;
  for (const a of allocs) {
    const g = grants.find((x) => x.id === a.grant_id);
    if (!g) return "Unknown or inactive grant";
    if (a.budget_line_id && !g.lines.some((l) => l.id === a.budget_line_id)) return "Budget line does not belong to that grant's current budget";
    if (g.cost_period_start && txnDate < g.cost_period_start) return `${g.name}: transaction is before the cost period`;
    if (g.cost_period_end && txnDate > g.cost_period_end) return `${g.name}: transaction is after the cost period`;
    if (a.amount === 0) return "Zero allocation";
  }
  return null;
}

/** Ask Claude for suggestions on pending lines that have none (admin or bookkeeper). */
export async function runSuggestions(limit = 60): Promise<{ suggested: number; batches: number; cost: number; error?: string }> {
  const me = await requireProfile();
  if (!canClassify(me.role)) throw new Error("Not allowed");
  await ensureDispositions();
  const g = createAdminClient().schema("grants");
  const grants = await grantContexts();
  if (!grants.length) return { suggested: 0, batches: 0, cost: 0, error: "No active grant with an approved budget." };

  const { data: pending } = await g.from("dispositions").select("id").eq("status", "pending").eq("auto", false).is("suggestion", null).order("txn_date", { ascending: false }).limit(limit);
  if (!pending?.length) return { suggested: 0, batches: 0, cost: 0 };
  const all = await queueLines("pending", { limit: 2000 });
  const wanted = new Set(pending.map((p) => p.id));
  const lines = all.filter((l) => wanted.has(l.disposition_id));

  let suggested = 0, batches = 0, cost = 0;
  const BATCH = 20;
  for (let i = 0; i < lines.length; i += BATCH) {
    const chunk = lines.slice(i, i + BATCH);
    const history = await vendorHistory(chunk.map((l) => l.entity_id).filter((x): x is string => !!x), chunk.map((l) => l.account_id).filter((x): x is string => !!x));
    try {
      const res = await suggestClassifications(chunk, grants, history, me.id);
      batches++; cost += res.costUsd;
      for (const r of res.data.results) {
        const line = chunk.find((l) => l.line_id === r.line_id);
        if (!line) continue;
        const problem = validateAllocations(r.kind, r.allocations, line.amount, grants, line.txn_date);
        const suggestion: Suggestion = {
          kind: r.kind, allocations: r.allocations, model: res.model,
          confidence: problem ? Math.min(r.confidence, 0.3) : r.confidence,
          rationale: problem ? `${r.rationale} (check: ${problem})` : r.rationale,
        };
        await g.from("dispositions").update({ suggestion, suggested_at: new Date().toISOString() }).eq("id", line.disposition_id);
        suggested++;
      }
    } catch (e) {
      return { suggested, batches, cost, error: e instanceof Error ? e.message : String(e) };
    }
  }
  revalidatePath("/queue");
  return { suggested, batches, cost };
}

async function applyDecision(dispositionId: string, kind: string, allocs: Array<{ grant_id: string; budget_line_id: string | null; amount: number }>, note: string | null, me: { id: string; role: string }) {
  const g = createAdminClient().schema("grants");
  const { data: d } = await g.from("dispositions").select("id, status, qbo_lines!inner(id, amount, txn_date, deleted)").eq("id", dispositionId).maybeSingle();
  if (!d) return "Line not found";
  const line = d.qbo_lines as unknown as { id: string; amount: number; txn_date: string; deleted: boolean };
  if (line.deleted) return "This line was deleted in QuickBooks";
  const grants = await grantContexts();
  const problem = validateAllocations(kind, allocs, Number(line.amount), grants, line.txn_date);
  if (problem) return problem;
  await g.from("allocations").delete().eq("disposition_id", dispositionId);
  if (kind === "grant") {
    const { error } = await g.from("allocations").insert(allocs.map((a) => ({ disposition_id: dispositionId, grant_id: a.grant_id, budget_line_id: a.budget_line_id, amount: a.amount })));
    if (error) return error.message;
  }
  await g.from("dispositions").update({ status: "approved", kind, decided_by: me.id, decided_at: new Date().toISOString(), note }).eq("id", dispositionId);
  await g.from("sync_flags").update({ resolved_at: new Date().toISOString(), resolved_by: me.id, resolution: "re-approved" }).eq("line_id", line.id).is("resolved_at", null);
  await audit("disposition.approve", "disposition", dispositionId, { kind, allocations: allocs, note }, me.id);
  return null;
}

/** Approve the stored suggestion for one or many dispositions. */
export async function approveSuggestions(fd: FormData) {
  const me = await requireProfile();
  if (!canClassify(me.role)) redirect("/queue?error=Not+allowed");
  const ids = fd.getAll("disposition_id").map(String);
  const back = str(fd, "back") ?? "/queue";
  const g = createAdminClient().schema("grants");
  const problems: string[] = [];
  let ok = 0;
  for (const id of ids) {
    const { data: d } = await g.from("dispositions").select("suggestion").eq("id", id).maybeSingle();
    const s = d?.suggestion as Suggestion | null;
    if (!s) { problems.push("no suggestion"); continue; }
    const p = await applyDecision(id, s.kind, s.allocations, "approved suggestion", me);
    if (p) problems.push(p); else ok++;
  }
  revalidatePath("/queue");
  const msg = problems.length ? `&error=${encodeURIComponent(`${ok} approved; ${problems.length} skipped: ${[...new Set(problems)].join("; ")}`)}` : `&ok=${ok}+approved`;
  redirect(`${back}${back.includes("?") ? "" : "?"}${msg}`);
}

/** Set a disposition by hand: kind + up to three allocations ("grantId|lineId" + amount). */
export async function setDisposition(fd: FormData) {
  const me = await requireProfile();
  if (!canClassify(me.role)) redirect("/queue?error=Not+allowed");
  const id = str(fd, "disposition_id")!;
  const kind = str(fd, "kind") ?? "unrestricted";
  const back = str(fd, "back") ?? "/queue";
  const g = createAdminClient().schema("grants");
  const { data: d } = await g.from("dispositions").select("qbo_lines!inner(amount)").eq("id", id).maybeSingle();
  const lineAmount = Number((d?.qbo_lines as unknown as { amount: number } | null)?.amount ?? 0);
  const allocs: Array<{ grant_id: string; budget_line_id: string | null; amount: number }> = [];
  for (const n of [1, 2, 3]) {
    const target = str(fd, `target_${n}`);
    if (!target) continue;
    const [grant_id, budget_line_id] = target.split("|");
    const amount = num(fd, `amount_${n}`) ?? (n === 1 ? lineAmount : 0);
    allocs.push({ grant_id, budget_line_id: budget_line_id || null, amount });
  }
  const problem = await applyDecision(id, kind, kind === "grant" ? allocs : [], str(fd, "note"), me);
  revalidatePath("/queue");
  redirect(`${back}${back.includes("?") ? "&" : "?"}${problem ? `error=${encodeURIComponent(problem)}` : "ok=saved"}`);
}

/** Send an approved line back to the queue (admin). */
export async function reopenDisposition(fd: FormData) {
  const me = await requireProfile();
  if (!isAdmin(me.role)) redirect("/queue?error=Admins+only");
  const id = str(fd, "disposition_id")!;
  const back = str(fd, "back") ?? "/queue?status=approved";
  const g = createAdminClient().schema("grants");
  await g.from("dispositions").update({ status: "pending", note: "reopened" }).eq("id", id);
  await audit("disposition.reopen", "disposition", id, null, me.id);
  revalidatePath("/queue");
  redirect(back);
}
