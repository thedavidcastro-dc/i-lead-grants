import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getGrant, getBudgetVersion, money, fmtDate } from "@/lib/grants/data";
import { saveBudgetLines, approveBudgetVersion } from "@/lib/grants/actions";
import { PageHeader, Flash, Card, StatusPill, Crumbs, btn, btnSecondary, input, label } from "@/components/ui";

export default async function BudgetVersionPage({ params, searchParams }: { params: Promise<{ id: string; versionId: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const me = await requireProfile();
  const { id, versionId } = await params;
  const { error, saved } = await searchParams;
  const grant = await getGrant(id);
  const bv = await getBudgetVersion(versionId);
  if (!grant || !bv || bv.version.grant_id !== id) notFound();
  const { version, lines } = bv;
  const editable = me.role === "admin" && version.status === "draft";
  const ex = (version.extraction ?? {}) as Record<string, unknown>;
  const warnings = (ex.warnings as string[] | undefined) ?? [];
  const total = lines.reduce((s, l) => s + Number(l.amount), 0);

  return (
    <div className="space-y-6">
      <Crumbs items={[{ href: "/grants", label: "Grants" }, { href: `/grants/${id}`, label: grant.name }, { label: `Budget ${version.kind} v${version.version_no}` }]} />
      <PageHeader eyebrow="Budget" title={`${version.kind} v${version.version_no}`}
        sub={<><StatusPill status={version.status} /> <span className="ml-2">{money(total)} across {lines.length} lines</span>{version.approved_at && <> · approved {fmtDate(version.approved_at)}</>}{version.notes && <> · {version.notes}</>}</>} />
      <Flash error={error} ok={saved ? "Saved." : undefined} />

      {(warnings.length > 0 || ex.award_amount != null) && (
        <Card title="What the extractor found">
          <dl className="grid grid-cols-[12rem_1fr] gap-y-1 text-sm">
            {ex.funder_name != null && <><dt className="text-muted">Funder</dt><dd>{String(ex.funder_name)}</dd></>}
            {ex.program_title != null && <><dt className="text-muted">Program</dt><dd>{String(ex.program_title)}</dd></>}
            {ex.award_number != null && <><dt className="text-muted">Award number</dt><dd>{String(ex.award_number)}</dd></>}
            {ex.award_amount != null && <><dt className="text-muted">Award amount</dt><dd>{money(Number(ex.award_amount))}</dd></>}
            {(ex.cost_period_start != null || ex.cost_period_end != null) && <><dt className="text-muted">Cost period</dt><dd>{String(ex.cost_period_start ?? "?")} → {String(ex.cost_period_end ?? "?")}</dd></>}
            {ex.funding_type != null && <><dt className="text-muted">Funding type</dt><dd>{String(ex.funding_type)}</dd></>}
            {ex.indirect != null && <><dt className="text-muted">Indirect</dt><dd className="font-mono text-xs">{JSON.stringify(ex.indirect)}</dd></>}
            {ex.reporting != null && <><dt className="text-muted">Reporting</dt><dd className="font-mono text-xs">{JSON.stringify(ex.reporting)}</dd></>}
            {ex.cost_usd != null && <><dt className="text-muted">Extraction cost</dt><dd className="font-mono text-xs">${Number(ex.cost_usd).toFixed(4)} ({String(ex.model)})</dd></>}
          </dl>
          {warnings.length > 0 && (
            <div className="mt-3 rounded border border-accent/40 bg-accent-soft p-3 text-sm">
              <p className="font-medium mb-1">Reviewer warnings</p>
              <ul className="list-disc pl-5 space-y-1">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
        </Card>
      )}

      <Card title={editable ? "Review and edit lines" : "Lines"}>
        <form action={saveBudgetLines} className="space-y-3">
          <input type="hidden" name="version_id" value={versionId} />
          <input type="hidden" name="grant_id" value={id} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted font-mono">
                <tr><th className="py-1 pr-2">Category</th><th className="pr-2">Description</th><th className="pr-2 text-right">Amount</th><th className="pr-2">Allowable</th><th className="pr-2">Report row</th>{editable && <th>Delete</th>}</tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const detail = (l.detail ?? {}) as Record<string, unknown>;
                  return (
                    <tr key={l.id} className="border-t border-line align-top">
                      <td className="py-1 pr-2 min-w-40">
                        <input type="hidden" name="line_id" value={l.id} />
                        {editable ? <input name={`category_${l.id}`} defaultValue={l.category} className={input} /> : l.category}
                        {detail.source_note != null && <p className="text-xs text-muted mt-1">{String(detail.source_note)}</p>}
                      </td>
                      <td className="pr-2 min-w-64">
                        {editable ? <input name={`description_${l.id}`} defaultValue={l.description ?? ""} className={input} /> : l.description}
                        <LineDetail detail={detail} />
                      </td>
                      <td className="pr-2 text-right min-w-32">{editable ? <input name={`amount_${l.id}`} type="number" step="0.01" defaultValue={Number(l.amount)} className={`${input} text-right font-mono`} /> : <span className="font-mono">{money(l.amount)}</span>}</td>
                      <td className="pr-2">{editable ? <input type="checkbox" name={`allowable_${l.id}`} defaultChecked={l.allowable} className="mt-3" /> : (l.allowable ? "yes" : "no")}</td>
                      <td className="pr-2 min-w-28">{editable ? <input name={`report_row_${l.id}`} defaultValue={l.report_row ?? ""} placeholder="e.g. Other" className={input} /> : l.report_row}</td>
                      {editable && <td><input type="checkbox" name={`delete_${l.id}`} className="mt-3" /></td>}
                    </tr>
                  );
                })}
                {editable && (
                  <tr className="border-t-2 border-line-strong align-top">
                    <td className="py-1 pr-2"><input name="new_category" placeholder="Add a line…" className={input} /></td>
                    <td className="pr-2"><input name="new_description" className={input} /></td>
                    <td className="pr-2"><input name="new_amount" type="number" step="0.01" className={`${input} text-right font-mono`} /></td>
                    <td colSpan={3}></td>
                  </tr>
                )}
              </tbody>
              <tfoot><tr className="border-t-2 border-line-strong font-medium"><td className="py-2" colSpan={2}>Total</td><td className="text-right font-mono">{money(total)}</td><td colSpan={3}></td></tr></tfoot>
            </table>
          </div>
          {editable && <button className={btnSecondary}>Save changes</button>}
        </form>
        {editable && (
          <form action={approveBudgetVersion} className="mt-4 border-t border-line pt-4 flex flex-wrap items-end gap-3 text-sm">
            <input type="hidden" name="version_id" value={versionId} />
            <input type="hidden" name="grant_id" value={id} />
            <label className={label}>Effective date<input name="effective_date" type="date" defaultValue={grant.cost_period_start ?? ""} className={input} /></label>
            <button className={btn}>Approve as current budget</button>
            <span className="text-muted">Approving supersedes any earlier current budget and takes you to account mapping.</span>
          </form>
        )}
      </Card>
    </div>
  );
}

function LineDetail({ detail }: { detail: Record<string, unknown> }) {
  const personnel = detail.personnel as Array<{ name?: string; title?: string; effort_pct?: number; base_salary?: number; amount?: number }> | undefined;
  const components = detail.components as Array<{ name?: string; rate?: number; base?: string | number; amount?: number }> | undefined;
  const contracts = detail.contracts as Array<{ name?: string; amount?: number }> | undefined;
  if (!personnel && !components && !contracts) return null;
  return (
    <ul className="mt-1 text-xs text-muted space-y-0.5">
      {personnel?.map((p, i) => <li key={i}>{p.name ?? "?"}{p.title && ` (${p.title})`}{p.effort_pct != null && ` · ${(p.effort_pct * 100).toFixed(0)}% effort`}{p.base_salary != null && ` · base ${money(p.base_salary)}`}{p.amount != null && ` · ${money(p.amount)}`}</li>)}
      {components?.map((c, i) => <li key={i}>{c.name ?? "?"}{c.rate != null && ` · ${(c.rate * 100).toFixed(2)}%`}{c.base != null && ` of ${typeof c.base === "number" ? money(c.base) : c.base}`}{c.amount != null && ` · ${money(c.amount)}`}</li>)}
      {contracts?.map((c, i) => <li key={i}>{c.name ?? "?"}{c.amount != null && ` · ${money(c.amount)}`}</li>)}
    </ul>
  );
}
