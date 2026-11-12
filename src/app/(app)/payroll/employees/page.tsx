import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { listEmployees, grantLineOptions, pct, fmtDate } from "@/lib/payroll/data";
import { PageHeader, Flash, Card, Crumbs } from "@/components/ui";

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requireProfile();
  const sp = await searchParams;
  const [employees, options] = await Promise.all([listEmployees(), grantLineOptions()]);
  const grantName = new Map(options.map((o) => [o.grant_id, o.grant_name]));
  const active = employees.filter((e) => e.active), inactive = employees.filter((e) => !e.active);

  const Row = ({ e }: { e: (typeof employees)[number] }) => {
    const grantSplits = (e.profile?.splits ?? []).filter((s) => s.grant_id);
    const grantPct = grantSplits.reduce((s, x) => s + x.pct, 0);
    return (
      <tr className="border-t border-line">
        <td className="py-1.5"><Link href={`/payroll/employees/${e.id}`} className="text-navy underline">{e.name}</Link><span className="text-muted text-xs"> #{e.employee_no ?? "—"}</span></td>
        <td className="text-muted">{e.department_name ?? "—"}</td>
        <td className="text-xs">{!e.profile ? <span className="text-warn">no profile</span> : grantSplits.length === 0 ? <span className="text-muted">100% unrestricted</span> : grantSplits.map((s, i) => <span key={i} className="block">{grantName.get(s.grant_id!) ?? "grant"} {pct(s.pct)}</span>)}</td>
        <td className="text-right font-mono">{e.profile ? pct(1 - grantPct) : "—"}</td>
        <td className="text-xs">{e.profile ? <>from {fmtDate(e.profile.effective_from)}{e.profile.certified_at ? <span className="text-good"> · certified</span> : <span className="text-warn"> · not certified</span>}</> : ""}</td>
        <td className="text-xs text-muted">{e.last_seen_at ? fmtDate(e.last_seen_at.slice(0, 10)) : ""}</td>
      </tr>
    );
  };

  return (
    <div className="space-y-6">
      <Crumbs items={[{ href: "/payroll", label: "Payroll" }, { label: "Employees" }]} />
      <PageHeader eyebrow="Payroll" title="Employees & allocation profiles"
        sub="The roster comes from uploaded pay runs. Each person has a profile — the fixed percentages of their time charged to each grant, with effective dates — which the app applies to every run. Certify profiles when effort is confirmed." />
      <Flash error={sp.error} ok={sp.ok} />
      <Card title={<span>Active <span className="text-muted font-normal">· {active.length}</span></span>}>
        {active.length === 0 ? <p className="text-sm text-muted">Upload a pay run to build the roster.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted font-mono"><tr><th className="py-1">Employee</th><th>Department</th><th>Grant shares</th><th className="text-right">Unrestricted</th><th>Profile</th><th>Last paid</th></tr></thead>
            <tbody>{active.map((e) => <Row key={e.id} e={e} />)}</tbody>
          </table>
        )}
      </Card>
      {inactive.length > 0 && (
        <Card title={<span>Inactive <span className="text-muted font-normal">· {inactive.length}</span></span>}>
          <table className="w-full text-sm"><tbody>{inactive.map((e) => <Row key={e.id} e={e} />)}</tbody></table>
        </Card>
      )}
    </div>
  );
}
