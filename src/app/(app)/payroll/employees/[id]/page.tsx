import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile, canClassify } from "@/lib/auth";
import { getEmployee, grantLineOptions, money, pct, fmtDate } from "@/lib/payroll/data";
import { saveEmployee, saveProfile, certifyProfile, deleteProfile } from "@/lib/payroll/actions";
import { PageHeader, Flash, Card, Crumbs, btn, btnSecondary, input, label } from "@/components/ui";

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const me = await requireProfile();
  const { id } = await params;
  const sp = await searchParams;
  const cur = await getEmployee(id);
  if (!cur) notFound();
  const { employee: e, profiles, history } = cur;
  const options = await grantLineOptions();
  const can = canClassify(me.role);
  const isAdmin = me.role === "admin";
  const lineLabel = new Map(options.map((o) => [o.line_id, `${o.grant_name} · ${o.category}`]));
  const grantName = new Map(options.map((o) => [o.grant_id, o.grant_name]));
  // Wages lines first (salary-ish), fringe lines second; both lists show every line so unusual budgets still work.
  const isFringe = (c: string) => /fringe|benefit/i.test(c);
  const wageOpts = [...options].sort((a, b) => Number(isFringe(a.category)) - Number(isFringe(b.category)));
  const fringeOpts = [...options].sort((a, b) => Number(isFringe(b.category)) - Number(isFringe(a.category)));
  const today = new Date().toISOString().slice(0, 10);
  const latest = profiles[0] ?? null;

  return (
    <div className="space-y-6">
      <Crumbs items={[{ href: "/payroll", label: "Payroll" }, { href: "/payroll/employees", label: "Employees" }, { label: e.name }]} />
      <PageHeader eyebrow={`Employee #${e.employee_no ?? "—"}`} title={e.name} sub={<span>{e.title ?? ""}{e.title && e.department_name ? " · " : ""}{e.department_name ?? ""}{e.pay_type ? ` · ${e.pay_type}` : ""}{!e.active && " · inactive"}</span>} />
      <Flash error={sp.error} ok={sp.ok} />

      <div className="grid gap-6 md:grid-cols-[1fr_1.4fr]">
        <div className="space-y-6">
          <Card title="Details">
            <form action={saveEmployee} className="space-y-3 text-sm">
              <input type="hidden" name="employee_id" value={e.id} />
              <label className={label}>Name<input name="name" defaultValue={e.name} className={input} disabled={!can} /></label>
              <label className={label}>Title<input name="title" defaultValue={e.title ?? ""} className={input} disabled={!can} /></label>
              <label className={label}>Pay type<select name="pay_type" defaultValue={e.pay_type ?? ""} className={input} disabled={!can}><option value="">—</option><option value="hourly">Hourly</option><option value="salary">Salary</option></select></label>
              <label className={label}>Notes<textarea name="notes" rows={2} defaultValue={e.notes ?? ""} className={input} disabled={!can} /></label>
              <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={e.active} disabled={!can} /> Active</label>
              {can && <button className={btnSecondary}>Save</button>}
            </form>
          </Card>

          <Card title="Pay history">
            {history.length === 0 ? <p className="text-sm text-muted">No pay runs yet.</p> : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted font-mono"><tr><th className="py-1">Pay date</th><th>Dept</th><th className="text-right">Wages</th><th className="text-right">Empl. taxes</th><th className="text-right">To grants</th></tr></thead>
                <tbody>{history.map((h, i) => (
                  <tr key={i} className="border-t border-line"><td className="py-1"><Link href={`/payroll/${h.period_id}`} className="text-navy underline">{fmtDate(h.pay_date)}</Link></td><td className="text-muted text-xs">{h.department_name}</td><td className="text-right font-mono">{money(h.gross_wages)}</td><td className="text-right font-mono">{money(h.employer_taxes)}</td><td className="text-right font-mono">{h.to_grants ? money(h.to_grants) : "—"}</td></tr>
                ))}</tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Allocation profiles">
            {profiles.length === 0 ? <p className="text-sm text-muted">No profile yet — all pay goes to unrestricted until one is added.</p> : (
              <div className="space-y-3">
                {profiles.map((p) => {
                  const grantSplits = p.splits.filter((s) => s.grant_id);
                  const rest = 1 - grantSplits.reduce((s, x) => s + x.pct, 0);
                  const live = p.effective_from <= today && (!p.effective_to || p.effective_to >= today);
                  return (
                    <div key={p.id} className={`rounded border px-3 py-2 text-sm ${live ? "border-navy/40" : "border-line"}`}>
                      <div className="flex flex-wrap justify-between gap-2">
                        <span>{fmtDate(p.effective_from)} → {p.effective_to ? fmtDate(p.effective_to) : "open"}{live && <span className="text-xs text-navy font-mono uppercase"> · in force</span>}</span>
                        <span className="text-xs">{p.certified_at ? <span className="text-good">certified {fmtDate(p.certified_at.slice(0, 10))}</span> : <span className="text-warn">not certified</span>}</span>
                      </div>
                      <ul className="mt-1 text-xs space-y-0.5">
                        {grantSplits.map((s, i) => <li key={i}><span className="font-mono">{pct(s.pct)}</span> {grantName.get(s.grant_id!) ?? "grant"} → {s.budget_line_id ? lineLabel.get(s.budget_line_id)?.split(" · ")[1] : "(no line)"}{s.fringe_line_id && <span className="text-muted"> · fringe → {lineLabel.get(s.fringe_line_id)?.split(" · ")[1]}</span>}</li>)}
                        <li className="text-muted"><span className="font-mono">{pct(Math.max(0, rest))}</span> unrestricted</li>
                      </ul>
                      {p.basis && <p className="text-xs text-muted mt-1">Basis: {p.basis}</p>}
                      {can && (!p.certified_at || isAdmin) && (
                        <div className="mt-2 flex gap-3 text-xs">
                          {!p.certified_at && <form action={certifyProfile} className="flex gap-2 items-center"><input type="hidden" name="profile_id" value={p.id} /><input type="hidden" name="employee_id" value={e.id} /><input name="basis" placeholder="basis, e.g. effort certification Nov 2026" defaultValue={p.basis ?? ""} className={`${input} mt-0 w-64`} /><button className={btnSecondary}>Certify</button></form>}
                          {isAdmin && <form action={deleteProfile}><input type="hidden" name="profile_id" value={p.id} /><input type="hidden" name="employee_id" value={e.id} /><button className="text-accent underline">delete</button></form>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {can && (
            <Card title="New profile">
              {options.length === 0 ? <p className="text-sm text-muted">No active grant with an approved budget yet.</p> : (
                <form action={saveProfile} className="space-y-3 text-sm">
                  <input type="hidden" name="employee_id" value={e.id} />
                  <div className="grid grid-cols-2 gap-3">
                    <label className={label}>Effective from<input name="effective_from" type="date" required defaultValue={latest ? "" : options[0]?.cost_period_start ?? ""} className={input} /></label>
                    <label className={label}>Effective to (optional)<input name="effective_to" type="date" className={input} /></label>
                  </div>
                  <p className="text-xs text-muted">Shares are percentages of this person&rsquo;s wages. Fringe (employer taxes and spread benefits) follows at the same percentage to the fringe line. What is left is unrestricted.</p>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="grid grid-cols-[6rem_1fr_1fr] gap-2 items-end">
                      <label className={label}>Share %<input name={`split_pct_${i}`} type="number" step="0.01" min="0" max="100" className={input} defaultValue={i === 0 && latest ? ((latest.splits.find((s) => s.grant_id)?.pct ?? 0) * 100 || "") : ""} /></label>
                      <label className={label}>Wages → grant · line
                        <select name={`split_target_${i}`} className={input} defaultValue={i === 0 && latest ? `${latest.splits[0]?.grant_id ?? ""}|${latest.splits[0]?.budget_line_id ?? ""}` : ""}>
                          <option value="">—</option>
                          {wageOpts.map((o) => <option key={o.line_id} value={`${o.grant_id}|${o.line_id}`}>{o.grant_name} · {o.category}</option>)}
                        </select>
                      </label>
                      <label className={label}>Fringe → line
                        <select name={`split_fringe_${i}`} className={input} defaultValue={i === 0 && latest?.splits[0]?.fringe_line_id ? `${latest.splits[0].grant_id}|${latest.splits[0].fringe_line_id}` : ""}>
                          <option value="">same as wages line</option>
                          {fringeOpts.map((o) => <option key={o.line_id} value={`${o.grant_id}|${o.line_id}`}>{o.grant_name} · {o.category}</option>)}
                        </select>
                      </label>
                    </div>
                  ))}
                  <label className={label}>Basis<input name="basis" className={input} placeholder="e.g. PDE application staffing plan; effort certification due quarterly" defaultValue={latest?.basis ?? ""} /></label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="certify" /> Certify now (the percentages are confirmed as actual effort)</label>
                  <button className={btn}>Save profile</button>
                  <p className="text-xs text-muted">Saving closes any open earlier profile the day before this one starts. Pay runs already certified are not changed.</p>
                </form>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
