import { qboEnv } from "@/lib/env";

// Endpoints as published by Intuit's developer platform.
export const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

/** Read-only subledger: accounting scope only. */
export const SCOPES = ["com.intuit.quickbooks.accounting"];

export type TokenSet = {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  x_refresh_token_expires_in: number; // seconds
  token_type: string;
};

export function buildAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = qboEnv();
  const u = new URL(AUTHORIZE_URL);
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
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Intuit token endpoint ${res.status}: ${text.slice(0, 300)}`);
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
  await fetch(REVOKE_URL, {
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
