import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Line = {
  id: string; txn_type: string; txn_id: string; txn_date: string; amount: number; description: string | null;
  entity_name: string | null; account_id: string | null; class_id: string | null; is_expense: boolean; detail_type: string | null; deleted: boolean;
};

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; all?: string; q?: string }>;
}) {
  await requireProfile();
  const { month, all, q } = await searchParams;
  const supabase = (await createClient()).schema("grants");

  const [{ data: accounts }, { data: classes }, { data: months }] = await Promise.all([
    supabase.from("qbo_accounts").select("id, name"),
    supabase.from("qbo_classes").select("id, name"),
    supabase.from("qbo_lines").select("txn_date").eq("deleted", false).order("txn_date", { ascending: false }),
  ]);
  const acctName = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const className = new Map((classes ?? []).map((c) => [c.id, c.name]));
  const monthList = [...new Set((months ?? []).map((m) => String(m.txn_date).slice(0, 7)))];
  const selected = month ?? monthList[0];

  let query = supabase
    .from("qbo_lines")
    .select("id, txn_type, txn_id, txn_date, amount, description, entity_name, account_id, class_id, is_expense, detail_type, deleted")
    .eq("deleted", false)
    .order("txn_date", { ascending: false })
    .limit(500);
  if (!all) query = query.eq("is_expense", true);
  if (selected) query = query.gte("txn_date", `${selected}-01`).lt("txn_date", nextMonth(selected));
  if (q) query = query.or(`description.ilike.%${q}%,entity_name.ilike.%${q}%`);
  const { data } = await query;
  const lines = (data ?? []) as Line[];
  const total = lines.reduce((s, l) => s + Number(l.amount), 0);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs tracking-[0.14em] uppercase text-accent font-mono">Synced ledger</p>
        <h1 className="text-2xl font-semibold text-navy mt-1">Expenditure lines</h1>
        <p className="text-muted text-sm mt-1">
          One row per expense line as it appears in QuickBooks. Classification to grants arrives in the next bundle.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 text-sm">
        <label>
          <span className="text-muted">Month</span>
          <select name="month" defaultValue={selected} className="mt-1 block rounded border border-line-strong bg-paper px-2 py-1">
            {monthList.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>
          <span className="text-muted">Search</span>
          <input name="q" defaultValue={q ?? ""} placeholder="memo or payee" className="mt-1 block rounded border border-line-strong bg-paper px-2 py-1" />
        </label>
        <label className="flex items-center gap-2 pb-1">
          <input type="checkbox" name="all" value="1" defaultChecked={!!all} /> <span className="text-muted">include non-expense lines</span>
        </label>
        <button className="rounded bg-navy text-white px-3 py-1">Apply</button>
      </form>

      <div className="rounded-md border border-line bg-panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted font-mono">
            <tr>
              <th className="px-3 py-2">Date</th><th>Type</th><th>Payee / entity</th><th>Account</th><th>Class</th><th>Memo</th><th className="text-right pr-3">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-line align-top">
                <td className="px-3 py-1 whitespace-nowrap font-mono text-xs">{l.txn_date}</td>
                <td className="text-muted">{l.txn_type}</td>
                <td>{l.entity_name ?? <span className="text-muted">—</span>}</td>
                <td>{l.account_id ? acctName.get(l.account_id) ?? l.account_id : <span className="text-muted">{l.detail_type === "ItemBasedExpenseLineDetail" ? "item" : "—"}</span>}</td>
                <td className="text-muted">{l.class_id ? className.get(l.class_id) ?? l.class_id : ""}</td>
                <td className="max-w-md truncate">{l.description}</td>
                <td className="text-right pr-3 whitespace-nowrap">{money(Number(l.amount))}</td>
              </tr>
            ))}
            {lines.length === 0 && <tr><td colSpan={7} className="px-3 py-3 text-muted">No lines for this selection. An administrator can load transactions under Sync.</td></tr>}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-line-strong font-medium">
                <td className="px-3 py-2" colSpan={6}>{lines.length} lines{lines.length === 500 ? " (first 500)" : ""}</td>
                <td className="text-right pr-3 py-2">{money(total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
}
