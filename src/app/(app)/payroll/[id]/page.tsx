import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile, canClassify } from "@/lib/auth";
import { getPeriod, grantLineOptions, money, fmtDate, pct, type PeriodEmployee } from "@/lib/payroll/data";
import { savePeriodRow, setBenefitsPool, runGlCheck, draftAllocations, certifyPeriod, uncertifyPeriod, deletePeriod } from "@/lib/payroll/actions";
import { PageHeader, Flash, Card, StatusPill, Crumbs, btn, btnSecondary, input, label } from "@/components/ui";

export const maxDuration = 120;

type Footing = Array<{ name: string; rows: number; report: number | null; difference: number | null; ok: boolean }>;
type Flag = { employee: string; message: string };

export default async function PeriodPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string; edit?: string }> }) {
  const me = await requireProfile();
  const { id } = await params;
  const sp = await searchParams;
  const cur = await getPeriod(id);
  if (!cur) notFound();
  const { period: p, rows } = cur;
  const options = await grantLineOptions();
  const lineLabel = new Map(options.map((o) => [o.line_id, `${o.grant_name} · ${o.category}`]));
  const grantLabel = new Map(options.map((o) => [o.grant_id, o.grant_name]));
  const can = canClassify(me.role);
  const isAdmin = me.role === "admin";
  const locked = p.status === "certified";
  const ex = (p.extraction ?? {}) as { warnings?: string[]; footing?: Footing; model?: string; cost_usd?: number; allocation_flags?: Flag[] };

  const sum = (f: (r: PeriodEmployee) => number) => rows.reduce((s, r) => s + f(r), 0);
  const totals = { wages: sum((r) => r.gross_wages), reimb: sum((r) => r.reimbursements), taxes: sum((r) => r.employer_taxes), benefits: sum((r) => r.benefits), hours: sum((r) => r.hours_regular + r.hours_overtime + r.hours_other) };
  const loaded = totals.wages + totals.taxes + totals.benefits;

  // Allocation roll-up by grant / line / component.
  const roll = new Map<string, { grant: string; line: string; wages: number; fringe: number }>();
  let unrestrictedW = 0, unrestrictedF = 0;
  for (const r of rows) for (const a of r.allocations) {
    if (!a.grant_id) { if (a.component === "wages") unrestrictedW += a.amount; else unrestrictedF += a.amount; continue; }
    const key = `${a.grant_id}|${a.budget_line_id ?? ""}`;
    const e = roll.get(key) ?? { grant: grantLabel.get(a.grant_id) ?? "Grant", line: a.budget_line_id ? (lineLabel.get(a.budget_line_id)?.split(" · ")[1] ?? "line") : "(no line)", wages: 0, fringe: 0 };
    if (a.component === "wages") e.wages += a.amount; else e.fringe += a.amount;
    roll.set(key, e);
  }
  const toGrants = [...roll.values()].reduce((s, e) => s + e.wages + e.fringe, 0);

  // Group rows by department for display.
  const depts = new Map<string, PeriodEmployee[]>();
  for (const r of rows) { const k = `${r.department_code} ${r.department_name ?? ""}`.trim() || "(no department)"; depts.set(k, [...(depts.get(k) ?? []), r]); }

  return (
    <div className="space-y-6">
      <Crumbs items={[{ href: "/payroll", label: "Payroll" }, { label: `Pay date ${fmtDate(p.pay_date)}` }]} />
      <PageHeader eyebrow={`${p.provider} · ${p.source === "report_upload" ? "uploaded report" : p.source}`} title={`Pay run — ${fmtDate(p.pay_date)}`}
        sub={<span>Period {fmtDate(p.period_start)} – {fmtDate(p.period_end)} · {rows.length} rows · <StatusPill status={p.status} />{p.certified_at && <span> · certified {fmtDate(p.certified_at.slice(0, 10))}</span>}</span>}
        action={<div className="flex gap-3 text-sm items-center">
          {p.document_id && <a href={`/api/documents/${p.document_id}/download`} className="text-navy underline">Source report</a>}
          {isAdmin && !locked && <form action={deletePeriod}><input type="hidden" name="period_id" value={p.id} /><button className="text-accent underline">Delete run</button></form>}
        </div>} />
      <Flash error={sp.error} ok={sp.ok} />

      {/* Step 1: extraction footing */}
      <Card title="1 · Read from the report">
        <div className="grid gap-4 md:grid-cols-2">
          <table className="text-sm w-full">
            <thead className="text-left text-xs uppercase tracking-wide text-muted font-mono"><tr><th className="py-1">Check</th><th className="text-right">Rows</th><th className="text-right">Report total</th><th className="text-right">Difference</th></tr></thead>
            <tbody>
              {(ex.footing ?? []).map((f) => (
                <tr key={f.name} className="border-t border-line">
                  <td className="py-1">{f.name}</td><td className="text-right font-mono">{money(f.rows)}</td><td className="text-right font-mono">{money(f.report)}</td>
                  <td className={`text-right font-mono ${f.ok ? "text-good" : "text-accent"}`}>{f.difference == null ? "n/a" : money(f.difference)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-sm space-y-1">
            <p className="text-muted">Loaded cost this run: <span className="font-mono text-ink">{money(loaded)}</span> = wages {money(totals.wages)} + employer taxes {money(totals.taxes)} + benefits {money(totals.benefits)}. Reimbursements {money(totals.reimb)} are paid through payroll but are not wages. {totals.hours ? `${totals.hours.toFixed(2)} hours.` : ""}</p>
            {ex.model && <p className="text-xs text-muted">Read by {ex.model}{ex.cost_usd != null && ` · $${ex.cost_usd.toFixed(3)}`}</p>}
            {(ex.warnings ?? []).length > 0 && <ul className="text-xs list-disc pl-4 text-warn">{ex.warnings!.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            {(ex.footing ?? []).some((f) => !f.ok) && <p className="text-xs text-accent">Rows do not foot to the report. Fix the rows below (edit) or re-upload with a note for the reader.</p>}
          </div>
        </div>
      </Card>

      {/* Step 2: GL check */}
      <Card title="2 · Does QuickBooks agree?">
        {!p.gl_check ? <p className="text-sm text-muted">Not run yet.</p> : (
          <div className="grid gap-4 md:grid-cols-2">
            <table className="text-sm w-full">
              <thead className="text-left text-xs uppercase tracking-wide text-muted font-mono"><tr><th className="py-1">Component</th><th className="text-right">Report</th><th className="text-right">QuickBooks</th><th className="text-right">Difference</th></tr></thead>
              <tbody>
                {p.gl_check.components.map((c) => (
                  <tr key={c.name} className="border-t border-line">
                    <td className="py-1 capitalize">{c.name === "benefits" ? "Benefits / reimbursements (informational)" : c.name === "taxes" ? "Employer taxes" : "Wages"}</td>
                    <td className="text-right font-mono">{money(c.report)}</td><td className="text-right font-mono">{money(c.gl)}</td>
                    <td className={`text-right font-mono ${c.ok ? "text-good" : "text-accent"}`}>{money(c.difference)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-sm space-y-2">
              <p className="text-muted">Payroll-account lines dated {fmtDate(p.gl_check.window.from)} – {fmtDate(p.gl_check.window.to)}: {p.gl_check.lines.length}. Wages and employer taxes must tie within 0.5% (or $1) to certify without an explanation; benefits bills arrive on their own schedule and are informational.</p>
              {p.gl_note && <p><span className="text-muted">Explanation on file:</span> {p.gl_note}</p>}
              {p.gl_check.lines.length > 0 && (
                <details className="text-xs"><summary className="cursor-pointer text-navy">QuickBooks lines in the window</summary>
                  <table className="w-full mt-2"><tbody>
                    {p.gl_check.lines.map((l) => <tr key={l.id} className="border-t border-line"><td className="py-0.5 font-mono">{l.txn_date}</td><td>{l.txn_type} {l.txn_id}</td><td>{l.account_name}</td><td className="capitalize text-muted">{l.component}</td><td className="text-right font-mono">{money(l.amount)}</td></tr>)}
                  </tbody></table>
                </details>
              )}
            </div>
          </div>
        )}
        {can && !locked && <form action={runGlCheck} className="mt-3"><input type="hidden" name="period_id" value={p.id} /><button className={btnSecondary}>{p.gl_check ? "Re-run check" : "Run check"}</button></form>}
      </Card>

      {/* Step 3: benefits pool */}
      <Card title="3 · Employer-paid benefits outside payroll">
        <form action={setBenefitsPool} className="grid gap-3 md:grid-cols-[12rem_1fr_auto] items-end">
          <input type="hidden" name="period_id" value={p.id} />
          <label className={label}>Benefits to spread ($)<input name="benefits_pool" type="number" step="0.01" defaultValue={p.benefits_pool || ""} className={input} disabled={!can || locked} /></label>
          <label className={label}>Source<input name="benefits_note" defaultValue={p.benefits_note ?? ""} placeholder="e.g. Sept health insurance bill ÷ 2 runs" className={input} disabled={!can || locked} /></label>
          {can && !locked && <button className={btnSecondary}>Spread by wages</button>}
        </form>
        <p className="text-xs text-muted mt-2">Health insurance, workers&rsquo; comp and similar bills post to QuickBooks as vendor bills, not through payroll. Enter this run&rsquo;s share here and it is spread across employees in proportion to wages and allocated with their fringe. Leave at 0 to allocate employer taxes only.</p>
      </Card>

      {/* Step 4: people */}
      <Card title={<span>4 · People <span className="text-muted font-normal">· {rows.length} rows in {depts.size} departments</span></span>}>
        <div className="space-y-4">
          {[...depts.entries()].map(([dept, list]) => (
            <div key={dept}>
              <h3 className="text-xs uppercase tracking-wide text-muted font-mono mb-1">{dept}</h3>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted"><tr><th className="py-1">Employee</th><th className="text-right">Hours</th><th className="text-right">Wages</th><th className="text-right">Reimb.</th><th className="text-right">Empl. taxes</th><th className="text-right">Benefits</th><th className="text-right">Loaded</th><th>Allocation</th><th></th></tr></thead>
                <tbody>
                  {list.map((r) => {
                    const grants = r.allocations.filter((a) => a.grant_id && a.component === "wages");
                    const editing = sp.edit === r.id && can && !locked;
                    return (
                      <tr key={r.id} className="border-t border-line align-top">
                        <td className="py-1"><Link href={`/payroll/employees/${r.employee_id}`} className="text-navy underline">{r.employee.name}</Link><span className="text-muted text-xs"> #{r.employee.employee_no}{r.rate ? ` · $${r.rate}/h` : ""}</span>
                          {editing && (
                            <form action={savePeriodRow} className="mt-2 grid grid-cols-3 gap-2 text-xs w-[36rem] max-w-full">
                              <input type="hidden" name="period_id" value={p.id} /><input type="hidden" name="row_id" value={r.id} />
                              <label>Dept code<input name="department_code" defaultValue={r.department_code} className={input} /></label>
                              <label className="col-span-2">Dept name<input name="department_name" defaultValue={r.department_name ?? ""} className={input} /></label>
                              {([["hours_regular", "Hrs reg"], ["hours_overtime", "Hrs OT"], ["hours_other", "Hrs other"], ["wages_regular", "Wages reg"], ["wages_overtime", "Wages OT"], ["wages_other", "Wages other"], ["gross_wages", "Gross wages"], ["reimbursements", "Reimbursements"], ["employer_taxes", "Employer taxes"]] as const).map(([k, t]) => (
                                <label key={k}>{t}<input name={k} type="number" step="0.01" defaultValue={r[k]} className={input} /></label>
                              ))}
                              <div className="col-span-3 flex gap-2"><button className={btn}>Save row</button><Link href={`/payroll/${p.id}`} className={btnSecondary}>Cancel</Link></div>
                            </form>
                          )}
                        </td>
                        <td className="text-right font-mono">{(r.hours_regular + r.hours_overtime + r.hours_other).toFixed(2)}</td>
                        <td className="text-right font-mono">{money(r.gross_wages)}</td>
                        <td className="text-right font-mono text-muted">{r.reimbursements ? money(r.reimbursements) : "—"}</td>
                        <td className="text-right font-mono">{money(r.employer_taxes)}</td>
                        <td className="text-right font-mono text-muted">{r.benefits ? money(r.benefits) : "—"}</td>
                        <td className="text-right font-mono">{money(r.gross_wages + r.employer_taxes + r.benefits)}</td>
                        <td className="text-xs">{r.allocations.length === 0 ? <span className="text-muted">not drafted</span> : grants.length === 0 ? <span className="text-muted">unrestricted</span> : grants.map((a) => <span key={a.id} className="block">{grantLabel.get(a.grant_id!) ?? "Grant"} {pct(a.pct)}</span>)}</td>
                        <td className="text-xs">{can && !locked && !editing && <Link href={`/payroll/${p.id}?edit=${r.id}`} className="text-navy underline">edit</Link>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </Card>

      {/* Step 5: allocations */}
      <Card title="5 · Allocation">
        {can && !locked && (
          <form action={draftAllocations} className="mb-3 flex items-center gap-3 text-sm">
            <input type="hidden" name="period_id" value={p.id} />
            <button className={btn}>{p.status === "allocated" ? "Re-draft allocations" : "Draft allocations"}</button>
            <span className="text-muted">Each person&rsquo;s wages and fringe (employer taxes + benefits) are split by the profile in force on the pay date. Nothing is estimated.</span>
          </form>
        )}
        {rows.some((r) => r.allocations.length) ? (
          <div className="grid gap-4 md:grid-cols-2">
            <table className="text-sm w-full">
              <thead className="text-left text-xs uppercase tracking-wide text-muted font-mono"><tr><th className="py-1">Grant · line</th><th className="text-right">Wages</th><th className="text-right">Fringe</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {[...roll.values()].map((e, i) => <tr key={i} className="border-t border-line"><td className="py-1">{e.grant} <span className="text-muted">· {e.line}</span></td><td className="text-right font-mono">{money(e.wages)}</td><td className="text-right font-mono">{money(e.fringe)}</td><td className="text-right font-mono">{money(e.wages + e.fringe)}</td></tr>)}
                <tr className="border-t border-line text-muted"><td className="py-1">Unrestricted</td><td className="text-right font-mono">{money(unrestrictedW)}</td><td className="text-right font-mono">{money(unrestrictedF)}</td><td className="text-right font-mono">{money(unrestrictedW + unrestrictedF)}</td></tr>
              </tbody>
              <tfoot><tr className="border-t-2 border-line-strong font-medium"><td className="py-1">Loaded cost</td><td className="text-right font-mono">{money(totals.wages)}</td><td className="text-right font-mono">{money(totals.taxes + totals.benefits)}</td><td className="text-right font-mono">{money(loaded)}</td></tr></tfoot>
            </table>
            <div className="text-sm space-y-2">
              <p className="text-muted">To grants: <span className="font-mono text-ink">{money(toGrants)}</span> ({loaded ? ((toGrants / loaded) * 100).toFixed(1) : "0"}% of loaded cost).</p>
              {(ex.allocation_flags ?? []).length > 0 && (
                <div><p className="text-xs uppercase tracking-wide text-muted font-mono">Flags</p>
                  <ul className="text-xs list-disc pl-4 space-y-0.5">{ex.allocation_flags!.map((f, i) => <li key={i}><span className="font-medium">{f.employee}</span>: {f.message}</li>)}</ul></div>
              )}
            </div>
          </div>
        ) : <p className="text-sm text-muted">Not drafted yet.</p>}
      </Card>

      {/* Step 6: certify */}
      <Card title="6 · Certify">
        {locked ? (
          <div className="text-sm space-y-2">
            <p>Certified {fmtDate(p.certified_at?.slice(0, 10))}. The allocations above are recorded against each grant&rsquo;s Salaries and Fringe lines.</p>
            {isAdmin && <form action={uncertifyPeriod}><input type="hidden" name="period_id" value={p.id} /><button className={btnSecondary}>Un-certify (admin)</button></form>}
          </div>
        ) : can ? (
          <form action={certifyPeriod} className="text-sm space-y-3">
            <input type="hidden" name="period_id" value={p.id} />
            {p.gl_check && !p.gl_check.ok && <label className={label}>Explain the QuickBooks difference<textarea name="gl_note" rows={2} defaultValue={p.gl_note ?? ""} className={input} placeholder="e.g. Sept 25 wages posted on Sept 26; benefits bill paid monthly" /></label>}
            <label className="flex items-start gap-2"><input type="checkbox" name="attest" className="mt-1" /><span>I certify that this pay run was read correctly, that it ties to QuickBooks as shown or as explained, and that the allocation percentages reflect each person&rsquo;s actual effort for the period.</span></label>
            <button className={btn} disabled={p.status !== "allocated"}>Certify pay run</button>
            {p.status !== "allocated" && <p className="text-xs text-muted">Draft the allocations first.</p>}
          </form>
        ) : <p className="text-sm text-muted">Only administrators and the bookkeeper can certify.</p>}
      </Card>
    </div>
  );
}
