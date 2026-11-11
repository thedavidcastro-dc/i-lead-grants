import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MODELS } from "@/lib/ai/client";
import { PageHeader, Card } from "@/components/ui";

export default async function AiUsagePage() {
  await requireAdmin();
  const g = (await createClient()).schema("grants");
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const [{ data: calls }, { data: month }] = await Promise.all([
    g.from("ai_calls").select("id, at, task, model, input_tokens, output_tokens, cost_usd, status, entity, entity_id, user_id").order("at", { ascending: false }).limit(50),
    g.from("ai_calls").select("cost_usd, task").gte("at", monthStart.toISOString()),
  ]);
  const monthCost = (month ?? []).reduce((s, c) => s + Number(c.cost_usd ?? 0), 0);
  const byTask = new Map<string, number>();
  for (const c of month ?? []) byTask.set(c.task, (byTask.get(c.task) ?? 0) + Number(c.cost_usd ?? 0));
  const fmt = (s: string) => new Date(s).toLocaleString("en-US", { timeZone: "America/New_York" });

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader eyebrow="Settings" title="AI usage" sub="Every model call the app makes, with tokens and cost. Nothing a model produces is recorded without a person approving it." />
      <div className="grid md:grid-cols-3 gap-4">
        <div className="rounded-md border border-line bg-panel p-4"><p className="text-xs uppercase tracking-wide text-muted font-mono">This month</p><p className="text-3xl font-semibold mt-1">${monthCost.toFixed(2)}</p></div>
        <div className="rounded-md border border-line bg-panel p-4"><p className="text-xs uppercase tracking-wide text-muted font-mono">Calls this month</p><p className="text-3xl font-semibold mt-1">{(month ?? []).length}</p></div>
        <div className="rounded-md border border-line bg-panel p-4"><p className="text-xs uppercase tracking-wide text-muted font-mono">Models</p><p className="text-xs font-mono mt-2 text-muted">extract/draft: {MODELS.extract}<br />suggest: {MODELS.suggest}<br />proposal budgets: {MODELS.budget}</p></div>
      </div>
      {byTask.size > 0 && (
        <Card title="This month by task"><ul className="text-sm space-y-1">{[...byTask.entries()].map(([t, c]) => <li key={t} className="flex justify-between"><span>{t}</span><span className="font-mono">${c.toFixed(4)}</span></li>)}</ul></Card>
      )}
      <Card title="Recent calls">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted font-mono"><tr><th className="py-1">When</th><th>Task</th><th>Model</th><th className="text-right">In</th><th className="text-right">Out</th><th className="text-right">Cost</th><th>Status</th><th>Entity</th></tr></thead>
          <tbody>
            {(calls ?? []).map((c) => (
              <tr key={c.id} className="border-t border-line">
                <td className="py-1 whitespace-nowrap">{fmt(c.at)}</td><td>{c.task}</td><td className="font-mono text-xs">{c.model}</td>
                <td className="text-right font-mono">{c.input_tokens?.toLocaleString()}</td><td className="text-right font-mono">{c.output_tokens?.toLocaleString()}</td>
                <td className="text-right font-mono">${Number(c.cost_usd ?? 0).toFixed(4)}</td>
                <td className={c.status === "ok" ? "text-good" : "text-accent"}>{c.status}</td>
                <td className="text-xs text-muted">{c.entity} {c.entity_id?.slice(0, 8)}</td>
              </tr>
            ))}
            {!calls?.length && <tr><td colSpan={8} className="py-2 text-muted">No calls yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
