import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getGrant, currentBudget, db, money } from "@/lib/grants/data";
import { proposeAccountMapping, saveAccountMapping } from "@/lib/grants/actions";
import { PageHeader, Flash, Card, Crumbs, btn, btnSecondary } from "@/components/ui";

export const maxDuration = 300; // document extraction can take a minute

export default async function MappingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string; proposed?: string }> }) {
  const me = await requireProfile();
  const { id } = await params;
  const { error, saved, proposed } = await searchParams;
  const grant = await getGrant(id);
  if (!grant) notFound();
  const current = await currentBudget(id);
  const g = await db();
  const { data: accounts } = await g.from("qbo_accounts").select("id, name, fully_qualified_name, account_type, account_sub_type, parent_id").eq("classification", "Expense").eq("active", true).order("fully_qualified_name");
  const lineIds = current?.lines.map((l) => l.id) ?? [];
  const { data: existing } = lineIds.length ? await g.from("budget_line_accounts").select("budget_line_id, account_id").in("budget_line_id", lineIds) : { data: [] };
  const chosen = new Map<string, Set<string>>();
  for (const e of existing ?? []) chosen.set(e.budget_line_id, (chosen.get(e.budget_line_id) ?? new Set()).add(e.account_id));
  const acctName = new Map((accounts ?? []).map((a) => [a.id, a.fully_qualified_name]));
  const isAdmin = me.role === "admin";

  return (
    <div className="space-y-6">
      <Crumbs items={[{ href: "/grants", label: "Grants" }, { href: `/grants/${id}`, label: grant.name }, { label: "Account mapping" }]} />
      <PageHeader eyebrow="Budget" title="Account mapping" sub="Which QuickBooks expense accounts feed each budget line. This is the contract classification runs on, so it is always human-approved." />
      <Flash error={error} ok={saved ? "Mapping saved." : proposed ? "Proposal ready — review the suggestions below, adjust, and save." : undefined} />
      {!current ? (
        <Card><p className="text-sm text-muted">Approve a budget first.</p></Card>
      ) : (
        <>
          {isAdmin && (
            <form action={proposeAccountMapping} className="flex items-center gap-3 text-sm">
              <input type="hidden" name="grant_id" value={id} />
              <button className={btnSecondary}>Ask Claude to propose a mapping</button>
              <span className="text-muted">Uses your chart of accounts and mappings approved on other grants. Suggestions are pre-ticked below; nothing is saved until you click Save.</span>
            </form>
          )}
          <form action={saveAccountMapping} className="space-y-4">
            <input type="hidden" name="grant_id" value={id} />
            {current.lines.map((l) => {
              const picked = chosen.get(l.id);
              const suggested = l.suggested_accounts ?? [];
              const suggestedIds = new Set(suggested.map((s) => s.account_id));
              const useSuggestion = !picked || picked.size === 0;
              return (
                <Card key={l.id} title={<span>{l.category}{l.description && <span className="text-muted font-normal"> · {l.description}</span>} <span className="font-mono text-muted ml-2">{money(l.amount)}</span></span>}>
                  <input type="hidden" name="line_id" value={l.id} />
                  {suggested.length > 0 && (
                    <p className="text-xs text-muted mb-2">Claude suggests: {suggested.map((s) => acctName.get(s.account_id) ?? s.account_id).join(", ")} · confidence {(suggested[0].confidence * 100).toFixed(0)}% · {suggested[0].rationale}</p>
                  )}
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 text-sm max-h-64 overflow-y-auto pr-2">
                    {(accounts ?? []).map((a) => {
                      const on = useSuggestion ? suggestedIds.has(a.id) : picked!.has(a.id);
                      return (
                        <label key={a.id} className={`flex items-start gap-2 ${a.parent_id ? "pl-4" : ""}`}>
                          <input type="checkbox" name={`accounts_${l.id}`} value={a.id} defaultChecked={on} disabled={!isAdmin} className="mt-1" />
                          <span className={suggestedIds.has(a.id) ? "text-navy" : ""}>{a.name}<span className="text-xs text-muted"> {a.account_sub_type ?? a.account_type}</span></span>
                        </label>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
            {isAdmin && <button className={btn}>Save mapping</button>}
          </form>
        </>
      )}
    </div>
  );
}
