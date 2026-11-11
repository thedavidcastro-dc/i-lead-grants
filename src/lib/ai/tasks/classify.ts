import { runTask, text, z, MODELS, type ContentBlock } from "@/lib/ai/client";
import type { GrantContext, QueueLine } from "@/lib/classify/data";

export const ClassifySchema = z.object({
  results: z.array(z.object({
    line_id: z.string(),
    kind: z.enum(["grant", "unrestricted", "excluded"]),
    allocations: z.array(z.object({ grant_id: z.string(), budget_line_id: z.string().nullable(), amount: z.number() })),
    confidence: z.number().min(0).max(1),
    rationale: z.string(),
  })),
});
export type ClassifyResult = z.infer<typeof ClassifySchema>;

const jsonSchema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line_id: { type: "string" },
          kind: { type: "string", enum: ["grant", "unrestricted", "excluded"], description: "grant = chargeable to one or more grants; unrestricted = ordinary expense not charged to any grant; excluded = not an expense at all (transfer, reclass, reimbursement received, correction)" },
          allocations: {
            type: "array",
            description: "For kind=grant: one entry per grant charged, amounts summing to at most the line amount. Empty for unrestricted/excluded.",
            items: { type: "object", properties: { grant_id: { type: "string" }, budget_line_id: { type: ["string", "null"] }, amount: { type: "number" } }, required: ["grant_id", "budget_line_id", "amount"] },
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string", description: "One sentence a reviewer can check" },
        },
        required: ["line_id", "kind", "allocations", "confidence", "rationale"],
      },
    },
  },
  required: ["results"],
};

const SYSTEM = `You classify a nonprofit's expense lines (already recorded in QuickBooks) to its active grants, for a human to approve.
For each line decide: which grant and budget line it should be charged to (possibly split), or unrestricted (a normal expense no grant pays for), or excluded (not really an expense).
Use: the payee, memo, account, QuickBooks class (a program name — a strong hint about which grant's work this is), the date versus each grant's cost period, which accounts each budget line is mapped to, how much of each budget line remains, and how the same payee or account was decided before.
Rules:
- Only charge a grant for costs inside its cost period and on a budget line whose mapped accounts include this line's account (or whose description clearly covers it). Never exceed a line's remaining balance; if the cost would, allocate the remainder to unrestricted and say so.
- A line can be split across grants only when the memo or program context justifies it; otherwise pick one.
- Prior decisions for the same payee are strong evidence; the same account alone is weak evidence.
- Be honest about confidence: 0.9+ only when payee, account and class all point the same way; below 0.5 when guessing.
- Amounts are dollars; use the line amount unless splitting.`;

export async function suggestClassifications(lines: QueueLine[], grants: GrantContext[], history: Array<{ kind: string; qbo_lines: { entity_name: string | null; account_id: string | null; description: string | null }; allocations: Array<{ grant_id: string; budget_line_id: string | null }> }>, userId: string | null) {
  const grantBlock = grants.map((g) => ({
    grant_id: g.id, name: g.name, program: g.program, funder: g.funder, class_hint: g.class_name, cost_period: `${g.cost_period_start} → ${g.cost_period_end}`,
    budget_lines: g.lines.map((l) => ({ budget_line_id: l.id, category: l.category, description: l.description, budget: l.amount, allocated_so_far: l.allocated, remaining: l.amount - l.allocated, allowable: l.allowable, mapped_account_ids: l.account_ids })),
  }));
  const lineBlock = lines.map((l) => ({
    line_id: l.line_id, date: l.txn_date, type: l.txn_type, payee: l.entity_name, account_id: l.account_id, account: l.account_name, class: l.class_name, memo: l.description, amount: l.amount,
    flags: l.flags.map((f) => f.kind), previous_decision: l.kind ? { kind: l.kind, allocations: l.allocations } : undefined,
  }));
  const histBlock = history.slice(0, 120).map((h) => ({ payee: h.qbo_lines.entity_name, account_id: h.qbo_lines.account_id, memo: h.qbo_lines.description, decided: h.kind, allocations: h.allocations }));
  const content: ContentBlock[] = [
    text("Active grants and budget lines:\n" + JSON.stringify(grantBlock)),
    text("Earlier approved decisions for related payees/accounts:\n" + JSON.stringify(histBlock)),
    text("Lines to classify:\n" + JSON.stringify(lineBlock)),
    text("Return one result per line_id."),
  ];
  return runTask<ClassifyResult>({ task: "classify", model: MODELS.suggest, system: SYSTEM, content, schema: ClassifySchema, jsonSchema, entity: "queue", userId, maxTokens: 8000 });
}
