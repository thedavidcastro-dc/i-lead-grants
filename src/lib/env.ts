/** Server-side environment access with clear failures. */
export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
};

export const qboEnv = () => ({
  clientId: env("QBO_CLIENT_ID"),
  clientSecret: env("QBO_CLIENT_SECRET"),
  environment: (process.env.QBO_ENVIRONMENT ?? "sandbox") as "sandbox" | "production",
  redirectUri: process.env.QBO_REDIRECT_URI ?? `${publicEnv.siteUrl}/api/qbo/callback`,
});
