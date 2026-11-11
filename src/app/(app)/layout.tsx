import Link from "next/link";
import { requireProfile } from "@/lib/auth";

const nav = [
  { href: "/", label: "Overview" },
  { href: "/ledger", label: "Ledger" },
  { href: "/reference/accounts", label: "Accounts" },
  { href: "/reference/classes", label: "Classes" },
  { href: "/settings/sync", label: "Sync", admin: true },
  { href: "/settings/quickbooks", label: "QuickBooks", admin: true },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-6">
          <Link href="/" className="font-semibold text-navy">
            GrantBridge
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            {nav
              .filter((n) => !n.admin || profile.role === "admin")
              .map((n) => (
                <Link key={n.href} href={n.href} className="text-muted hover:text-ink">
                  {n.label}
                </Link>
              ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-muted">
              {profile.email} · <span className="font-mono text-xs uppercase">{profile.role}</span>
            </span>
            <form action="/auth/signout" method="post">
              <button className="text-navy underline">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 flex-1">{children}</main>
      <footer className="border-t border-line text-xs text-muted px-4 py-3 text-center">
        I-LEAD GrantBridge · QuickBooks is read, never written ·{" "}
        <a href="mailto:dc@i-leadusa.org?subject=GrantBridge%20support" className="text-navy underline">Support</a> ·{" "}
        <Link href="/legal/terms" className="underline">Terms</Link> · <Link href="/legal/privacy" className="underline">Privacy</Link>
      </footer>
    </div>
  );
}
