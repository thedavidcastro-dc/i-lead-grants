import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getGrant, currentBudget, db, money } from "@/lib/grants/data";
import { PageHeader, Card, Crumbs } from "@/components/ui";

export default async function GrantLinesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ line?: string }> }) {
  await requireProfile();
  const { id } = await params;
  const { line } = await searchParams;
  const grant = await getGrant(id);
  if (!grant) notFound();
  const current = await currentBudget(id);
  const g = await db();
  let q = g.from("allocations")
    .select("id, amount, budget_line_id, dispositions!inner(status, kind, decided_at, qbo_lines!inner(txn_date, txn_type, entity_name, description, account_id, amount))")
    .eq("grant_id", id).eq("dispositions.status", "approved");
  if (line) q = q.eq("budget_line_id", line);
  const { data } = await q;
  const { data: accts } = await g.from("qbo_accounts").select("id, name");
  const an = new Map((accts ?? []).map((a) => [a.id, a.name]));
  const lineName = new Map((current?.lines ?? []).map((l) => [l.id, l.category]));
  const rows = ((data ?? []) as unknown as Array<{ id: string; amount: number; budget_line_id: string | null; dispositions: { decided_at: string; qbo_lines: { txn_date: string; txn_type: string; entity_name: string | null; description: string | null; account_id: string | null; amount: number } } }>)
    .sort((a, b) => b.dispositions.qbo_lines.txn_date.localeCompare(a.dispositions.qbo_lines.txn_date));
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  return (
    <div className="space-y-6">
      <Crumbs items={[{ href: "/grants", label: "Grants" }, { href: `/grants/${id}`, label: grant.name }, { label: line ? `${lineName.get(line) ?? "Line"} charges` : "All charges" }]} />
      <PageHeader eyebrow="Grant" title={line ? `${lineName.get(line) ?? "Line"} — charged expenses` : "Charged expenses"} sub={`${rows.length} approved allocations · ${money(total)}`} />
      <Card>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted font-mono"><tr><th className="py-1">Date</th><th>Payee</th><th>Account</th><th>Memo</th><th>Budget line</th><th className="text-right">Line</th><th className="text-right">Charged</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="py-1 font-mono text-xs whitespace-nowrap">{r.dispositions.qbo_lines.txn_date}</td>
                <td>{r.dispositions.qbo_lines.entity_name}</td>
                <td className="text-muted">{r.dispositions.qbo_lines.account_id ? an.get(r.dispositions.qbo_lines.account_id) : ""}</td>
                <td className="max-w-xs truncate">{r.dispositions.qbo_lines.description}</td>
                <td>{r.budget_line_id ? lineName.get(r.budget_line_id) : <span className="text-muted">unassigned</span>}</td>
                <td className="text-right font-mono text-muted">{money(Number(r.dispositions.qbo_lines.amount))}</td>
                <td className="text-right font-mono">{money(Number(r.amount))}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="py-2 text-muted">No approved charges yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
