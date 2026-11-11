import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { listGrants, money } from "@/lib/grants/data";
import { PageHeader, Flash, Card, StatusPill, btn } from "@/components/ui";

export default async function GrantsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const me = await requireProfile();
  const { error } = await searchParams;
  const grants = await listGrants();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Grants" title="Grants" sub="Every grant from prospect to closeout. Budgets, documents and mapping live on the grant record."
        action={me.role === "admin" ? <Link href="/grants/new" className={btn}>New grant</Link> : undefined} />
      <Flash error={error} />
      <Card>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted font-mono"><tr><th className="py-1">Grant</th><th>Funder</th><th>Status</th><th>Type</th><th className="text-right">Award</th><th>Period</th></tr></thead>
          <tbody>
            {grants.map((g) => (
              <tr key={g.id} className="border-t border-line">
                <td className="py-1.5"><Link href={`/grants/${g.id}`} className="text-navy underline">{g.name}</Link>{g.program && <span className="text-muted"> · {g.program}</span>}</td>
                <td>{g.funders?.name}</td>
                <td><StatusPill status={g.status} /></td>
                <td className="text-muted">{g.funding_type}</td>
                <td className="text-right font-mono">{money(g.award_amount)}</td>
                <td className="text-muted whitespace-nowrap">{g.cost_period_start ?? "—"} → {g.cost_period_end ?? "—"}</td>
              </tr>
            ))}
            {grants.length === 0 && <tr><td colSpan={6} className="py-2 text-muted">No grants yet. Add a funder, then a grant.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
