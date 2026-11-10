import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Row = {
  id: string; name: string; fully_qualified_name: string; active: boolean; parent_id: string | null;
  account_type: string; account_sub_type: string | null; classification: string | null; account_number: string | null;
};

export default async function AccountsPage() {
  await requireProfile();
  const supabase = (await createClient()).schema("grants");
  const { data } = await supabase
    .from("qbo_accounts")
    .select("id, name, fully_qualified_name, active, parent_id, account_type, account_sub_type, classification, account_number")
    .order("classification").order("fully_qualified_name");
  const rows = (data ?? []) as Row[];
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.classification ?? "Other";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs tracking-[0.14em] uppercase text-accent font-mono">Reference</p>
        <h1 className="text-2xl font-semibold text-navy mt-1">Chart of accounts</h1>
        <p className="text-muted text-sm mt-1">{rows.length} accounts as synced from QuickBooks. Budget lines map onto these.</p>
      </div>
      {rows.length === 0 && <p className="text-muted">Nothing synced yet. An administrator can run a sync under QuickBooks settings.</p>}
      {[...groups.entries()].map(([cls, list]) => (
        <section key={cls} className="rounded-md border border-line bg-panel">
          <h2 className="px-4 py-2 text-xs uppercase tracking-wide text-muted font-mono border-b border-line">{cls}</h2>
          <table className="w-full text-sm">
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className={`border-t border-line ${!a.active ? "text-muted" : ""}`}>
                  <td className="px-4 py-1 font-mono text-xs text-muted w-16">{a.account_number ?? a.id}</td>
                  <td className="py-1" style={{ paddingLeft: a.parent_id ? "1.5rem" : 0 }}>{a.name}{!a.active && " (inactive)"}</td>
                  <td className="py-1 text-muted">{a.account_type}</td>
                  <td className="py-1 text-muted pr-4">{a.account_sub_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
