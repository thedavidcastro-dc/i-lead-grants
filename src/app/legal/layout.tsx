import Link from "next/link";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto max-w-3xl px-4 h-14 flex items-center gap-6 text-sm">
          <span className="font-semibold text-navy">GrantBridge</span>
          <nav className="flex gap-4 text-muted">
            <Link href="/legal/terms" className="hover:text-ink">End User License Agreement</Link>
            <Link href="/legal/privacy" className="hover:text-ink">Privacy Policy</Link>
          </nav>
          <Link href="/login" className="ml-auto text-navy underline">Sign in</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 prose-legal">{children}</main>
      <footer className="border-t border-line text-xs text-muted px-4 py-4 text-center">
        Institute for Leadership Education Advancement (I-LEAD, Inc.) · 1122 County Line Rd, Bryn Mawr, PA 19010
      </footer>
    </div>
  );
}
