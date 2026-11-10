import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getConnection } from "@/lib/qbo/connection";
import { createClient } from "@/lib/supabase/server";
import { SyncActions } from "@/components/sync-actions";

const fmt = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("en-US", { timeZone: "America/New_York" }) : "—";

export default async function SyncSettingsPage() {
  await requireAdmin();
  const conn = await getConnection();
  const supabase = (await createClient()).schema("grants");

  const [runs, txnCount, lineCount, expenseCount, openFlags, byMonth, conn2] = await Promise.all([
    supabase.from("sync_runs").select("id, kind, status, started_at, finished_at, stats, error").order("started_at", { ascending: false }).limit(15),
    supabase.from("qbo_transactions").select("id", { count: "exact", head: true }).eq("deleted", false),
    supabase.from("qbo_lines").select("id", { count: "exact", head: true }).eq("deleted", false),
    supabase.from("qbo_lines").select("id", { count: "exact", head: true }).eq("deleted", false).eq("is_expense", true),
    supabase.from("sync_flags").select("id", { count: "exact", head: true }).is("resolved_at", null),
    supabase.from("qbo_lines").select("txn_date, amount, is_expense").eq("deleted", false),
    supabase.from("qbo_connection").select("initial_load_from, initial_load_to, last_cdc_at").eq("id", 1).maybeSingle(),
  ]);

  const months = new Map<string, { lines: number; expense: number }>();
  for (const l of byMonth.data ?? []) {
    const m = String(l.txn_date).slice(0, 7);
    const cur = months.get(m) ?? { lines: 0, expense: 0 };
    cur.lines++;
    if (l.is_expense) cur.expense += Number(l.amount);
    months.set(m, cur);
  }
  const monthRows = [...months.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <p className="text-xs tracking-[0.14em] uppercase text-accent font-mono">Settings</p>
        <h1 className="text-2xl font-semibold text-navy mt-1">Sync</h1>
        <p className="text-muted text-sm mt-1">
          Expenditure transactions (expenses, checks, bills, vendor credits, journal entries) copied from QuickBooks. Read only.
          An hourly job pulls changes; use the buttons for a first load or to catch up.
        </p>
      </div>

      {conn?.status !== "connected" && (
        <p className="rounded border border-accent/40 bg-accent-soft px-4 py-2 text-sm">
          QuickBooks is not connected. <Link href="/settings/quickbooks" className="underline">Connect first.</Link>
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Transactions", value: txnCount.count ?? 0 },
          { label: "Lines", value: lineCount.count ?? 0 },
          { label: "Expense lines", value: expenseCount.count ?? 0 },
          { label: "Open flags", value: openFlags.count ?? 0, warn: (openFlags.count ?? 0) > 0 },
        ].map((t) => (
          <div key={t.label} className="rounded-md border border-line bg-panel p-4">
            <p className="text-xs uppercase tracking-wide text-muted font-mono">{t.label}</p>
            <p className={`text-3xl font-semibold mt-1 ${t.warn ? "text-accent" : ""}`}>{t.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-line bg-panel p-5 space-y-4">
        <dl className="grid grid-cols-[12rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted">Loaded range</dt>
          <dd>{conn2.data?.initial_load_from ?? "—"} → {conn2.data?.initial_load_to ?? "—"}</dd>
          <dt className="text-muted">Last incremental sync</dt>
          <dd>{fmt(conn2.data?.last_cdc_at)}</dd>
        </dl>
        <SyncActions defaultFrom="2026-07-01" />
      </div>

      {monthRows.length > 0 && (
        <div className="rounded-md border border-line bg-panel p-5">
          <p className="font-medium text-sm">Lines by month</p>
          <table className="w-full text-sm mt-3">
            <thead className="text-left text-xs uppercase tracking-wide text-muted font-mono">
              <tr><th className="py-1">Month</th><th className="text-right">Lines</th><th className="text-right">Expense total</th></tr>
            </thead>
            <tbody>
              {monthRows.map(([m, v]) => (
                <tr key={m} className="border-t border-line">
                  <td className="py-1 font-mono">{m}</td>
                  <td className="text-right">{v.lines.toLocaleString()}</td>
                  <td className="text-right">{v.expense.toLocaleString("en-US", { style: "currency", currency: "USD" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-md border border-line bg-panel p-5">
        <p className="font-medium text-sm">Recent runs</p>
        <table className="w-full text-sm mt-3">
          <thead className="text-left text-xs uppercase tracking-wide text-muted font-mono">
            <tr><th className="py-1">Kind</th><th>Status</th><th>Started</th><th>Finished</th><th>Result</th></tr>
          </thead>
          <tbody>
            {(runs.data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="py-1">{r.kind}</td>
                <td className={r.status === "error" ? "text-accent" : r.status === "ok" ? "text-good" : ""}>{r.status}</td>
                <td className="whitespace-nowrap">{fmt(r.started_at)}</td>
                <td className="whitespace-nowrap">{fmt(r.finished_at)}</td>
                <td className="font-mono text-xs break-all">{r.error ?? (r.stats ? JSON.stringify(r.stats) : "")}</td>
              </tr>
            ))}
            {!runs.data?.length && <tr><td colSpan={5} className="py-2 text-muted">None yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
