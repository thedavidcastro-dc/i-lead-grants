import { qboEnv } from "@/lib/env";
import { getDiscovery } from "@/lib/qbo/discovery";

/** Read-only subledger: accounting scope only. */
export const SCOPES = ["com.intuit.quickbooks.accounting"];

export type TokenSet = {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  x_refresh_token_expires_in: number; // seconds
  token_type: string;
};

export class IntuitAuthError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string, public readonly tid?: string) {
    super(message);
    this.name = "IntuitAuthError";
  }
  /** True when the refresh token itself is dead (expired/revoked) — reconnect required, retrying is pointless. */
  get isInvalidGrant() {
    return this.code === "invalid_grant";
  }
}

export async function buildAuthorizeUrl(state: string): Promise<string> {
  const { clientId, redirectUri } = qboEnv();
  const { authorization_endpoint } = await getDiscovery();
  const u = new URL(authorization_endpoint);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

function basicAuth(): string {
  const { clientId, clientSecret } = qboEnv();
  return "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

async function tokenRequest(body: URLSearchParams): Promise<TokenSet> {
  const { token_endpoint } = await getDiscovery();
  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  const tid = res.headers.get("intuit_tid") ?? undefined;
  if (!res.ok) {
    const text = await res.text();
    let code: string | undefined;
    try { code = (JSON.parse(text) as { error?: string }).error; } catch { /* not json */ }
    throw new IntuitAuthError(`Intuit token endpoint ${res.status} [intuit_tid ${tid ?? "n/a"}]: ${text.slice(0, 300)}`, res.status, code, tid);
  }
  return (await res.json()) as TokenSet;
}

export function exchangeCode(code: string): Promise<TokenSet> {
  const { redirectUri } = qboEnv();
  return tokenRequest(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  );
}

export function refreshTokens(refreshToken: string): Promise<TokenSet> {
  return tokenRequest(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  );
}

export async function revokeToken(refreshToken: string): Promise<void> {
  const { revocation_endpoint } = await getDiscovery();
  await fetch(revocation_endpoint, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token: refreshToken }),
    cache: "no-store",
  });
}
