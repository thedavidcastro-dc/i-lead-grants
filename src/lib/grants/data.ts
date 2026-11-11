import { createClient } from "@/lib/supabase/server";

export type Funder = { id: string; name: string; short_name: string | null; contact_name: string | null; contact_email: string | null; notes: string | null };
export type Grant = {
  id: string; funder_id: string; name: string; program: string | null; award_number: string | null;
  status: "prospect" | "proposed" | "awarded" | "active" | "closed";
  funding_type: "reimbursement" | "advance" | "hybrid";
  award_amount: number | null; cost_period_start: string | null; cost_period_end: string | null;
  indirect_rule: Record<string, unknown>; match_rule: Record<string, unknown>; reporting: unknown[];
  funds_received: number; qbo_class_id: string | null; notes: string | null; created_at: string;
  funders?: { name: string } | null;
};
export type GrantDocument = {
  id: string; grant_id: string | null; funder_id: string | null; kind: string; title: string; storage_path: string | null;
  mime_type: string | null; size_bytes: number | null; uploaded_at: string; extracted: unknown;
};
export type BudgetVersion = {
  id: string; grant_id: string; kind: "proposed" | "approved" | "amended"; version_no: number; status: "draft" | "approved" | "superseded";
  is_current: boolean; total: number | null; effective_date: string | null; approved_at: string | null; notes: string | null; created_at: string;
  source_document_id: string | null; extraction: Record<string, unknown> | null;
};
export type BudgetLine = {
  id: string; budget_version_id: string; sort_order: number; category: string; description: string | null; amount: number;
  period_start: string | null; period_end: string | null; allowable: boolean; cap_rule: unknown; report_row: string | null;
  planned_curve: unknown; detail: Record<string, unknown> | null; suggested_accounts: Array<{ account_id: string; confidence: number; rationale: string }> | null;
};

export const DOC_KINDS = [
  ["agreement", "Grant agreement"], ["application", "Application"], ["approved_budget", "Approved budget"],
  ["budget_instructions", "Budget instructions"], ["invoicing_instructions", "Invoicing / reporting instructions"],
  ["report_template", "Report template"], ["house_notes", "House notes"], ["payroll_report", "Payroll report"], ["other", "Other"],
] as const;

export const GRANT_STATUSES = ["prospect", "proposed", "awarded", "active", "closed"] as const;

export async function db() {
  return (await createClient()).schema("grants");
}

export async function listFunders(): Promise<Funder[]> {
  const g = await db();
  const { data } = await g.from("funders").select("id, name, short_name, contact_name, contact_email, notes").order("name");
  return (data ?? []) as Funder[];
}

export async function listGrants(): Promise<Grant[]> {
  const g = await db();
  const { data } = await g.from("grants").select("*, funders(name)").order("status").order("name");
  return (data ?? []) as Grant[];
}

export async function getGrant(id: string): Promise<Grant | null> {
  const g = await db();
  const { data } = await g.from("grants").select("*, funders(name)").eq("id", id).maybeSingle();
  return (data as Grant | null) ?? null;
}

export async function listDocuments(grantId: string, funderId?: string): Promise<GrantDocument[]> {
  const g = await db();
  let q = g.from("documents").select("id, grant_id, funder_id, kind, title, storage_path, mime_type, size_bytes, uploaded_at, extracted").order("uploaded_at", { ascending: false });
  q = funderId ? q.or(`grant_id.eq.${grantId},and(grant_id.is.null,funder_id.eq.${funderId})`) : q.eq("grant_id", grantId);
  const { data } = await q;
  return (data ?? []) as GrantDocument[];
}

export async function listBudgetVersions(grantId: string): Promise<BudgetVersion[]> {
  const g = await db();
  const { data } = await g.from("budget_versions").select("*").eq("grant_id", grantId).order("created_at", { ascending: false });
  return (data ?? []) as BudgetVersion[];
}

export async function getBudgetVersion(id: string): Promise<{ version: BudgetVersion; lines: BudgetLine[] } | null> {
  const g = await db();
  const { data: version } = await g.from("budget_versions").select("*").eq("id", id).maybeSingle();
  if (!version) return null;
  const { data: lines } = await g.from("budget_lines").select("*").eq("budget_version_id", id).order("sort_order");
  return { version: version as BudgetVersion, lines: (lines ?? []) as BudgetLine[] };
}

export async function currentBudget(grantId: string) {
  const g = await db();
  const { data: version } = await g.from("budget_versions").select("*").eq("grant_id", grantId).eq("is_current", true).maybeSingle();
  if (!version) return null;
  return getBudgetVersion(version.id);
}

export const money = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
export const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium" }) : "—";
