import { requireProfile } from "@/lib/auth";
import { listFunders } from "@/lib/grants/data";
import { saveFunder } from "@/lib/grants/actions";
import { PageHeader, Flash, Card, Field, btn, label, input } from "@/components/ui";

export default async function FundersPage({ searchParams }: { searchParams: Promise<{ error?: string; edit?: string }> }) {
  const me = await requireProfile();
  const { error, edit } = await searchParams;
  const funders = await listFunders();
  const editing = funders.find((f) => f.id === edit);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Grants" title="Funders" sub="One record per funder. Grants, instructions and templates hang off it." />
      <Flash error={error} />
      <div className="grid md:grid-cols-[1fr_22rem] gap-6 items-start">
        <Card title={`${funders.length} funders`}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted font-mono"><tr><th className="py-1">Name</th><th>Short</th><th>Contact</th><th></th></tr></thead>
            <tbody>
              {funders.map((f) => (
                <tr key={f.id} className="border-t border-line">
                  <td className="py-1.5">{f.name}</td><td className="text-muted">{f.short_name}</td>
                  <td className="text-muted">{f.contact_name}{f.contact_email && <> · {f.contact_email}</>}</td>
                  <td className="text-right">{me.role === "admin" && <a href={`/funders?edit=${f.id}`} className="text-navy underline">edit</a>}</td>
                </tr>
              ))}
              {funders.length === 0 && <tr><td colSpan={4} className="py-2 text-muted">No funders yet.</td></tr>}
            </tbody>
          </table>
        </Card>
        {me.role === "admin" && (
          <Card title={editing ? `Edit ${editing.name}` : "New funder"}>
            <form action={saveFunder} className="space-y-3">
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <Field name="name" title="Name" defaultValue={editing?.name} required placeholder="Pennsylvania Department of Education" />
              <Field name="short_name" title="Short name" defaultValue={editing?.short_name} placeholder="PDE" />
              <Field name="contact_name" title="Contact" defaultValue={editing?.contact_name} />
              <Field name="contact_email" title="Contact email" defaultValue={editing?.contact_email} type="email" />
              <label className={label}>Notes<textarea name="notes" defaultValue={editing?.notes ?? ""} rows={3} className={input} /></label>
              <div className="flex gap-2"><button className={btn}>{editing ? "Save" : "Add funder"}</button>{editing && <a href="/funders" className="text-sm text-muted underline self-center">cancel</a>}</div>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
