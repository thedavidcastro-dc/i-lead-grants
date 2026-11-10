import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function ClassesPage() {
  await requireProfile();
  const supabase = (await createClient()).schema("grants");
  const { data } = await supabase
    .from("qbo_classes")
    .select("id, name, fully_qualified_name, active, parent_id")
    .order("fully_qualified_name");
  const rows = data ?? [];
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <p className="text-xs tracking-[0.14em] uppercase text-accent font-mono">Reference</p>
        <h1 className="text-2xl font-semibold text-navy mt-1">Classes</h1>
        <p className="text-muted text-sm mt-1">Programs as tracked in QuickBooks. A strong hint for classification; never a substitute for a grant.</p>
      </div>
      <div className="rounded-md border border-line bg-panel">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={`border-t border-line first:border-t-0 ${!c.active ? "text-muted" : ""}`}>
                <td className="px-4 py-1 font-mono text-xs text-muted w-16">{c.id}</td>
                <td className="py-1" style={{ paddingLeft: c.parent_id ? "1.5rem" : 0 }}>{c.name}{!c.active && " (inactive)"}</td>
                <td className="py-1 pr-4 text-muted">{c.fully_qualified_name}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="px-4 py-2 text-muted">Nothing synced yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
