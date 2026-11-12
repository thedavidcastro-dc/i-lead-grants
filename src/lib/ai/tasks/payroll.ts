import { runTask, text, z, type ContentBlock, MODELS } from "@/lib/ai/client";

/**
 * Payroll report extraction: one pay run → per-employee, per-department rows.
 * Designed around Paycor's "Labor Distribution" report but written generically so the
 * QuickBooks Payroll "Payroll Details" export lands in the same shape.
 */

export const PayrollRowSchema = z.object({
  employee_no: z.string().min(1),
  name: z.string().min(1),
  department_code: z.string().nullable().optional(),
  department_name: z.string().nullable().optional(),
  rate: z.number().nullable().optional(),
  hours_regular: z.number().optional(),
  hours_overtime: z.number().optional(),
  hours_other: z.number().optional(),
  wages_regular: z.number().optional(),
  wages_overtime: z.number().optional(),
  wages_other: z.number().optional(),
  gross_wages: z.number(),
  reimbursements: z.number().optional(),
  employer_taxes: z.number(),
  employer_tax_detail: z.record(z.string(), z.number()).nullable().optional(),
  net_pay: z.number().nullable().optional(),
});
export const ExtractedPayrollSchema = z.object({
  provider: z.enum(["paycor", "quickbooks", "other"]),
  period_start: z.string(),
  period_end: z.string(),
  pay_date: z.string().nullable().optional(),
  employee_count: z.number().nullable().optional(),
  rows: z.array(PayrollRowSchema).min(1),
  company_totals: z.object({
    gross_wages: z.number().nullable().optional(),
    reimbursements: z.number().nullable().optional(),
    employer_taxes: z.number().nullable().optional(),
    employer_tax_detail: z.record(z.string(), z.number()).nullable().optional(),
    net_pay: z.number().nullable().optional(),
    hours: z.number().nullable().optional(),
  }),
  warnings: z.array(z.string()).optional(),
});
export type ExtractedPayroll = z.infer<typeof ExtractedPayrollSchema>;
export type PayrollRow = z.infer<typeof PayrollRowSchema>;

const money = { type: "number" };
const jsonSchema = {
  type: "object",
  properties: {
    provider: { type: "string", enum: ["paycor", "quickbooks", "other"] },
    period_start: { type: "string", description: "Pay period start, YYYY-MM-DD. If the report shows only the period end, assume a 14-day period." },
    period_end: { type: "string", description: "Pay period end, YYYY-MM-DD" },
    pay_date: { type: ["string", "null"], description: "Check/pay date, YYYY-MM-DD" },
    employee_count: { type: ["number", "null"] },
    rows: {
      type: "array", minItems: 1,
      items: {
        type: "object",
        properties: {
          employee_no: { type: "string", description: "Provider employee number (e.g. the EE# on Paycor), as a string" },
          name: { type: "string", description: "Exactly as printed, usually Last, First" },
          department_code: { type: ["string", "null"], description: "Department/class number heading the block, e.g. '141'" },
          department_name: { type: ["string", "null"], description: "Department/class name heading the block, e.g. 'Program Personnel - Reading'" },
          rate: { type: ["number", "null"], description: "Hourly rate when printed; null for salaried" },
          hours_regular: { ...money }, hours_overtime: { ...money },
          hours_other: { ...money, description: "PTO, sick, holiday and other coded hours" },
          wages_regular: { ...money }, wages_overtime: { ...money },
          wages_other: { ...money, description: "Taxable coded earnings: PTO, sick, retro, bonus, holiday. NOT reimbursements." },
          gross_wages: { ...money, description: "Taxable gross for this employee in this department: regular + overtime + other. Exclude non-taxable reimbursements (marked ‡ on Paycor: PhoneReimb, QSEHRA, mileage)." },
          reimbursements: { ...money, description: "Non-taxable reimbursements paid through payroll (‡ items). 0 if none." },
          employer_taxes: { ...money, description: "EMPLOYER liabilities only: Social Security employer (SOCER), Medicare employer (MEDER), state/federal unemployment (UNEPA, FUTA, SUTA). Never include employee withholdings (SOC, MED, FITWH, PA, PAEUC, local)." },
          employer_tax_detail: { type: ["object", "null"], additionalProperties: { type: "number" }, description: "Employer tax codes with amounts, e.g. {\"SOCER\": 93.00, \"MEDER\": 21.75, \"UNEPA\": 7.47}" },
          net_pay: { type: ["number", "null"] },
        },
        required: ["employee_no", "name", "gross_wages", "employer_taxes"],
      },
    },
    company_totals: {
      type: "object",
      description: "From the COMPANY TOTAL page / grand totals, used to verify the rows",
      properties: {
        gross_wages: { type: ["number", "null"], description: "Company taxable gross, excluding reimbursements" },
        reimbursements: { type: ["number", "null"] },
        employer_taxes: { type: ["number", "null"], description: "Total employer liability (e.g. the EMPLOYER LIABILITY total)" },
        employer_tax_detail: { type: ["object", "null"], additionalProperties: { type: "number" } },
        net_pay: { type: ["number", "null"] },
        hours: { type: ["number", "null"] },
      },
    },
    warnings: { type: "array", items: { type: "string" }, description: "Anything a reviewer should check: unreadable figures, employees without a department, totals that did not foot" },
  },
  required: ["provider", "period_start", "period_end", "rows", "company_totals"],
};

const SYSTEM = `You are reading a payroll register / labor distribution report for a small nonprofit's grant-accounting system.
Return every employee row on the report, one row per employee PER DEPARTMENT block (an employee coded to two departments appears twice, once under each heading, with that block's hours and wages).
Rules:
- Department headings look like "141 Program Personnel - Reading": code 141, name "Program Personnel - Reading". Carry the heading down to every employee listed under it until the next heading.
- gross_wages is TAXABLE gross: regular + overtime + coded taxable earnings (PTO, Sick, Retro, Bonus, Holiday). Non-taxable reimbursements (PhoneReimb, QSEHRA, mileage; marked ‡ on Paycor and printed outside the gross column) go in reimbursements, never in gross_wages.
- employer_taxes is the employer's cost only. On Paycor the TAXES column mixes employee withholdings (SOC, MED, FITWH, PA, PAEUC, city/local codes) with employer liabilities (SOCER, MEDER, UNEPA); include only the employer codes (anything ending in ER, plus unemployment: UNEPA, FUTA, SUTA, UNEMP).
- Use "Department Totals" and the "COMPANY TOTAL" page to check your work; if your rows do not foot to the company totals, re-read the rows rather than adjusting the totals, and add a warning if they still differ.
- Skip summary-only sections (taxable wages tables, net cash, tax impounds, direct-deposit banking). Never invent an employee or a number.
- Dates as YYYY-MM-DD. Numbers as plain numbers (no commas or $).`;

export async function extractPayroll(blocks: ContentBlock[], ctx: { userId: string | null; hint?: string; entityId?: string | null }) {
  const content: ContentBlock[] = [
    ...blocks,
    text(`Extract this pay run.${ctx.hint ? ` Reviewer note: ${ctx.hint}` : ""}`),
  ];
  const res = await runTask<ExtractedPayroll>({
    task: "extract_payroll", model: MODELS.extract, system: SYSTEM, content,
    schema: ExtractedPayrollSchema, jsonSchema, entity: "payroll_period", entityId: ctx.entityId ?? undefined, userId: ctx.userId, maxTokens: 24000,
  });
  return { ...res, checks: footingChecks(res.data) };
}

export type FootingCheck = { name: string; rows: number; report: number | null; difference: number | null; ok: boolean };

/** Compare the sum of the rows with the company totals the report prints. Tolerance $1 (rounding across 30+ rows). */
export function footingChecks(ex: ExtractedPayroll): FootingCheck[] {
  const sum = (f: (r: PayrollRow) => number | null | undefined) => round2(ex.rows.reduce((s, r) => s + (f(r) ?? 0), 0));
  const mk = (name: string, rows: number, report: number | null | undefined): FootingCheck => {
    const rep = report ?? null;
    const diff = rep == null ? null : round2(rows - rep);
    return { name, rows, report: rep, difference: diff, ok: diff == null ? true : Math.abs(diff) <= 1 };
  };
  return [
    mk("Gross wages", sum((r) => r.gross_wages), ex.company_totals.gross_wages),
    mk("Reimbursements", sum((r) => r.reimbursements), ex.company_totals.reimbursements),
    mk("Employer taxes", sum((r) => r.employer_taxes), ex.company_totals.employer_taxes),
    mk("Net pay", sum((r) => r.net_pay), ex.company_totals.net_pay),
  ];
}

export function round2(n: number) { return Math.round(n * 100) / 100; }
