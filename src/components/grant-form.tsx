import { saveGrant } from "@/lib/grants/actions";
import { GRANT_STATUSES, type Funder, type Grant } from "@/lib/grants/data";
import { Field, btn, input, label } from "@/components/ui";

export function GrantForm({ grant, funders, classes }: { grant?: Grant | null; funders: Funder[]; classes: Array<{ id: string; name: string }> }) {
  const ind = (grant?.indirect_rule ?? { type: "none" }) as { type?: string; rate?: number; base?: string };
  return (
    <form action={saveGrant} className="space-y-4">
      {grant && <input type="hidden" name="id" value={grant.id} />}
      <div className="grid md:grid-cols-2 gap-4">
        <label className={label}>Funder
          <select name="funder_id" defaultValue={grant?.funder_id ?? ""} required className={input}>
            <option value="" disabled>Choose…</option>
            {funders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <Field name="name" title="Grant name" defaultValue={grant?.name} required placeholder="Job Training and Education Programs 2026–27" />
        <Field name="program" title="Program / project" defaultValue={grant?.program} placeholder="Good Jobs Program" />
        <Field name="award_number" title="Award / contract number" defaultValue={grant?.award_number} placeholder="4100102789" />
        <label className={label}>Status
          <select name="status" defaultValue={grant?.status ?? "prospect"} className={input}>
            {GRANT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className={label}>Funding type
          <select name="funding_type" defaultValue={grant?.funding_type ?? "reimbursement"} className={input}>
            <option value="reimbursement">Cost reimbursement (invoices)</option>
            <option value="advance">Advance (paid up front, expenditure reports)</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </label>
        <Field name="award_amount" title="Award amount ($)" type="number" defaultValue={grant?.award_amount} />
        <Field name="funds_received" title="Funds received to date ($)" type="number" defaultValue={grant?.funds_received ?? 0} />
        <Field name="cost_period_start" title="Cost period start" type="date" defaultValue={grant?.cost_period_start} />
        <Field name="cost_period_end" title="Cost period end" type="date" defaultValue={grant?.cost_period_end} />
        <label className={label}>Indirect cost rule
          <select name="indirect_type" defaultValue={ind.type ?? "none"} className={input}>
            <option value="none">None</option>
            <option value="rate">Rate on a base</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Field name="indirect_rate" title="Indirect rate (%)" type="number" defaultValue={ind.rate != null ? ind.rate * 100 : null} />
          <Field name="indirect_base" title="Base" defaultValue={ind.base ?? "mtdc"} placeholder="mtdc | total_direct | salaries" />
        </div>
        <label className={label}>QuickBooks class (hint)
          <select name="qbo_class_id" defaultValue={grant?.qbo_class_id ?? ""} className={input}>
            <option value="">—</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <label className={label}>Reporting obligations (JSON; the budget extraction fills this in when it can)
        <textarea name="reporting_json" rows={3} defaultValue={JSON.stringify(grant?.reporting ?? [], null, 0)} className={`${input} font-mono text-xs`} />
      </label>
      <label className={label}>Notes<textarea name="notes" rows={3} defaultValue={grant?.notes ?? ""} className={input} /></label>
      <button className={btn}>{grant ? "Save grant" : "Create grant"}</button>
    </form>
  );
}
