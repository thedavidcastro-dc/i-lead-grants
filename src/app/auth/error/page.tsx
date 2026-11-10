import Link from "next/link";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="max-w-md rounded-md border border-line bg-panel p-6">
        <h1 className="text-xl font-semibold text-navy">Sign-in didn&apos;t complete</h1>
        <p className="text-sm text-muted mt-2">{message ?? "The link may have expired or already been used."}</p>
        <p className="text-sm text-muted mt-2">
          If your email hasn&apos;t been invited yet, an administrator needs to add it first.
        </p>
        <Link href="/login" className="inline-block mt-4 text-navy underline">
          Request a new link
        </Link>
      </div>
    </main>
  );
}
