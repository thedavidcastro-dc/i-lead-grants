"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile, requireAdmin, canClassify } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fileToBlocks } from "@/lib/ai/documents";
import { extractPayroll, round2, type PayrollRow } from "@/lib/ai/tasks/payroll";
import { getPeriod, grantLineOptions, payrollAccountGroups, profileOn, type AllocationProfile, type GlCheck, type Split } from "@/lib/payroll/data";

const MAX_UPLOAD = 25 * 1024 * 1024;
const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" && v.trim() !== "" ? v.trim() : null; };
const num = (fd: FormData, k: string) => { const v = str(fd, k); return v == null ? null : Number(v.replace(/[,$%]/g, "")); };
function err(back: string, msg: string): never { redirect(`${back}?error=${encodeURIComponent(msg)}`); }

async function audit(action: string, entity: string, entityId: string, after: unknown, userId: string) {
  await createAdminClient().schema("grants").from("audit_log").insert({ user_id: userId, action, entity, entity_id: entityId, after });
}
async function requireClassifier() {
  const me = await requireProfile();
  if (!canClassify(me.role)) redirect("/payroll?error=" + encodeURIComponent("Only administrators and the bookkeeper can work on payroll"));
  return me;
}

/* ------------------------------------------------------------------ upload + extract */
export async function uploadPayrollReport(fd: FormData) {
  const me = await requireClassifier();
  const back = "/payroll";
  const file = fd.get("file");
  const hint = str(fd, "hint") ?? undefined;
  if (!(file instanceof File) || file.size === 0) err(back, "Choose the payroll report file");
  if (file.size > MAX_UPLOAD) err(back, "File is larger than 25 MB");

  const admin = createAdminClient();
  const g = admin.schema("grants");
  const buf = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
  const path = `payroll/${randomUUID()}-${safeName}`;
  const { error: upErr } = await admin.storage.from("grant-documents").upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: false });
  if (upErr) err(back, "Upload failed: " + upErr.message);
  const { data: doc, error: dErr } = await g.from("documents").insert({ kind: "payroll_report", title: file.name, storage_path: path, mime_type: file.type || null, size_bytes: file.size, uploaded_by: me.id }).select("id").single();
  if (dErr) err(back, dErr.message);

  let res: Awaited<ReturnType<typeof extractPayroll>>;
  try {
    const { blocks } = await fileToBlocks(buf, file.type, file.name);
    res = await extractPayroll(blocks, { userId: me.id, hint, entityId: doc.id });
  } catch (e) {
    err(back, "Could not read the report: " + (e instanceof Error ? e.message : String(e)));
  }
  const ex = res.data;
  const payDate = ex.pay_date ?? ex.period_end;

  // A re-upload of an uncertified run replaces it; a certified run is immutable.
  const { data: dup } = await g.from("payroll_periods").select("id, status").eq("pay_date", payDate).eq("provider", ex.provider).is("label", null).maybeSingle();
  if (dup?.status === "certified") err(back, `A certified pay run already exists for pay date ${payDate}. Un-certify it first (admin) or upload with a label.`);
  if (dup) await g.from("payroll_periods").delete().eq("id", dup.id);

  const { data: period, error: pErr } = await g.from("payroll_periods").insert({
    period_start: ex.period_start, period_end: ex.period_end, pay_date: payDate, provider: ex.provider, document_id: doc.id, status: "extracted", uploaded_by: me.id,
    extraction: { warnings: ex.warnings ?? [], footing: res.checks, model: res.model, cost_usd: res.costUsd, employee_count: ex.employee_count ?? null, rows_extracted: ex.rows.length },
    totals: ex.company_totals,
  }).select("id").single();
  if (pErr) err(back, pErr.message);

  try { await upsertRows(period.id, ex.rows); } catch (e) {
    await g.from("payroll_periods").delete().eq("id", period.id);
    err(back, "Could not store the extracted rows: " + (e instanceof Error ? e.message : String(e)));
  }
  await audit("payroll.upload", "payroll_period", period.id, { file: file.name, pay_date: payDate, rows: ex.rows.length, cost: res.costUsd }, me.id);
  // Run the GL check right away so the review page opens with it.
  try { await computeGlCheck(period.id); } catch { /* shown as not run */ }
  revalidatePath("/payroll");
  redirect(`/payroll/${period.id}`);
}

/** Upsert employees by provider employee number and insert the period's rows. */
async function upsertRows(periodId: string, rows: PayrollRow[]) {
  const g = createAdminClient().schema("grants");
  const { data: existing } = await g.from("employees").select("id, employee_no, name");
  const byNo = new Map((existing ?? []).filter((e) => e.employee_no).map((e) => [e.employee_no as string, e.id]));
  const byName = new Map((existing ?? []).filter((e) => !e.employee_no).map((e) => [e.name.toLowerCase(), e.id]));
  // Main department = the one carrying the most wages for this run.
  const mainDept = new Map<string, { code: string | null; name: string | null; wages: number }>();
  for (const r of rows) {
    const cur = mainDept.get(r.employee_no);
    if (!cur || r.gross_wages > cur.wages) mainDept.set(r.employee_no, { code: r.department_code ?? null, name: r.department_name ?? null, wages: r.gross_wages });
  }
  const now = new Date().toISOString();
  const ids = new Map<string, string>();
  for (const [no, d] of mainDept) {
    const r = rows.find((x) => x.employee_no === no)!;
    const payType = r.rate ? "hourly" : "salary";
    let id = byNo.get(no) ?? byName.get(r.name.toLowerCase());
    if (id) {
      await g.from("employees").update({ employee_no: no, name: r.name, department_code: d.code, department_name: d.name, pay_type: payType, last_seen_at: now, active: true }).eq("id", id);
    } else {
      const { data, error } = await g.from("employees").insert({ employee_no: no, name: r.name, department_code: d.code, department_name: d.name, pay_type: payType, last_seen_at: now }).select("id").single();
      if (error) throw new Error(error.message);
      id = data.id;
    }
    ids.set(no, id);
  }
  // One row per employee per department; if the model split a block in two, merge the halves.
  const merged = new Map<string, PayrollRow & { sort_order: number }>();
  rows.forEach((r, i) => {
    const key = `${r.employee_no}|${r.department_code ?? ""}`;
    const cur = merged.get(key);
    if (!cur) { merged.set(key, { ...r, sort_order: i }); return; }
    const add = (k: keyof PayrollRow) => round2(((cur[k] as number | undefined) ?? 0) + ((r[k] as number | undefined) ?? 0));
    merged.set(key, { ...cur, hours_regular: add("hours_regular"), hours_overtime: add("hours_overtime"), hours_other: add("hours_other"),
      wages_regular: add("wages_regular"), wages_overtime: add("wages_overtime"), wages_other: add("wages_other"), gross_wages: add("gross_wages"),
      reimbursements: add("reimbursements"), employer_taxes: add("employer_taxes"), net_pay: cur.net_pay == null && r.net_pay == null ? null : add("net_pay") });
  });
  const inserts = [...merged.values()].map((r) => ({
    payroll_period_id: periodId, employee_id: ids.get(r.employee_no)!, sort_order: r.sort_order,
    department_code: r.department_code ?? "", department_name: r.department_name ?? null, rate: r.rate ?? null,
    hours_regular: r.hours_regular ?? 0, hours_overtime: r.hours_overtime ?? 0, hours_other: r.hours_other ?? 0,
    wages_regular: r.wages_regular ?? 0, wages_overtime: r.wages_overtime ?? 0, wages_other: r.wages_other ?? 0,
    gross_wages: r.gross_wages, reimbursements: r.reimbursements ?? 0, employer_taxes: r.employer_taxes, employer_tax_detail: r.employer_tax_detail ?? null,
    benefits: 0, other: 0, net_pay: r.net_pay ?? null, raw: r,
  }));
  const { error } = await g.from("payroll_period_employees").insert(inserts);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ row edits */
export async function savePeriodRow(fd: FormData) {
  const me = await requireClassifier();
  const periodId = str(fd, "period_id")!, rowId = str(fd, "row_id")!;
  const back = `/payroll/${periodId}`;
  const g = createAdminClient().schema("grants");
  const { data: p } = await g.from("payroll_periods").select("status").eq("id", periodId).maybeSingle();
  if (!p) err("/payroll", "Pay run not found");
  if (p.status === "certified") err(back, "This pay run is certified; un-certify it to edit");
  const patch = {
    department_code: str(fd, "department_code") ?? "", department_name: str(fd, "department_name"),
    hours_regular: num(fd, "hours_regular") ?? 0, hours_overtime: num(fd, "hours_overtime") ?? 0, hours_other: num(fd, "hours_other") ?? 0,
    wages_regular: num(fd, "wages_regular") ?? 0, wages_overtime: num(fd, "wages_overtime") ?? 0, wages_other: num(fd, "wages_other") ?? 0,
    gross_wages: num(fd, "gross_wages") ?? 0, reimbursements: num(fd, "reimbursements") ?? 0, employer_taxes: num(fd, "employer_taxes") ?? 0,
  };
  const { error } = await g.from("payroll_period_employees").update(patch).eq("id", rowId).eq("payroll_period_id", periodId);
  if (error) err(back, error.message);
  await g.from("payroll_allocations").delete().eq("payroll_period_employee_id", rowId);
  await g.from("payroll_periods").update({ status: "extracted", allocated_at: null }).eq("id", periodId);
  await audit("payroll.row.edit", "payroll_period_employee", rowId, patch, me.id);
  await computeGlCheck(periodId).catch(() => {});
  revalidatePath(back);
  redirect(back);
}

export async function setBenefitsPool(fd: FormData) {
  const me = await requireClassifier();
  const periodId = str(fd, "period_id")!;
  const back = `/payroll/${periodId}`;
  const pool = num(fd, "benefits_pool") ?? 0;
  const g = createAdminClient().schema("grants");
  const cur = await getPeriod(periodId);
  if (!cur) err("/payroll", "Pay run not found");
  if (cur.period.status === "certified") err(back, "This pay run is certified; un-certify it to change the benefits pool");
  const totalWages = cur.rows.reduce((s, r) => s + r.gross_wages, 0);
  let assigned = 0;
  for (let i = 0; i < cur.rows.length; i++) {
    const r = cur.rows[i];
    const share = i === cur.rows.length - 1 ? round2(pool - assigned) : (totalWages > 0 ? round2(pool * r.gross_wages / totalWages) : 0);
    assigned = round2(assigned + share);
    await g.from("payroll_period_employees").update({ benefits: share }).eq("id", r.id);
  }
  await g.from("payroll_periods").update({ benefits_pool: pool, benefits_note: str(fd, "benefits_note") }).eq("id", periodId);
  await audit("payroll.benefits_pool", "payroll_period", periodId, { pool }, me.id);
  if (cur.period.status === "allocated") await draftAllocationsFor(periodId, me.id);
  revalidatePath(back);
  redirect(back);
}

/* ------------------------------------------------------------------ GL check */
export async function runGlCheck(fd: FormData) {
  await requireClassifier();
  const periodId = str(fd, "period_id")!;
  const back = `/payroll/${periodId}`;
  try { await computeGlCheck(periodId); } catch (e) { err(back, e instanceof Error ? e.message : String(e)); }
  revalidatePath(back);
  redirect(back);
}

/** Compare the run's wages and employer taxes with the payroll lines QuickBooks carries around the pay date. */
async function computeGlCheck(periodId: string) {
  const g = createAdminClient().schema("grants");
  const cur = await getPeriod(periodId);
  if (!cur) throw new Error("Pay run not found");
  const anchor = cur.period.pay_date ?? cur.period.period_end;
  const d = new Date(anchor + "T00:00:00Z");
  const from = new Date(d.getTime() - 3 * 86400000).toISOString().slice(0, 10);
  const to = new Date(d.getTime() + 6 * 86400000).toISOString().slice(0, 10);
  const groups = await payrollAccountGroups();
  const allIds = [...groups.wages, ...groups.taxes, ...groups.benefits];
  const { data: lines } = allIds.length
    ? await g.from("qbo_lines").select("id, txn_type, txn_id, txn_date, account_id, amount").eq("deleted", false).eq("is_expense", true).in("account_id", allIds).gte("txn_date", from).lte("txn_date", to).order("txn_date")
    : { data: [] };
  const comp = (id: string | null) => (id && groups.wages.has(id)) ? "wages" : (id && groups.taxes.has(id)) ? "taxes" : "benefits";
  const gl = { wages: 0, taxes: 0, benefits: 0 };
  const out = (lines ?? []).map((l) => {
    const c = comp(l.account_id) as "wages" | "taxes" | "benefits";
    gl[c] = round2(gl[c] + Number(l.amount));
    return { id: l.id, txn_type: l.txn_type, txn_id: l.txn_id, txn_date: l.txn_date, account_name: l.account_id ? groups.names.get(l.account_id) ?? "" : "", amount: Number(l.amount), component: c };
  });
  const rep = {
    wages: round2(cur.rows.reduce((s, r) => s + r.gross_wages, 0)),
    taxes: round2(cur.rows.reduce((s, r) => s + r.employer_taxes, 0)),
    benefits: round2(cur.rows.reduce((s, r) => s + r.reimbursements, 0)),
  };
  const mk = (name: "wages" | "taxes" | "benefits", gate: boolean) => {
    const difference = round2(rep[name] - gl[name]);
    return { name, report: rep[name], gl: gl[name], difference, ok: !gate || Math.abs(difference) <= Math.max(1, rep[name] * 0.005) };
  };
  const components = [mk("wages", true), mk("taxes", true), mk("benefits", false)];
  const check: GlCheck = { ran_at: new Date().toISOString(), window: { from, to }, components, lines: out, ok: components.every((c) => c.ok) };
  const status = cur.period.status === "extracted" ? "checked" : cur.period.status;
  await g.from("payroll_periods").update({ gl_check: check, status }).eq("id", periodId);
  return check;
}

/* ------------------------------------------------------------------ allocation */
export async function draftAllocations(fd: FormData) {
  const me = await requireClassifier();
  const periodId = str(fd, "period_id")!;
  const back = `/payroll/${periodId}`;
  try { await draftAllocationsFor(periodId, me.id); } catch (e) { err(back, e instanceof Error ? e.message : String(e)); }
  revalidatePath(back);
  redirect(back);
}

/** Deterministic: each row's wages and fringe (employer taxes + benefits share) split by the employee's profile in force on the pay date. */
async function draftAllocationsFor(periodId: string, userId: string) {
  const g = createAdminClient().schema("grants");
  const cur = await getPeriod(periodId);
  if (!cur) throw new Error("Pay run not found");
  if (cur.period.status === "certified") throw new Error("Certified pay runs cannot be re-allocated; un-certify first");
  const payDate = cur.period.pay_date ?? cur.period.period_end;
  const empIds = [...new Set(cur.rows.map((r) => r.employee_id))];
  const { data: profiles } = await g.from("allocation_profiles").select("*").in("employee_id", empIds);
  const byEmp = new Map<string, AllocationProfile[]>();
  for (const p of (profiles ?? []) as AllocationProfile[]) byEmp.set(p.employee_id, [...(byEmp.get(p.employee_id) ?? []), p]);
  const options = await grantLineOptions();
  const lineOk = new Map(options.map((o) => [o.line_id, o]));
  const flags: Array<{ employee: string; message: string }> = [];

  await g.from("payroll_allocations").delete().in("payroll_period_employee_id", cur.rows.map((r) => r.id));
  const inserts: Array<Record<string, unknown>> = [];
  const seenNoProfile = new Set<string>();
  for (const r of cur.rows) {
    const fringe = round2(r.employer_taxes + r.benefits);
    const profile = profileOn(byEmp.get(r.employee_id) ?? [], payDate);
    let wagesLeft = r.gross_wages, fringeLeft = fringe;
    if (!profile) {
      if (!seenNoProfile.has(r.employee_id)) { flags.push({ employee: r.employee.name, message: "No allocation profile in force on the pay date — allocated to unrestricted" }); seenNoProfile.add(r.employee_id); }
    } else {
      const splits = (profile.splits ?? []) as Split[];
      for (const s of splits) {
        if (!s.grant_id || !s.pct) continue;
        const line = s.budget_line_id ? lineOk.get(s.budget_line_id) : null;
        const fringeLine = s.fringe_line_id ? lineOk.get(s.fringe_line_id) : null;
        const opt = line ?? options.find((o) => o.grant_id === s.grant_id);
        if (!opt) { flags.push({ employee: r.employee.name, message: "Profile points at a grant or budget line that is no longer current — that share went to unrestricted" }); continue; }
        if ((opt.cost_period_start && payDate < opt.cost_period_start) || (opt.cost_period_end && payDate > opt.cost_period_end)) {
          flags.push({ employee: r.employee.name, message: `${opt.grant_name}: pay date is outside the grant's cost period — share went to unrestricted` }); continue;
        }
        const w = round2(r.gross_wages * s.pct), f = round2(fringe * s.pct);
        if (w) inserts.push({ payroll_period_employee_id: r.id, grant_id: s.grant_id, budget_line_id: s.budget_line_id ?? null, component: "wages", amount: w, pct: s.pct, profile_id: profile.id });
        if (f) inserts.push({ payroll_period_employee_id: r.id, grant_id: s.grant_id, budget_line_id: fringeLine?.line_id ?? s.budget_line_id ?? null, component: "fringe", amount: f, pct: s.pct, profile_id: profile.id });
        wagesLeft = round2(wagesLeft - w); fringeLeft = round2(fringeLeft - f);
      }
      if (!profile.certified_at) flags.push({ employee: r.employee.name, message: "Profile in force has not been certified" });
    }
    if (wagesLeft) inserts.push({ payroll_period_employee_id: r.id, grant_id: null, budget_line_id: null, component: "wages", amount: wagesLeft, pct: null, profile_id: profile?.id ?? null });
    if (fringeLeft) inserts.push({ payroll_period_employee_id: r.id, grant_id: null, budget_line_id: null, component: "fringe", amount: fringeLeft, pct: null, profile_id: profile?.id ?? null });
  }
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await g.from("payroll_allocations").insert(inserts.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  // Budget headroom warnings per grant line (certified payroll + approved expenses + this run's draft).
  const { data: actuals } = await g.from("budget_line_actuals").select("budget_line_id, allocated").in("budget_line_id", [...lineOk.keys()]);
  const used = new Map((actuals ?? []).map((a) => [a.budget_line_id, Number(a.allocated)]));
  const thisRun = new Map<string, number>();
  for (const i of inserts) if (i.budget_line_id) thisRun.set(i.budget_line_id as string, round2((thisRun.get(i.budget_line_id as string) ?? 0) + (i.amount as number)));
  for (const [lineId, amt] of thisRun) {
    const o = lineOk.get(lineId)!;
    if ((used.get(lineId) ?? 0) + amt > o.amount) flags.push({ employee: "—", message: `${o.grant_name} · ${o.category}: this run takes the line to ${((used.get(lineId) ?? 0) + amt).toFixed(2)} against a budget of ${o.amount.toFixed(2)}` });
  }
  const extraction = { ...(cur.period.extraction ?? {}), allocation_flags: flags };
  await g.from("payroll_periods").update({ status: "allocated", allocated_at: new Date().toISOString(), extraction }).eq("id", periodId);
  await audit("payroll.allocate", "payroll_period", periodId, { allocations: inserts.length, flags: flags.length }, userId);
}

/* ------------------------------------------------------------------ certification */
export async function certifyPeriod(fd: FormData) {
  const me = await requireClassifier();
  const periodId = str(fd, "period_id")!;
  const back = `/payroll/${periodId}`;
  const g = createAdminClient().schema("grants");
  const cur = await getPeriod(periodId);
  if (!cur) err("/payroll", "Pay run not found");
  if (cur.period.status !== "allocated") err(back, "Draft the allocations before certifying");
  if (!fd.get("attest")) err(back, "Tick the attestation to certify");
  const glNote = str(fd, "gl_note");
  if (!cur.period.gl_check) err(back, "Run the QuickBooks check first");
  if (!cur.period.gl_check.ok && !glNote) err(back, "The QuickBooks check is outside tolerance — explain the difference before certifying");
  const { error } = await g.from("payroll_periods").update({ status: "certified", certified_by: me.id, certified_at: new Date().toISOString(), gl_note: glNote ?? cur.period.gl_note }).eq("id", periodId);
  if (error) err(back, error.message);
  await audit("payroll.certify", "payroll_period", periodId, { gl_note: glNote, rows: cur.rows.length }, me.id);
  revalidatePath(back); revalidatePath("/payroll"); revalidatePath("/grants");
  redirect(back);
}

export async function uncertifyPeriod(fd: FormData) {
  const me = await requireAdmin();
  const periodId = str(fd, "period_id")!;
  const back = `/payroll/${periodId}`;
  await createAdminClient().schema("grants").from("payroll_periods").update({ status: "allocated", certified_by: null, certified_at: null }).eq("id", periodId);
  await audit("payroll.uncertify", "payroll_period", periodId, {}, me.id);
  revalidatePath(back); revalidatePath("/payroll");
  redirect(back);
}

export async function deletePeriod(fd: FormData) {
  const me = await requireAdmin();
  const periodId = str(fd, "period_id")!;
  const g = createAdminClient().schema("grants");
  const { data: p } = await g.from("payroll_periods").select("status, pay_date").eq("id", periodId).maybeSingle();
  if (p?.status === "certified") err(`/payroll/${periodId}`, "Un-certify before deleting");
  await g.from("payroll_periods").delete().eq("id", periodId);
  await audit("payroll.delete", "payroll_period", periodId, { pay_date: p?.pay_date }, me.id);
  revalidatePath("/payroll");
  redirect("/payroll");
}

/* ------------------------------------------------------------------ employees + profiles */
export async function saveEmployee(fd: FormData) {
  const me = await requireClassifier();
  const id = str(fd, "employee_id")!;
  const back = `/payroll/employees/${id}`;
  const patch = { name: str(fd, "name") ?? undefined, title: str(fd, "title"), notes: str(fd, "notes"), active: fd.get("active") === "on", pay_type: str(fd, "pay_type") };
  const { error } = await createAdminClient().schema("grants").from("employees").update(patch).eq("id", id);
  if (error) err(back, error.message);
  await audit("employee.edit", "employee", id, patch, me.id);
  revalidatePath(back); revalidatePath("/payroll/employees");
  redirect(back);
}

export async function saveProfile(fd: FormData) {
  const me = await requireClassifier();
  const employeeId = str(fd, "employee_id")!;
  const back = `/payroll/employees/${employeeId}`;
  const from = str(fd, "effective_from");
  if (!from) err(back, "Effective-from date is required");
  const to = str(fd, "effective_to");
  const splits: Split[] = [];
  for (let i = 0; i < 6; i++) {
    const target = str(fd, `split_target_${i}`);
    const pctRaw = num(fd, `split_pct_${i}`);
    if (!target || !pctRaw) continue;
    const [grantId, lineId] = target.split("|");
    const fringe = str(fd, `split_fringe_${i}`);
    splits.push({ grant_id: grantId, budget_line_id: lineId || null, fringe_line_id: fringe ? fringe.split("|")[1] || null : null, pct: round2(pctRaw) / 100 });
  }
  const total = splits.reduce((s, x) => s + x.pct, 0);
  if (total > 1.0001) err(back, `Grant shares add to ${(total * 100).toFixed(2)}% — more than 100%`);
  const g = createAdminClient().schema("grants");
  // Close any open profile that starts before this one.
  const dayBefore = new Date(new Date(from + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
  await g.from("allocation_profiles").update({ effective_to: dayBefore }).eq("employee_id", employeeId).is("effective_to", null).lt("effective_from", from);
  const certify = fd.get("certify") === "on";
  const { data, error } = await g.from("allocation_profiles").insert({
    employee_id: employeeId, effective_from: from, effective_to: to, splits, basis: str(fd, "basis"),
    certified_by: certify ? me.id : null, certified_at: certify ? new Date().toISOString() : null,
  }).select("id").single();
  if (error) err(back, error.message);
  await audit("profile.create", "allocation_profile", data.id, { employee_id: employeeId, effective_from: from, splits, certified: certify }, me.id);
  revalidatePath(back); revalidatePath("/payroll/employees");
  redirect(back);
}

export async function certifyProfile(fd: FormData) {
  const me = await requireClassifier();
  const id = str(fd, "profile_id")!, employeeId = str(fd, "employee_id")!;
  const back = `/payroll/employees/${employeeId}`;
  await createAdminClient().schema("grants").from("allocation_profiles").update({ certified_by: me.id, certified_at: new Date().toISOString(), basis: str(fd, "basis") ?? undefined }).eq("id", id);
  await audit("profile.certify", "allocation_profile", id, {}, me.id);
  revalidatePath(back);
  redirect(back);
}

export async function deleteProfile(fd: FormData) {
  const me = await requireAdmin();
  const id = str(fd, "profile_id")!, employeeId = str(fd, "employee_id")!;
  const back = `/payroll/employees/${employeeId}`;
  const g = createAdminClient().schema("grants");
  const { count } = await g.from("payroll_allocations").select("id", { count: "exact", head: true }).eq("profile_id", id);
  if (count) err(back, `This profile has been used in ${count} allocations; add a newer profile instead of deleting it`);
  await g.from("allocation_profiles").delete().eq("id", id);
  await audit("profile.delete", "allocation_profile", id, {}, me.id);
  revalidatePath(back);
  redirect(back);
}
