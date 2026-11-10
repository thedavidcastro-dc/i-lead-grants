import { requireAdmin } from "@/lib/auth";
import { getConnection } from "@/lib/qbo/connection";
import { createClient } from "@/lib/supabase/server";
import { QuickBooksActions } from "@/components/quickbooks-actions";

export default async function QuickBooksSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  await requireAdmin();
  const { connected, error } = await searchParams;
  const conn = await getConnection();
  const supabase = (await createClient()).schema("grants");
  const { data: runs } = await supabase
    .from("sync_runs")
    .select("id, kind, status, started_at, finished_at, stats, error")
    .order("started_at", { ascending: false })
    .limit(10);

  const fmt = (s: string | null) =>
    s ? new Date(s).toLocaleString("en-US", { timeZone: "America/New_York" }) : "—";

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <p className="text-xs tracking-[0.14em] uppercase text-accent font-mono">Settings</p>
        <h1 className="text-2xl font-semibold text-navy mt-1">QuickBooks connection</h1>
        <p className="text-muted text-sm mt-1">
          Read-only. The app pulls accounts, classes, vendors, employees and transactions; it never writes to the books.
        </p>
      </div>

      {connected && <p className="rounded border border-good/40 bg-green-50 px-4 py-2 text-sm">QuickBooks connected.</p>}
      {error && <p className="rounded border border-accent/40 bg-accent-soft px-4 py-2 text-sm">Connection problem: {error}</p>}

      <div className="rounded-md border border-line bg-panel p-5 space-y-3 text-sm">
        <dl className="grid grid-cols-[10rem_1fr] gap-y-1">
          <dt className="text-muted">Status</dt>
          <dd>
            {conn?.status === "connected" ? <span className="text-good">connected</span> : <span className="text-warn">{conn?.status ?? "not connected"}</span>}
          </dd>
          <dt className="text-muted">Company</dt>
          <dd>{conn?.company_name ?? "—"} {conn?.realm_id && <span className="font-mono text-xs text-muted">realm {conn.realm_id}</span>}</dd>
          <dt className="text-muted">Environment</dt>
          <dd>{conn?.environment ?? process.env.QBO_ENVIRONMENT ?? "sandbox"}</dd>
          <dt className="text-muted">Refresh token good until</dt>
          <dd>{fmt(conn?.refresh_expires_at ?? null)}</dd>
          <dt className="text-muted">Last error</dt>
          <dd>{conn?.last_error ?? "—"}</dd>
        </dl>
        <QuickBooksActions connected={conn?.status === "connected"} />
      </div>

      <div className="rounded-md border border-line bg-panel p-5">
        <p className="font-medium text-sm">Recent sync runs</p>
        <table className="w-full text-sm mt-3">
          <thead className="text-left text-xs uppercase tracking-wide text-muted font-mono">
            <tr><th className="py-1">Kind</th><th>Status</th><th>Started</th><th>Finished</th><th>Result</th></tr>
          </thead>
          <tbody>
            {(runs ?? []).map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="py-1">{r.kind}</td>
                <td className={r.status === "error" ? "text-accent" : r.status === "ok" ? "text-good" : ""}>{r.status}</td>
                <td>{fmt(r.started_at)}</td>
                <td>{fmt(r.finished_at)}</td>
                <td className="font-mono text-xs">{r.error ?? (r.stats ? JSON.stringify(r.stats) : "")}</td>
              </tr>
            ))}
            {!runs?.length && <tr><td colSpan={5} className="py-2 text-muted">None yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
