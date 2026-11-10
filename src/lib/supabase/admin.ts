import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env, publicEnv } from "@/lib/env";

/**
 * Service-role client for server-side jobs (sync, token storage).
 * Bypasses RLS — never import from client components, and always
 * check the caller's role before using it in a route handler.
 */
export function createAdminClient() {
  return createSupabaseClient(publicEnv.supabaseUrl, env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
