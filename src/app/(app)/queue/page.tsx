import Link from "next/link";
import { requireProfile, canClassify } from "@/lib/auth";
import { ensureDispositions, counts, grantContexts, queueLines, type QueueLine, type GrantContext } from "@/lib/classify/data";
import { approveSuggestions, setDisposition, reopenDisposition } from "@/lib/classify/actions";
import { SuggestButton } from "@/components/suggest-button";
import { PageHeader, Flash, Card, btn, btnSecondary, input } from "@/components/ui";

export const maxDuration = 120;
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ status?: string; month?: string; error?: string; ok?: string; band?: string }> }) {
  const me = await requireProfile();
  const sp = await searchParams;
  const status = (sp.status === "needs_review" || sp.status === "approved" ? sp.status : "pending") as "pending" | "needs_review" | "approved";
  if (status === "pending") await ensureDispositions();
  const [c, grants, lines] = await Promise.all([counts(), grantContexts(), queueLines(status, { month: sp.month, limit: 300 })]);
  const can = canClassify(me.role);
  const lineName = new Map<string, string>();
  const grantName = new Map<string, string>();
  for (const g of grants) { grantName.set(g.id, g.name); for (const l of g.lines) lineName.set(l.id, `${g.name} · ${l.category}`); }
  const targets = grants.flatMap((g) => g.lines.map((l) => ({ value: `${g.id}|${l.id}`, label: `${g.name} — ${l.category} (${money(l.amount - l.allocated)} left)` })));

  const band = (s: QueueLine) => !s.suggestion ? "none" : s.suggestion.confidence >= 0.85 ? "high" : s.suggestion.confidence >= 0.5 ? "medium" : "low";
  const groups: Record<string, QueueLine[]> = { high: [], medium: [], low: [], none: [] };
  for (const l of lines) groups[band(l)].push(l);
  const months = [...new Set(lines.map((l) => l.txn_date.slice(0, 7)))].sort().reverse();

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Classification" title="Expense queue"
        sub="Every synced expense line gets one disposition: a grant and budget line, unrestricted, or excluded. Claude suggests; a person approves. Payroll entries are routed to the payroll module automatically." />
      <Flash error={sp.error} ok={sp.ok} />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        {([["pending", "Pending", c.pending], ["needs_review", "Needs review", c.needs_review], ["approved", "Approved", c.approved]] as const).map(([k, label, n]) => (
          <Link key={k} href={`/queue?status=${k}`} className={`rounded-full px-3 py-1 border ${status === k ? "bg-navy text-white border-navy" : "border-line-strong text-muted"}`}>{label} <span className="font-mono">{n}</span></Link>
        ))}
        <span className="text-muted">· payroll (auto) <span className="font-mono">{c.payroll}</span></span>
        <form className="ml-auto flex items-center gap-2">
          <input type="hidden" name="status" value={status} />
          <select name="month" defaultValue={sp.month ?? ""} className={`${input} mt-0 w-auto`}><option value="">All months</option>{months.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          <button className={btnSecondary}>Filter</button>
        </form>
      </div>

      {status === "pending" && can && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SuggestButton unsuggested={c.unsuggested} />
            <p className="text-xs text-muted max-w-md">Suggestions use payee, memo, account, class, prior decisions and each budget line&rsquo;s remaining balance. About a cent per line.</p>
          </div>
        </Card>
      )}

      {grants.length === 0 && <Card><p className="text-sm text-muted">No active grant with an approved budget yet — approve a budget first.</p></Card>}

      {status !== "approved" ? (
        (["high", "medium", "low", "none"] as const).map((b) => groups[b].length === 0 ? null : (
          <Card key={b} title={<span>{{ high: "High confidence (≥ 85%)", medium: "Medium confidence (50–85%)", low: "Low confidence (< 50%)", none: "No suggestion yet" }[b]} <span className="text-muted font-normal">· {groups[b].length}</span></span>}>
            {b === "high" && can && (
              <form action={approveSuggestions} className="mb-3 flex items-center gap-3 text-sm">
                <input type="hidden" name="back" value={`/queue?status=${status}${sp.month ? `&month=${sp.month}` : ""}`} />
                {groups.high.map((l) => <input key={l.disposition_id} type="hidden" name="disposition_id" value={l.disposition_id} />)}
                <button className={btn}>Approve all {groups.high.length} high-confidence suggestions</button>
                <span className="text-muted">Each one is checked against cost periods and remaining balances before it is recorded.</span>
              </form>
            )}
            <div className="divide-y divide-line">
              {groups[b].map((l) => <Row key={l.disposition_id} l={l} can={can} targets={targets} lineName={lineName} grantName={grantName} grants={grants} status={status} month={sp.month} />)}
            </div>
          </Card>
        ))
      ) : (
        <Card title={`Approved · ${lines.length}${lines.length === 300 ? " (first 300)" : ""}`}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted font-mono"><tr><th className="py-1">Date</th><th>Payee</th><th>Account</th><th>Memo</th><th className="text-right">Amount</th><th>Disposition</th><th></th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.disposition_id} className="border-t border-line align-top">
                  <td className="py-1 font-mono text-xs whitespace-nowrap">{l.txn_date}</td><td>{l.entity_name}</td><td className="text-muted">{l.account_name}</td><td className="max-w-xs truncate">{l.description}</td>
                  <td className="text-right font-mono whitespace-nowrap">{money(l.amount)}</td>
                  <td className="text-xs">{l.kind === "grant" ? l.allocations.map((a, i) => <div key={i}>{lineName.get(a.budget_line_id ?? "") ?? grantName.get(a.grant_id)} · {money(a.amount)}</div>) : l.kind}</td>
                  <td>{me.role === "admin" && <form action={reopenDisposition}><input type="hidden" name="disposition_id" value={l.disposition_id} /><input type="hidden" name="back" value={`/queue?status=approved`} /><button className="text-navy underline text-xs">reopen</button></form>}</td>
                </tr>
              ))}
              {lines.length === 0 && <tr><td colSpan={7} className="py-2 text-muted">Nothing approved yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
      {status !== "approved" && lines.length === 0 && grants.length > 0 && <Card><p className="text-sm text-muted">Nothing here.</p></Card>}
    </div>
  );
}

function Row({ l, can, targets, lineName, grantName, grants, status, month }: {
  l: QueueLine; can: boolean; targets: Array<{ value: string; label: string }>; lineName: Map<string, string>; grantName: Map<string, string>; grants: GrantContext[]; status: string; month?: string;
}) {
  const s = l.suggestion;
  const back = `/queue?status=${status}${month ? `&month=${month}` : ""}`;
  const suggestedTarget = s?.kind === "grant" && s.allocations[0] ? `${s.allocations[0].grant_id}|${s.allocations[0].budget_line_id ?? ""}` : "";
  const outOfPeriod = grants.length > 0 && s?.kind === "grant" && s.allocations.some((a) => { const g = grants.find((x) => x.id === a.grant_id); return g && ((g.cost_period_start && l.txn_date < g.cost_period_start) || (g.cost_period_end && l.txn_date > g.cost_period_end)); });
  return (
    <div className="py-3 grid lg:grid-cols-[1fr_1fr] gap-4">
      <div className="text-sm">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-mono text-xs text-muted">{l.txn_date}</span>
          <span className="font-medium">{l.entity_name ?? <span className="text-muted">no payee</span>}</span>
          <span className="font-mono">{money(l.amount)}</span>
          <span className="text-muted text-xs">{l.txn_type}</span>
        </div>
        <div className="text-muted text-xs mt-0.5">{l.account_name}{l.class_name && <> · class {l.class_name}</>}</div>
        {l.description ? <div className="mt-1">{l.description}</div> : <div className="mt-1 text-xs text-warn">No memo — classify by payee and account.</div>}
        {l.flags.length > 0 && <div className="mt-1 text-xs text-accent">Changed in QuickBooks after it was {l.flags[0].kind.includes("report") ? "reported" : "classified"} — review again.</div>}
        {s && (
          <div className="mt-2 rounded border border-line bg-paper p-2 text-xs">
            <span className={`font-mono ${s.confidence >= 0.85 ? "text-good" : s.confidence >= 0.5 ? "text-warn" : "text-accent"}`}>{Math.round(s.confidence * 100)}%</span>{" "}
            <span className="font-medium">{s.kind === "grant" ? s.allocations.map((a) => `${lineName.get(a.budget_line_id ?? "") ?? grantName.get(a.grant_id) ?? "?"} ${money(a.amount)}`).join(" + ") : s.kind}</span>
            {outOfPeriod && <span className="text-accent"> · outside cost period</span>}
            <div className="text-muted mt-0.5">{s.rationale}</div>
          </div>
        )}
      </div>
      {can && (
        <div className="space-y-2">
          {s && (
            <form action={approveSuggestions} className="flex gap-2">
              <input type="hidden" name="disposition_id" value={l.disposition_id} /><input type="hidden" name="back" value={back} />
              <button className={btn}>Approve suggestion</button>
            </form>
          )}
          <form action={setDisposition} className="grid grid-cols-[7rem_1fr_7rem] gap-2 items-end text-sm">
            <input type="hidden" name="disposition_id" value={l.disposition_id} /><input type="hidden" name="back" value={back} />
            <select name="kind" defaultValue={s?.kind ?? "grant"} className={`${input} mt-0`}><option value="grant">Grant</option><option value="unrestricted">Unrestricted</option><option value="excluded">Excluded</option></select>
            <select name="target_1" defaultValue={suggestedTarget} className={`${input} mt-0`}><option value="">— grant / line —</option>{targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
            <input name="amount_1" type="number" step="0.01" defaultValue={s?.allocations[0]?.amount ?? Math.abs(l.amount) * (l.amount < 0 ? -1 : 1)} className={`${input} mt-0 font-mono`} />
            <span className="text-xs text-muted self-center">split</span>
            <select name="target_2" defaultValue={s?.allocations[1] ? `${s.allocations[1].grant_id}|${s.allocations[1].budget_line_id ?? ""}` : ""} className={`${input} mt-0`}><option value="">— none —</option>{targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
            <input name="amount_2" type="number" step="0.01" defaultValue={s?.allocations[1]?.amount ?? ""} className={`${input} mt-0 font-mono`} />
            <input name="note" placeholder="note (optional)" className={`${input} mt-0 col-span-2`} />
            <button className={btnSecondary}>Save</button>
          </form>
        </div>
      )}
    </div>
  );
}
