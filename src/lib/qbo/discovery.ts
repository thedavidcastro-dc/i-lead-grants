import { qboEnv } from "@/lib/env";

/**
 * Intuit's OpenID/OAuth discovery document, fetched at runtime and cached for a day,
 * so endpoint changes on Intuit's side are picked up without a deploy.
 * Falls back to the last known values if the document can't be fetched.
 */
export type Discovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
  issuer?: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
};

const FALLBACK: Discovery = {
  authorization_endpoint: "https://appcenter.intuit.com/connect/oauth2",
  token_endpoint: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  revocation_endpoint: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
};

const DISCOVERY_URL = {
  production: "https://developer.api.intuit.com/.well-known/openid_configuration",
  sandbox: "https://developer.api.intuit.com/.well-known/openid_sandbox_configuration",
} as const;

const TTL_MS = 24 * 60 * 60 * 1000;
let cache: { env: string; fetchedAt: number; doc: Discovery } | null = null;

export async function getDiscovery(): Promise<Discovery> {
  const env = qboEnv().environment;
  if (cache && cache.env === env && Date.now() - cache.fetchedAt < TTL_MS) return cache.doc;
  try {
    const res = await fetch(DISCOVERY_URL[env], { cache: "no-store" });
    if (!res.ok) throw new Error(`discovery ${res.status}`);
    const json = (await res.json()) as Partial<Discovery>;
    const doc: Discovery = {
      authorization_endpoint: json.authorization_endpoint ?? FALLBACK.authorization_endpoint,
      token_endpoint: json.token_endpoint ?? FALLBACK.token_endpoint,
      revocation_endpoint: json.revocation_endpoint ?? FALLBACK.revocation_endpoint,
      issuer: json.issuer,
      userinfo_endpoint: json.userinfo_endpoint,
      jwks_uri: json.jwks_uri,
    };
    cache = { env, fetchedAt: Date.now(), doc };
    return doc;
  } catch {
    return cache?.doc ?? FALLBACK;
  }
}
