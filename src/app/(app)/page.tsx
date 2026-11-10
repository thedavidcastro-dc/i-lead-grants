import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getConnection } from "@/lib/qbo/connection";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const profile = await requireProfile();
  const { denied } = await searchParams;
  const supabase = (await createClient()).schema("grants");

  const [accounts, classes, vendors, employees, lastRun] = await Promise.all([
    supabase.from("qbo_accounts").select("id", { count: "exact", head: true }),
    supabase.from("qbo_classes").select("id", { count: "exact", head: true }),
    supabase.from("qbo_vendors").select("id", { count: "exact", head: true }),
    supabase.from("qbo_employees").select("id", { count: "exact", head: true }),
    supabase.from("sync_runs").select("kind, status, started_at, finished_at, stats, error").order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const conn = profile.role === "admin" ? await getConnection() : null;

  const tiles = [
    { label: "Accounts", value: accounts.count ?? 0, href: "/reference/accounts" },
    { label: "Classes", value: classes.count ?? 0, href: "/reference/classes" },
    { label: "Vendors", value: vendors.count ?? 0 },
    { label: "Employees", value: employees.count ?? 0 },
  ];

  return (
    <div className="space-y-8">
      {denied && (
        <p className="rounded border border-accent/40 bg-accent-soft px-4 py-2 text-sm">
          That page is for administrators.
        </p>
      )}
      <div>
        <p className="text-xs tracking-[0.14em] uppercase text-accent font-mono">Phase 1 · foundation</p>
        <h1 className="text-2xl font-semibold text-navy mt-1">Overview</h1>
        <p className="text-muted text-sm mt-1">
          Reference data synced from QuickBooks. Grants, classification and reporting arrive in the next bundles.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-md border border-line bg-panel p-4">
            <p className="text-xs uppercase tracking-wide text-muted font-mono">{t.label}</p>
            <p className="text-3xl font-semibold mt-1">{t.value.toLocaleString()}</p>
            {t.href && (
              <Link href={t.href} className="text-sm text-navy underline mt-2 inline-block">
                View
              </Link>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-md border border-line bg-panel p-4 text-sm">
        <p className="font-medium">Last sync</p>
        {lastRun.data ? (
          <p className="text-muted mt-1">
            {lastRun.data.kind} · {lastRun.data.status} · started{" "}
            {new Date(lastRun.data.started_at).toLocaleString("en-US", { timeZone: "America/New_York" })}
            {lastRun.data.error && <span className="text-accent"> · {lastRun.data.error}</span>}
          </p>
        ) : (
          <p className="text-muted mt-1">No sync has run yet.</p>
        )}
        {profile.role === "admin" && (
          <p className="mt-2">
            QuickBooks:{" "}
            {conn?.status === "connected" ? (
              <span className="text-good">connected to {conn.company_name ?? conn.realm_id} ({conn.environment})</span>
            ) : (
              <span className="text-warn">not connected</span>
            )}{" "}
            · <Link href="/settings/quickbooks" className="text-navy underline">manage</Link>
          </p>
        )}
      </div>
    </div>
  );
}
