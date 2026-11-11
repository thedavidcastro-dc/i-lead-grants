import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";

async function sendLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect("/login?error=Enter+your+email");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${publicEnv.siteUrl}/auth/confirm`, shouldCreateUser: true },
  });
  if (error) {
    // The shared sign-up trigger rejects uninvited emails; Supabase surfaces that as a generic DB error.
    const friendly = /database error saving new user/i.test(error.message)
      ? "This email hasn't been invited. Ask an administrator to add it, or sign in with your invited address."
      : error.message;
    redirect(`/login?error=${encodeURIComponent(friendly)}`);
  }
  redirect(`/login?sent=${encodeURIComponent(email)}`);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <p className="text-xs tracking-[0.14em] uppercase text-accent font-mono">I-LEAD</p>
          <h1 className="text-3xl font-semibold text-navy mt-1">GrantBridge</h1>
          <p className="text-muted mt-2 text-sm">Grant subledger. Invitation only.</p>
        </div>
        {sent ? (
          <div className="rounded-md border border-line bg-panel p-5">
            <p className="font-medium">Check your email</p>
            <p className="text-sm text-muted mt-1">
              A sign-in link was sent to <span className="font-mono">{sent}</span>. It expires in a few minutes.
            </p>
          </div>
        ) : (
          <form action={sendLink} className="rounded-md border border-line bg-panel p-5 space-y-4">
            <label className="block text-sm">
              <span className="text-muted">Email</span>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                className="mt-1 w-full rounded border border-line-strong bg-paper px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy"
              />
            </label>
            {error && <p className="text-sm text-accent">{error}</p>}
            <button className="w-full rounded bg-navy text-white py-2 font-medium hover:opacity-90">
              Email me a sign-in link
            </button>
            <p className="text-xs text-muted">
              Only invited addresses can sign in. Ask an administrator if yours isn&apos;t, or email{" "}
              <a href="mailto:dc@i-leadusa.org?subject=GrantBridge%20support" className="text-navy underline">support</a>.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
