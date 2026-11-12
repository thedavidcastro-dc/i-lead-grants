import Link from "next/link";
import { requireProfile, canClassify } from "@/lib/auth";
import { listPeriods, listEmployees, money, fmtDate } from "@/lib/payroll/data";
import { uploadPayrollReport } from "@/lib/payroll/actions";
import { PageHeader, Flash, Card, StatusPill, btn, input, label } from "@/components/ui";

export const maxDuration = 300; // report extraction

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const me = await requireProfile();
  const sp = await searchParams;
  const [periods, employees] = await Promise.all([listPeriods(), listEmployees()]);
  const can = canClassify(me.role);
  const noProfile = employees.filter((e) => e.active && !e.profile).length;
  const uncertified = employees.filter((e) => e.profile && !e.profile.certified_at).length;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Payroll" title="Pay runs"
        sub="One upload per pay run. Claude reads the provider's labor-distribution report into a per-employee table; the app checks it against the payroll entries QuickBooks carries, splits each person by their allocation profile, and a person certifies the period."
        action={<Link href="/payroll/employees" className="text-navy underline text-sm">Employees &amp; allocation profiles →</Link>} />
      <Flash error={sp.error} ok={sp.ok} />

      {(noProfile > 0 || uncertified > 0) && (
        <p className="text-sm rounded border border-warn/40 bg-amber-50 px-4 py-2">
          {noProfile > 0 && <span>{noProfile} active employee{noProfile === 1 ? " has" : "s have"} no allocation profile (their pay goes to unrestricted). </span>}
          {uncertified > 0 && <span>{uncertified} profile{uncertified === 1 ? " is" : "s are"} not yet certified. </span>}
          <Link href="/payroll/employees" className="text-navy underline">Set up profiles</Link>
        </p>
      )}

      {can && (
        <Card title="Upload a pay run">
          <form action={uploadPayrollReport} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] items-end" encType="multipart/form-data">
            <label className={label}>Labor distribution / payroll register<input name="file" type="file" required accept=".pdf,.xlsx,.xls,.csv,image/*" className={`${input} file:mr-3 file:rounded file:border-0 file:bg-navy file:px-3 file:py-1 file:text-white`} /></label>
            <label className={label}>Note for the reader (optional)<input name="hint" className={input} placeholder="e.g. two employees share EE# 160 across departments" /></label>
            <button className={btn}>Upload and read</button>
          </form>
          <p className="text-xs text-muted mt-2">Paycor: Reports → Labor Distribution for the pay run (PDF or Excel). QuickBooks Payroll: Payroll Details report. About 10–20¢ per run to read. A certified run cannot be replaced; an uncertified one is replaced by a new upload for the same pay date.</p>
        </Card>
      )}

      <Card title={<span>Pay runs <span className="text-muted font-normal">· {periods.length}</span></span>}>
        {periods.length === 0 ? <p className="text-sm text-muted">No pay runs yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted font-mono"><tr><th className="py-1">Pay date</th><th>Period</th><th>Status</th><th className="text-right">People</th><th className="text-right">Wages</th><th className="text-right">Employer taxes</th><th className="text-right">To grants</th><th>QuickBooks</th></tr></thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="py-1.5"><Link href={`/payroll/${p.id}`} className="text-navy underline">{fmtDate(p.pay_date)}</Link>{p.label && <span className="text-muted"> · {p.label}</span>}</td>
                  <td className="text-muted">{fmtDate(p.period_start)} – {fmtDate(p.period_end)}</td>
                  <td><StatusPill status={p.status} /></td>
                  <td className="text-right font-mono">{p.employees}</td>
                  <td className="text-right font-mono">{money(p.wages)}</td>
                  <td className="text-right font-mono">{money(p.employer_taxes)}</td>
                  <td className="text-right font-mono">{p.to_grants ? money(p.to_grants) : <span className="text-muted">—</span>}</td>
                  <td className="text-xs">{!p.gl_check ? <span className="text-muted">not checked</span> : p.gl_check.ok ? <span className="text-good">ties</span> : <span className="text-accent">difference{p.gl_note ? " (explained)" : ""}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
