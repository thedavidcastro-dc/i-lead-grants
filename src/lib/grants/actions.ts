"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { requireAdmin, requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fileToBlocks } from "@/lib/ai/documents";
import { extractBudget, proposeMapping } from "@/lib/ai/tasks/budget";
import { GRANT_STATUSES } from "@/lib/grants/data";

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" && v.trim() !== "" ? v.trim() : null; };
const num = (fd: FormData, k: string) => { const v = str(fd, k); return v == null ? null : Number(v.replace(/[,$]/g, "")); };

async function audit(action: string, entity: string, entityId: string, after: unknown, userId: string) {
  const g = createAdminClient().schema("grants");
  await g.from("audit_log").insert({ user_id: userId, action, entity, entity_id: entityId, after });
}

/* ----------------------------------------------------------------- funders */
export async function saveFunder(fd: FormData) {
  const me = await requireAdmin();
  const g = (await createClient()).schema("grants");
  const id = str(fd, "id");
  const row = { name: str(fd, "name"), short_name: str(fd, "short_name"), contact_name: str(fd, "contact_name"), contact_email: str(fd, "contact_email"), notes: str(fd, "notes") };
  if (!row.name) redirect(`/funders?error=${encodeURIComponent("Name is required")}`);
  const { data, error } = id
    ? await g.from("funders").update(row).eq("id", id).select("id").single()
    : await g.from("funders").insert(row).select("id").single();
  if (error) redirect(`/funders?error=${encodeURIComponent(error.message)}`);
  await audit(id ? "funder.update" : "funder.create", "funder", data.id, row, me.id);
  revalidatePath("/funders");
  redirect("/funders");
}

/* ------------------------------------------------------------------ grants */
export async function saveGrant(fd: FormData) {
  const me = await requireAdmin();
  const g = (await createClient()).schema("grants");
  const id = str(fd, "id");
  const status = str(fd, "status") ?? "prospect";
  if (!(GRANT_STATUSES as readonly string[]).includes(status)) redirect("/grants?error=bad_status");
  const indirectType = str(fd, "indirect_type") ?? "none";
  const indirect_rule = indirectType === "rate"
    ? { type: "rate", rate: (num(fd, "indirect_rate") ?? 0) / 100, base: str(fd, "indirect_base") ?? "mtdc" }
    : { type: "none" };
  let reporting: unknown[] = [];
  const reportingText = str(fd, "reporting_json");
  if (reportingText) { try { reporting = JSON.parse(reportingText); } catch { redirect(`/grants?error=${encodeURIComponent("Reporting must be valid JSON")}`); } }
  const row = {
    funder_id: str(fd, "funder_id"), name: str(fd, "name"), program: str(fd, "program"), award_number: str(fd, "award_number"),
    status, funding_type: str(fd, "funding_type") ?? "reimbursement",
    award_amount: num(fd, "award_amount"), cost_period_start: str(fd, "cost_period_start"), cost_period_end: str(fd, "cost_period_end"),
    indirect_rule, reporting, funds_received: num(fd, "funds_received") ?? 0,
    qbo_class_id: str(fd, "qbo_class_id"), notes: str(fd, "notes"),
  };
  if (!row.name || !row.funder_id) redirect(`/grants/new?error=${encodeURIComponent("Funder and name are required")}`);
  const { data, error } = id
    ? await g.from("grants").update(row).eq("id", id).select("id").single()
    : await g.from("grants").insert({ ...row, created_by: me.id }).select("id").single();
  if (error) redirect(`/grants?error=${encodeURIComponent(error.message)}`);
  await audit(id ? "grant.update" : "grant.create", "grant", data.id, row, me.id);
  revalidatePath("/grants");
  redirect(`/grants/${data.id}`);
}

/* --------------------------------------------------------------- documents */
const MAX_UPLOAD = 25 * 1024 * 1024;

export async function uploadDocument(fd: FormData) {
  const me = await requireProfile();
  const grantId = str(fd, "grant_id");
  const funderId = str(fd, "funder_id");
  const kind = str(fd, "kind") ?? "other";
  const file = fd.get("file");
  const back = grantId ? `/grants/${grantId}` : `/funders`;
  if (!(file instanceof File) || file.size === 0) redirect(`${back}?error=${encodeURIComponent("Choose a file")}`);
  if (file.size > MAX_UPLOAD) redirect(`${back}?error=${encodeURIComponent("File is larger than 25 MB")}`);
  if (me.role !== "admin" && kind !== "payroll_report") redirect(`${back}?error=${encodeURIComponent("Only administrators can upload this kind of document")}`);

  const admin = createAdminClient();
  const buf = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
  const path = `${grantId ? `grants/${grantId}` : `funders/${funderId}`}/${randomUUID()}-${safeName}`;
  const { error: upErr } = await admin.storage.from("grant-documents").upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: false });
  if (upErr) redirect(`${back}?error=${encodeURIComponent("Upload failed: " + upErr.message)}`);

  let textContent: string | null = null;
  try {
    if (!/pdf$/i.test(file.name) && !file.type.startsWith("image/")) {
      const { textPreview } = await fileToBlocks(buf, file.type, file.name);
      textContent = textPreview;
    }
  } catch { /* unsupported for text conversion; the file is still stored */ }

  const g = admin.schema("grants");
  const { data, error } = await g.from("documents").insert({
    grant_id: grantId, funder_id: funderId, kind, title: str(fd, "title") ?? file.name, storage_path: path,
    mime_type: file.type || null, size_bytes: file.size, text_content: textContent, uploaded_by: me.id,
  }).select("id").single();
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  await audit("document.upload", "document", data.id, { kind, title: file.name, path }, me.id);
  revalidatePath(back);
  redirect(back);
}

export async function documentDownloadUrl(documentId: string): Promise<string | null> {
  await requireProfile();
  const admin = createAdminClient();
  const { data: doc } = await admin.schema("grants").from("documents").select("storage_path").eq("id", documentId).maybeSingle();
  if (!doc?.storage_path) return null;
  const { data } = await admin.storage.from("grant-documents").createSignedUrl(doc.storage_path, 600);
  return data?.signedUrl ?? null;
}

/* ------------------------------------------------------------------ budget */
export async function extractBudgetFromDocuments(fd: FormData) {
  const me = await requireAdmin();
  const grantId = str(fd, "grant_id")!;
  const docIds = fd.getAll("document_ids").map(String).filter(Boolean);
  const hint = str(fd, "hint") ?? undefined;
  const back = `/grants/${grantId}`;
  if (!docIds.length) redirect(`${back}?error=${encodeURIComponent("Pick at least one document")}`);

  const admin = createAdminClient();
  const g = admin.schema("grants");
  const { data: docs } = await g.from("documents").select("id, title, storage_path, mime_type").in("id", docIds);
  const blocks = [];
  for (const d of docs ?? []) {
    if (!d.storage_path) continue;
    const { data: file, error } = await admin.storage.from("grant-documents").download(d.storage_path);
    if (error || !file) redirect(`${back}?error=${encodeURIComponent("Could not read " + d.title)}`);
    try {
      const { blocks: b } = await fileToBlocks(Buffer.from(await file.arrayBuffer()), d.mime_type ?? "", d.title);
      blocks.push(...b);
    } catch (e) {
      redirect(`${back}?error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
    }
  }

  let result;
  try {
    result = await extractBudget(blocks, { grantId, userId: me.id, hint });
  } catch (e) {
    redirect(`${back}?error=${encodeURIComponent("Extraction failed: " + (e instanceof Error ? e.message : String(e)))}`);
  }
  const ex = result.data;

  const { data: existing } = await g.from("budget_versions").select("version_no").eq("grant_id", grantId).eq("kind", "approved").order("version_no", { ascending: false }).limit(1).maybeSingle();
  const version_no = (existing?.version_no ?? 0) + 1;
  const total = ex.lines.reduce((s, l) => s + (l.amount || 0), 0);
  const { data: ver, error: vErr } = await g.from("budget_versions").insert({
    grant_id: grantId, kind: "approved", version_no, status: "draft", total, source_document_id: docIds[0],
    extraction: { ...ex, lines: undefined, cost_usd: result.costUsd, model: result.model, documents: docIds },
    notes: `Extracted by ${result.model} from ${docs?.map((d) => d.title).join(", ")}`,
  }).select("id").single();
  if (vErr) redirect(`${back}?error=${encodeURIComponent(vErr.message)}`);

  const lines = ex.lines.map((l, i) => ({
    budget_version_id: ver.id, sort_order: i, category: l.category, description: l.description ?? null, amount: l.amount,
    period_start: l.period_start ?? null, period_end: l.period_end ?? null, allowable: l.allowable ?? true,
    cap_rule: l.cap_rule ?? null, detail: { ...(l.detail ?? {}), source_note: l.source_note ?? undefined },
  }));
  const { error: lErr } = await g.from("budget_lines").insert(lines);
  if (lErr) redirect(`${back}?error=${encodeURIComponent(lErr.message)}`);
  await audit("budget.extract", "budget_version", ver.id, { documents: docIds, lines: lines.length, total, cost_usd: result.costUsd }, me.id);
  revalidatePath(back);
  redirect(`/grants/${grantId}/budget/${ver.id}`);
}

export async function saveBudgetLines(fd: FormData) {
  const me = await requireAdmin();
  const versionId = str(fd, "version_id")!;
  const grantId = str(fd, "grant_id")!;
  const g = createAdminClient().schema("grants");
  const { data: ver } = await g.from("budget_versions").select("status").eq("id", versionId).maybeSingle();
  if (ver?.status !== "draft") redirect(`/grants/${grantId}/budget/${versionId}?error=${encodeURIComponent("Only drafts can be edited")}`);

  const ids = fd.getAll("line_id").map(String);
  const rows = ids.map((id, i) => ({
    id,
    category: str(fd, `category_${id}`) ?? "",
    description: str(fd, `description_${id}`),
    amount: num(fd, `amount_${id}`) ?? 0,
    allowable: fd.get(`allowable_${id}`) === "on",
    report_row: str(fd, `report_row_${id}`),
    sort_order: i,
  }));
  for (const r of rows) {
    if (fd.get(`delete_${r.id}`) === "on") { await g.from("budget_lines").delete().eq("id", r.id); continue; }
    await g.from("budget_lines").update(r).eq("id", r.id);
  }
  const newCat = str(fd, "new_category");
  if (newCat) {
    await g.from("budget_lines").insert({ budget_version_id: versionId, sort_order: rows.length, category: newCat, description: str(fd, "new_description"), amount: num(fd, "new_amount") ?? 0 });
  }
  const { data: lines } = await g.from("budget_lines").select("amount").eq("budget_version_id", versionId);
  const total = (lines ?? []).reduce((s, l) => s + Number(l.amount), 0);
  await g.from("budget_versions").update({ total }).eq("id", versionId);
  await audit("budget.edit", "budget_version", versionId, { lines: rows.length, total }, me.id);
  revalidatePath(`/grants/${grantId}/budget/${versionId}`);
  redirect(`/grants/${grantId}/budget/${versionId}?saved=1`);
}

export async function approveBudgetVersion(fd: FormData) {
  const me = await requireAdmin();
  const versionId = str(fd, "version_id")!;
  const grantId = str(fd, "grant_id")!;
  const g = createAdminClient().schema("grants");
  const { data: ver } = await g.from("budget_versions").select("id, status, total, extraction").eq("id", versionId).maybeSingle();
  if (!ver || ver.status !== "draft") redirect(`/grants/${grantId}?error=${encodeURIComponent("Not a draft")}`);
  await g.from("budget_versions").update({ is_current: false, status: "superseded" }).eq("grant_id", grantId).eq("is_current", true);
  const { error } = await g.from("budget_versions").update({ status: "approved", is_current: true, approved_by: me.id, approved_at: new Date().toISOString(), effective_date: str(fd, "effective_date") }).eq("id", versionId);
  if (error) redirect(`/grants/${grantId}?error=${encodeURIComponent(error.message)}`);
  // Carry header facts from the extraction onto the grant where the grant is still blank.
  const ex = (ver.extraction ?? {}) as Record<string, unknown>;
  const { data: grant } = await g.from("grants").select("award_amount, cost_period_start, cost_period_end, award_number").eq("id", grantId).maybeSingle();
  const patch: Record<string, unknown> = {};
  if (grant && grant.award_amount == null && typeof ex.award_amount === "number") patch.award_amount = ex.award_amount;
  if (grant && !grant.cost_period_start && typeof ex.cost_period_start === "string") patch.cost_period_start = ex.cost_period_start;
  if (grant && !grant.cost_period_end && typeof ex.cost_period_end === "string") patch.cost_period_end = ex.cost_period_end;
  if (grant && !grant.award_number && typeof ex.award_number === "string") patch.award_number = ex.award_number;
  if (Object.keys(patch).length) await g.from("grants").update(patch).eq("id", grantId);
  await audit("budget.approve", "budget_version", versionId, { total: ver.total, patch }, me.id);
  revalidatePath(`/grants/${grantId}`);
  redirect(`/grants/${grantId}/mapping`);
}

/* ----------------------------------------------------------------- mapping */
export async function proposeAccountMapping(fd: FormData) {
  const me = await requireAdmin();
  const grantId = str(fd, "grant_id")!;
  const g = createAdminClient().schema("grants");
  const { data: ver } = await g.from("budget_versions").select("id").eq("grant_id", grantId).eq("is_current", true).maybeSingle();
  if (!ver) redirect(`/grants/${grantId}?error=${encodeURIComponent("Approve a budget first")}`);
  const { data: lines } = await g.from("budget_lines").select("id, category, description, amount, detail").eq("budget_version_id", ver.id).order("sort_order");
  const { data: accounts } = await g.from("qbo_accounts").select("id, name, fully_qualified_name, account_type, account_sub_type").eq("classification", "Expense").eq("active", true).order("fully_qualified_name");
  // Prior approved mappings on other grants, by category.
  const { data: prior } = await g.from("budget_line_accounts").select("budget_line_id, budget_lines!inner(category, budget_version_id, budget_versions!inner(grant_id, is_current)), qbo_accounts!inner(name)");
  const priorByCat = new Map<string, Set<string>>();
  for (const p of (prior ?? []) as unknown as Array<{ budget_lines: { category: string; budget_versions: { grant_id: string } }; qbo_accounts: { name: string } }>) {
    if (p.budget_lines.budget_versions.grant_id === grantId) continue;
    const s = priorByCat.get(p.budget_lines.category) ?? new Set<string>();
    s.add(p.qbo_accounts.name); priorByCat.set(p.budget_lines.category, s);
  }
  try {
    const { data } = await proposeMapping(
      (lines ?? []).map((l) => ({ ...l, amount: Number(l.amount) })),
      accounts ?? [],
      [...priorByCat.entries()].map(([category, names]) => ({ category, account_names: [...names] })),
      { grantId, userId: me.id },
    );
    for (const m of data.mappings) {
      await g.from("budget_lines").update({ suggested_accounts: m.account_ids.map((account_id) => ({ account_id, confidence: m.confidence, rationale: m.rationale })) }).eq("id", m.budget_line_id);
    }
  } catch (e) {
    redirect(`/grants/${grantId}/mapping?error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
  revalidatePath(`/grants/${grantId}/mapping`);
  redirect(`/grants/${grantId}/mapping?proposed=1`);
}

export async function saveAccountMapping(fd: FormData) {
  const me = await requireAdmin();
  const grantId = str(fd, "grant_id")!;
  const g = createAdminClient().schema("grants");
  const lineIds = fd.getAll("line_id").map(String);
  for (const lineId of lineIds) {
    const accountIds = fd.getAll(`accounts_${lineId}`).map(String).filter(Boolean);
    await g.from("budget_line_accounts").delete().eq("budget_line_id", lineId);
    if (accountIds.length) await g.from("budget_line_accounts").insert(accountIds.map((account_id) => ({ budget_line_id: lineId, account_id })));
  }
  await audit("mapping.save", "grant", grantId, { lines: lineIds.length }, me.id);
  revalidatePath(`/grants/${grantId}/mapping`);
  redirect(`/grants/${grantId}/mapping?saved=1`);
}
