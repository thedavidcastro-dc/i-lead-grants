import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getGrant, listDocuments, listBudgetVersions, listFunders, db, money, fmtDate, DOC_KINDS, currentBudget } from "@/lib/grants/data";
import { uploadDocument, extractBudgetFromDocuments } from "@/lib/grants/actions";
import { GrantForm } from "@/components/grant-form";
import { PageHeader, Flash, Card, StatusPill, Crumbs, btn, btnSecondary, input, label } from "@/components/ui";

export const maxDuration = 300; // document extraction can take a minute

export default async function GrantPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; edit?: string }> }) {
  const me = await requireProfile();
  const { id } = await params;
  const { error, edit } = await searchParams;
  const grant = await getGrant(id);
  if (!grant) notFound();
  const [docs, versions, funders, g, current] = await Promise.all([listDocuments(id, grant.funder_id), listBudgetVersions(id), listFunders(), db(), currentBudget(id)]);
  const { data: classes } = await g.from("qbo_classes").select("id, name").eq("active", true).order("name");
  const lineIds = current?.lines.map((l) => l.id) ?? [];
  const [{ data: mapped }, { data: actuals }] = lineIds.length
    ? await Promise.all([g.from("budget_line_accounts").select("budget_line_id").in("budget_line_id", lineIds), g.from("budget_line_actuals").select("budget_line_id, allocated, allocation_count").in("budget_line_id", lineIds)])
    : [{ data: [] }, { data: [] }];
  const mappedLines = new Set((mapped ?? []).map((m) => m.budget_line_id));
  const actualBy = new Map((actuals ?? []).map((a) => [a.budget_line_id, { allocated: Number(a.allocated), n: Number(a.allocation_count) }]));
  const spentTotal = [...actualBy.values()].reduce((s, a) => s + a.allocated, 0);
  const isAdmin = me.role === "admin";
  const ind = grant.indirect_rule as { type?: string; rate?: number; base?: string };

  return (
    <div className="space-y-6">
      <Crumbs items={[{ href: "/grants", label: "Grants" }, { label: grant.name }]} />
      <PageHeader eyebrow={grant.funders?.name ?? "Grant"} title={grant.name}
        sub={<><StatusPill status={grant.status} /> <span className="ml-2">{grant.funding_type}</span>{grant.award_number && <> · #{grant.award_number}</>}{grant.program && <> · {grant.program}</>}</>}
        action={isAdmin && !edit ? <Link href={`/grants/${id}?edit=1`} className={btnSecondary}>Edit</Link> : undefined} />
      <Flash error={error} />

      {edit && isAdmin ? (
        <Card title="Edit grant"><GrantForm grant={grant} funders={funders} classes={classes ?? []} /><p className="mt-2 text-sm"><Link href={`/grants/${id}`} className="text-muted underline">cancel</Link></p></Card>
      ) : (
        <div className="grid md:grid-cols-4 gap-4">
          {[
            { k: "Award", v: money(grant.award_amount) },
            { k: "Cost period", v: `${grant.cost_period_start ?? "—"} → ${grant.cost_period_end ?? "—"}` },
            { k: "Funds received", v: money(grant.funds_received) },
            { k: "Indirect", v: ind.type === "rate" ? `${((ind.rate ?? 0) * 100).toFixed(2)}% of ${ind.base}` : "none" },
          ].map((t) => (
            <div key={t.k} className="rounded-md border border-line bg-panel p-4"><p className="text-xs uppercase tracking-wide text-muted font-mono">{t.k}</p><p className="text-lg font-semibold mt-1">{t.v}</p></div>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <Card title="Budget">
          {current ? (
            <div className="text-sm space-y-2">
              <p>Current approved budget: <span className="font-mono">{money(current.version.total)}</span> · {current.lines.length} lines · approved {fmtDate(current.version.approved_at)}
                {" "}· <Link href={`/grants/${id}/budget/${current.version.id}`} className="text-navy underline">view</Link></p>
              <table className="w-full">
                <thead className="text-left text-xs uppercase tracking-wide text-muted font-mono"><tr><th className="py-1">Line</th><th className="text-right">Budget</th><th className="text-right">Charged</th><th className="text-right">Remaining</th><th></th></tr></thead>
                <tbody>
                  {current.lines.map((l) => {
                    const a = actualBy.get(l.id) ?? { allocated: 0, n: 0 };
                    const remaining = Number(l.amount) - a.allocated;
                    return (
                      <tr key={l.id} className="border-t border-line">
                        <td className="py-1">{l.category}{!mappedLines.has(l.id) && <span className="text-warn text-xs"> · unmapped</span>}</td>
                        <td className="text-right font-mono whitespace-nowrap">{money(l.amount)}</td>
                        <td className="text-right font-mono whitespace-nowrap">{a.n > 0 ? <Link href={`/grants/${id}/lines?line=${l.id}`} className="text-navy underline">{money(a.allocated)}</Link> : <span className="text-muted">—</span>}</td>
                        <td className={`text-right font-mono whitespace-nowrap ${remaining < 0 ? "text-accent" : ""}`}>{money(remaining)}</td>
                        <td className="pl-2 w-24"><div className="h-1.5 rounded bg-line overflow-hidden"><div className={`h-full ${remaining < 0 ? "bg-accent" : "bg-navy"}`} style={{ width: `${Math.min(100, Number(l.amount) > 0 ? (a.allocated / Number(l.amount)) * 100 : 0)}%` }} /></div></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr className="border-t-2 border-line-strong font-medium"><td className="py-1">Total</td><td className="text-right font-mono">{money(current.version.total)}</td><td className="text-right font-mono">{money(spentTotal)}</td><td className="text-right font-mono">{money(Number(current.version.total ?? 0) - spentTotal)}</td><td></td></tr></tfoot>
              </table>
              <p className="flex gap-4"><Link href={`/grants/${id}/mapping`} className="text-navy underline">Account mapping</Link><Link href={`/grants/${id}/lines`} className="text-navy underline">All charged expenses</Link><Link href="/queue" className="text-navy underline">Classification queue</Link></p>
            </div>
          ) : (
            <p className="text-sm text-muted">No approved budget yet.</p>
          )}
          {versions.filter((v) => v.status !== "approved").length > 0 && (
            <div className="mt-4 text-sm">
              <p className="text-xs uppercase tracking-wide text-muted font-mono mb-1">Other versions</p>
              {versions.filter((v) => v.status !== "approved").map((v) => (
                <p key={v.id}><StatusPill status={v.status} /> <Link href={`/grants/${id}/budget/${v.id}`} className="text-navy underline ml-1">{v.kind} v{v.version_no}</Link> · {money(v.total)} · {fmtDate(v.created_at)}</p>
              ))}
            </div>
          )}
          {isAdmin && (
            <form action={extractBudgetFromDocuments} className="mt-5 border-t border-line pt-4 space-y-3 text-sm">
              <input type="hidden" name="grant_id" value={id} />
              <p className="font-medium">Extract a budget with Claude</p>
              <p className="text-muted">Pick the document(s) that contain the approved budget — the agreement and the application together work well. Creates an editable draft; nothing is approved until you say so.</p>
              <div className="space-y-1">
                {docs.filter((d) => d.storage_path).map((d) => (
                  <label key={d.id} className="flex items-center gap-2"><input type="checkbox" name="document_ids" value={d.id} /> <span>{d.title}</span> <span className="text-xs text-muted">({d.kind})</span></label>
                ))}
                {docs.length === 0 && <p className="text-muted">Upload a document first.</p>}
              </div>
              <label className={label}>Note for the extractor (optional)<input name="hint" className={input} placeholder="e.g. use the agreement's cost period, not the application's" /></label>
              <button className={btn} disabled={docs.length === 0}>Extract budget draft</button>
            </form>
          )}
        </Card>

        <Card title="Documents">
          <table className="w-full text-sm">
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-t border-line first:border-t-0">
                  <td className="py-1"><a href={`/api/documents/${d.id}/download`} className="text-navy underline" target="_blank">{d.title}</a>{!d.grant_id && <span className="text-xs text-muted"> (funder-level)</span>}</td>
                  <td className="text-muted text-xs">{DOC_KINDS.find((k) => k[0] === d.kind)?.[1] ?? d.kind}</td>
                  <td className="text-muted text-xs whitespace-nowrap">{fmtDate(d.uploaded_at)}</td>
                </tr>
              ))}
              {docs.length === 0 && <tr><td className="py-1 text-muted">None yet.</td></tr>}
            </tbody>
          </table>
          <form action={uploadDocument} className="mt-4 border-t border-line pt-4 space-y-3 text-sm" encType="multipart/form-data">
            <input type="hidden" name="grant_id" value={id} />
            <input type="hidden" name="funder_id" value={grant.funder_id} />
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>Kind
                <select name="kind" className={input} defaultValue={isAdmin ? "agreement" : "payroll_report"}>
                  {DOC_KINDS.filter((k) => isAdmin || k[0] === "payroll_report").map((k) => <option key={k[0]} value={k[0]}>{k[1]}</option>)}
                </select>
              </label>
              <label className={label}>Title (optional)<input name="title" className={input} /></label>
            </div>
            <input type="file" name="file" required className="text-sm" accept=".pdf,.docx,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.txt,.md" />
            <p className="text-xs text-muted">PDF, Word (.docx), Excel, CSV or images, up to 25 MB. Legacy .doc files: save as PDF or .docx first.</p>
            <button className={btnSecondary}>Upload</button>
          </form>
        </Card>
      </div>
    </div>
  );
}
