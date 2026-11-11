import { runTask, text, z, type ContentBlock, MODELS } from "@/lib/ai/client";

/** Structured budget as extracted from a funder's approved budget / application. */
export const BudgetLineSchema = z.object({
  category: z.string().min(1),
  description: z.string().nullable().optional(),
  amount: z.number(),
  period_start: z.string().nullable().optional(),
  period_end: z.string().nullable().optional(),
  allowable: z.boolean().optional(),
  cap_rule: z.record(z.string(), z.unknown()).nullable().optional(),
  detail: z.record(z.string(), z.unknown()).nullable().optional(),
  source_note: z.string().nullable().optional(),
});
export const ExtractedBudgetSchema = z.object({
  award_amount: z.number().nullable().optional(),
  cost_period_start: z.string().nullable().optional(),
  cost_period_end: z.string().nullable().optional(),
  funder_name: z.string().nullable().optional(),
  award_number: z.string().nullable().optional(),
  program_title: z.string().nullable().optional(),
  funding_type: z.enum(["reimbursement", "advance", "hybrid", "unknown"]).optional(),
  indirect: z.object({ type: z.enum(["none", "rate", "unknown"]), rate: z.number().nullable().optional(), base: z.string().nullable().optional(), note: z.string().nullable().optional() }).optional(),
  reporting: z.array(z.object({ kind: z.enum(["invoice", "interim_report", "final_report", "other"]), due: z.string().nullable().optional(), every: z.string().nullable().optional(), note: z.string().nullable().optional() })).optional(),
  lines: z.array(BudgetLineSchema).min(1),
  total: z.number().nullable().optional(),
  warnings: z.array(z.string()).optional(),
});
export type ExtractedBudget = z.infer<typeof ExtractedBudgetSchema>;

const jsonSchema = {
  type: "object",
  properties: {
    award_amount: { type: ["number", "null"] },
    cost_period_start: { type: ["string", "null"], description: "YYYY-MM-DD" },
    cost_period_end: { type: ["string", "null"], description: "YYYY-MM-DD" },
    funder_name: { type: ["string", "null"] },
    award_number: { type: ["string", "null"] },
    program_title: { type: ["string", "null"] },
    funding_type: { type: "string", enum: ["reimbursement", "advance", "hybrid", "unknown"] },
    indirect: {
      type: "object",
      properties: { type: { type: "string", enum: ["none", "rate", "unknown"] }, rate: { type: ["number", "null"] }, base: { type: ["string", "null"] }, note: { type: ["string", "null"] } },
      required: ["type"],
    },
    reporting: {
      type: "array",
      items: { type: "object", properties: { kind: { type: "string", enum: ["invoice", "interim_report", "final_report", "other"] }, due: { type: ["string", "null"] }, every: { type: ["string", "null"] }, note: { type: ["string", "null"] } }, required: ["kind"] },
    },
    lines: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          category: { type: "string", description: "The funder's own category name, exactly as written (e.g. Salaries, Fringe Benefits, Contracted Services, Supplies, Travel, Other)" },
          description: { type: ["string", "null"] },
          amount: { type: "number", description: "Approved amount for the whole cost period, in dollars" },
          period_start: { type: ["string", "null"] },
          period_end: { type: ["string", "null"] },
          allowable: { type: "boolean" },
          cap_rule: { type: ["object", "null"], additionalProperties: true, description: "e.g. {\"max_pct_of_total\": 0.1} when the document states a cap" },
          detail: {
            type: ["object", "null"], additionalProperties: true,
            description: "Line-specific structure. Personnel: {\"personnel\":[{\"name\":..., \"title\":..., \"effort_pct\":0.59, \"base_salary\":..., \"amount\":...}]}. Fringe: {\"components\":[{\"name\":..., \"rate\":..., \"base\":..., \"amount\":...}]}. Contracted: {\"contracts\":[{\"name\":..., \"amount\":...}]}.",
          },
          source_note: { type: ["string", "null"], description: "Where in the document this came from, briefly" },
        },
        required: ["category", "amount"],
      },
    },
    total: { type: ["number", "null"] },
    warnings: { type: "array", items: { type: "string" }, description: "Anything inconsistent or ambiguous in the document that a reviewer should check" },
  },
  required: ["lines"],
};

const SYSTEM = `You are extracting a grant budget for a small nonprofit's grant-accounting system.
Read the document(s) and return the APPROVED budget as structured lines in the funder's own categories.
Rules:
- One line per funder category (and per sub-line when the document itemizes, e.g. each contract). Keep category names exactly as the funder writes them.
- Amounts are for the whole cost period, in dollars, as numbers. Include zero-dollar categories the funder lists.
- Put personnel names, titles, effort percentages (as decimals) and base salaries in detail.personnel; fringe components with rates in detail.components.
- Capture caps, allowability limits, indirect-cost rules and reporting obligations if the document states them; otherwise leave them null/unknown. Never invent a number that is not in the document.
- If the application and the agreement disagree (e.g. on the cost period), prefer the executed agreement and add a warning.
- Dates as YYYY-MM-DD.`;

export async function extractBudget(blocks: ContentBlock[], ctx: { grantId: string; userId: string | null; hint?: string }) {
  const content: ContentBlock[] = [
    ...blocks,
    text(`Extract the approved budget from the document(s) above.${ctx.hint ? ` Reviewer note: ${ctx.hint}` : ""}`),
  ];
  return runTask<ExtractedBudget>({
    task: "extract_budget", model: MODELS.extract, system: SYSTEM, content,
    schema: ExtractedBudgetSchema, jsonSchema, entity: "grant", entityId: ctx.grantId, userId: ctx.userId, maxTokens: 12000,
  });
}

/* ------------------------------------------------------------------ mapping */

export const MappingSchema = z.object({
  mappings: z.array(z.object({
    budget_line_id: z.string(),
    account_ids: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    rationale: z.string(),
  })),
});
export type Mapping = z.infer<typeof MappingSchema>;

const mappingJsonSchema = {
  type: "object",
  properties: {
    mappings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          budget_line_id: { type: "string" },
          account_ids: { type: "array", items: { type: "string" }, description: "QuickBooks account ids whose expenses feed this budget line; empty if none fits" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string" },
        },
        required: ["budget_line_id", "account_ids", "confidence", "rationale"],
      },
    },
  },
  required: ["mappings"],
};

const MAPPING_SYSTEM = `You map a funder's budget lines to the expense accounts in a nonprofit's QuickBooks chart of accounts.
Each budget line should list the accounts whose transactions would be charged against it. Use account ids exactly as given.
Typical patterns: Salaries → salary/wage accounts; Fringe → payroll tax, health, disability, workers comp, retirement, PTO accounts; Contracted services → consultant/contractor accounts; Supplies → supplies/materials; Travel → mileage, lodging, meals, parking, travel; Other → whatever the line describes.
An account may map to more than one line when the lines are distinguished by memo rather than account; say so in the rationale. Prefer a smaller, precise set over a broad one. Confidence reflects how certain the fit is.`;

export async function proposeMapping(
  lines: Array<{ id: string; category: string; description: string | null; amount: number; detail: unknown }>,
  accounts: Array<{ id: string; name: string; fully_qualified_name: string; account_type: string; account_sub_type: string | null }>,
  prior: Array<{ category: string; account_names: string[] }>,
  ctx: { grantId: string; userId: string | null },
) {
  const content: ContentBlock[] = [
    text("Budget lines:\n" + JSON.stringify(lines, null, 1)),
    text("Expense accounts (id, name, type):\n" + accounts.map((a) => `${a.id}\t${a.fully_qualified_name}\t${a.account_type}${a.account_sub_type ? "/" + a.account_sub_type : ""}`).join("\n")),
    text(prior.length ? "Mappings approved on earlier grants (category → accounts), reuse when they fit:\n" + JSON.stringify(prior) : "No earlier mappings."),
    text("Propose a mapping for every budget line."),
  ];
  return runTask<Mapping>({
    task: "map_lines", model: MODELS.extract, system: MAPPING_SYSTEM, content,
    schema: MappingSchema, jsonSchema: mappingJsonSchema, entity: "grant", entityId: ctx.grantId, userId: ctx.userId,
  });
}
