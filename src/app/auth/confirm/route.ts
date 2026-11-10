import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Completes a magic-link sign-in. Handles both link styles Supabase can
 * send: token_hash + type (recommended for SSR) and the PKCE ?code= form.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  const supabase = await createClient();
  let errorMessage: string | null = null;

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    errorMessage = error?.message ?? null;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    errorMessage = error?.message ?? null;
  } else {
    errorMessage = "Missing sign-in token.";
  }

  const dest = new URL(url.origin);
  if (errorMessage) {
    dest.pathname = "/auth/error";
    dest.searchParams.set("message", errorMessage);
  } else {
    dest.pathname = next.startsWith("/") ? next : "/";
  }
  return NextResponse.redirect(dest);
}
