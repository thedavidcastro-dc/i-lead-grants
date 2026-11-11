import Link from "next/link";

export function PageHeader({ eyebrow, title, sub, action }: { eyebrow: string; title: string; sub?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs tracking-[0.14em] uppercase text-accent font-mono">{eyebrow}</p>
        <h1 className="text-2xl font-semibold text-navy mt-1">{title}</h1>
        {sub && <p className="text-muted text-sm mt-1 max-w-2xl">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Flash({ error, ok }: { error?: string; ok?: string }) {
  if (!error && !ok) return null;
  return error
    ? <p className="rounded border border-accent/40 bg-accent-soft px-4 py-2 text-sm">{error}</p>
    : <p className="rounded border border-good/40 bg-green-50 px-4 py-2 text-sm">{ok}</p>;
}

export function Card({ title, children, className = "" }: { title?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-md border border-line bg-panel p-5 ${className}`}>
      {title && <h2 className="font-medium text-sm mb-3">{title}</h2>}
      {children}
    </section>
  );
}

export const input = "mt-1 w-full rounded border border-line-strong bg-paper px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy";
export const label = "block text-sm text-muted";
export const btn = "rounded bg-navy text-white px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50";
export const btnSecondary = "rounded border border-line-strong px-4 py-2 text-sm hover:bg-paper";

export function Field({ name, title, defaultValue, type = "text", required, placeholder, className = "" }: { name: string; title: string; defaultValue?: string | number | null; type?: string; required?: boolean; placeholder?: string; className?: string }) {
  return (
    <label className={`${label} ${className}`}>
      {title}
      <input name={name} type={type} defaultValue={defaultValue ?? ""} required={required} placeholder={placeholder} className={input} step={type === "number" ? "0.01" : undefined} />
    </label>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    prospect: "bg-line text-ink", proposed: "bg-navy-soft text-navy", awarded: "bg-navy-soft text-navy",
    active: "bg-green-50 text-good", closed: "bg-line text-muted", draft: "bg-accent-soft text-accent", approved: "bg-green-50 text-good", superseded: "bg-line text-muted",
  };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-mono uppercase tracking-wide ${tone[status] ?? "bg-line"}`}>{status}</span>;
}

export function Crumbs({ items }: { items: Array<{ href?: string; label: string }> }) {
  return (
    <nav className="text-sm text-muted flex flex-wrap gap-1">
      {items.map((c, i) => (
        <span key={i}>
          {c.href ? <Link href={c.href} className="hover:text-ink underline">{c.label}</Link> : <span className="text-ink">{c.label}</span>}
          {i < items.length - 1 && <span className="mx-1">/</span>}
        </span>
      ))}
    </nav>
  );
}
