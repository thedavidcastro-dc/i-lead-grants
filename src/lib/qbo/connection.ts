import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, encrypt } from "@/lib/crypto";
import { IntuitAuthError, refreshTokens, type TokenSet } from "@/lib/qbo/oauth";
import { qboEnv } from "@/lib/env";

/**
 * The single QuickBooks connection (grants.qbo_connection, id = 1).
 * Tokens are stored encrypted; only the service role reads this table.
 */
export type Connection = {
  realm_id: string;
  environment: "sandbox" | "production";
  status: "connected" | "disconnected" | "error";
  access_expires_at: string;
  refresh_expires_at: string;
  connected_at: string | null;
  connected_by: string | null;
  last_cdc_at: string | null;
  last_error: string | null;
  company_name: string | null;
};

const TABLE = "qbo_connection";

export async function getConnection(): Promise<Connection | null> {
  const db = createAdminClient().schema("grants");
  const { data, error } = await db
    .from(TABLE)
    .select(
      "realm_id, environment, status, access_expires_at, refresh_expires_at, connected_at, connected_by, last_cdc_at, last_error, company_name",
    )
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return (data as Connection | null) ?? null;
}

export async function saveTokens(
  realmId: string,
  tokens: TokenSet,
  opts: { connectedBy?: string; companyName?: string } = {},
) {
  const db = createAdminClient().schema("grants");
  const now = Date.now();
  const row = {
    id: 1,
    realm_id: realmId,
    environment: qboEnv().environment,
    status: "connected",
    access_token_enc: encrypt(tokens.access_token),
    refresh_token_enc: encrypt(tokens.refresh_token),
    access_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
    refresh_expires_at: new Date(now + tokens.x_refresh_token_expires_in * 1000).toISOString(),
    last_error: null,
    ...(opts.connectedBy ? { connected_by: opts.connectedBy, connected_at: new Date().toISOString() } : {}),
    ...(opts.companyName ? { company_name: opts.companyName } : {}),
  };
  const { error } = await db.from(TABLE).upsert(row, { onConflict: "id" });
  if (error) throw error;
}

export async function markDisconnected(reason?: string) {
  const db = createAdminClient().schema("grants");
  await db
    .from(TABLE)
    .update({ status: "disconnected", access_token_enc: null, refresh_token_enc: null, last_error: reason ?? null })
    .eq("id", 1);
}

/** A valid access token, refreshing (and persisting) when within 5 minutes of expiry. */
export async function getAccessToken(): Promise<{ token: string; realmId: string }> {
  const db = createAdminClient().schema("grants");
  const { data, error } = await db
    .from(TABLE)
    .select("realm_id, status, access_token_enc, refresh_token_enc, access_expires_at, refresh_expires_at")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "connected" || !data.refresh_token_enc) {
    throw new Error("QuickBooks is not connected.");
  }
  if (new Date(data.refresh_expires_at).getTime() < Date.now()) {
    await markDisconnected("Refresh token expired; reconnect QuickBooks.");
    throw new Error("QuickBooks refresh token expired; reconnect.");
  }
  const soon = Date.now() + 5 * 60 * 1000;
  if (data.access_token_enc && new Date(data.access_expires_at).getTime() > soon) {
    return { token: decrypt(data.access_token_enc), realmId: data.realm_id };
  }
  let fresh: TokenSet;
  try {
    fresh = await refreshTokens(decrypt(data.refresh_token_enc));
  } catch (e) {
    if (e instanceof IntuitAuthError && e.isInvalidGrant) {
      // The refresh token was revoked or expired on Intuit's side: stop trying, ask for a reconnect.
      await markDisconnected("QuickBooks authorization was revoked or expired; reconnect QuickBooks.");
    }
    throw e;
  }
  await saveTokens(data.realm_id, fresh);
  return { token: fresh.access_token, realmId: data.realm_id };
}

export async function getRefreshTokenForRevoke(): Promise<string | null> {
  const db = createAdminClient().schema("grants");
  const { data } = await db.from(TABLE).select("refresh_token_enc").eq("id", 1).maybeSingle();
  return data?.refresh_token_enc ? decrypt(data.refresh_token_enc) : null;
}
