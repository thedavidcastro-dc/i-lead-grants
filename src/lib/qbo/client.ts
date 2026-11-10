import { qboEnv } from "@/lib/env";
import { getAccessToken } from "@/lib/qbo/connection";

export const MINOR_VERSION = "75";

export function baseUrl(): string {
  return qboEnv().environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

async function request<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const { token, realmId } = await getAccessToken();
  const u = new URL(`${baseUrl()}/v3/company/${realmId}${path}`);
  u.searchParams.set("minorversion", MINOR_VERSION);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1500));
    return request<T>(path, params);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QuickBooks ${res.status} on ${path}: ${text.slice(0, 400)}`);
  }
  return (await res.json()) as T;
}

type QueryResponse<T> = {
  QueryResponse: { [entity: string]: T[] | number | undefined; startPosition?: number; maxResults?: number; totalCount?: number };
  time: string;
};

/**
 * Run a QuickBooks query and page through every result.
 * `entity` must match the entity name in the SELECT (e.g. "Account").
 */
export async function queryAll<T>(entity: string, where = "", orderBy = "Id"): Promise<T[]> {
  const page = 1000;
  let start = 1;
  const out: T[] = [];
  for (;;) {
    const sql = `select * from ${entity}${where ? " where " + where : ""} orderby ${orderBy} startposition ${start} maxresults ${page}`;
    const data = await request<QueryResponse<T>>("/query", { query: sql });
    const rows = (data.QueryResponse[entity] as T[] | undefined) ?? [];
    out.push(...rows);
    if (rows.length < page) break;
    start += page;
  }
  return out;
}

export async function countOf(entity: string, where = ""): Promise<number> {
  const sql = `select count(*) from ${entity}${where ? " where " + where : ""}`;
  const data = await request<QueryResponse<unknown>>("/query", { query: sql });
  return (data.QueryResponse.totalCount as number | undefined) ?? 0;
}

export async function companyInfo(): Promise<{ CompanyName: string }> {
  const { realmId } = await getAccessToken();
  const data = await request<{ CompanyInfo: { CompanyName: string } }>(`/companyinfo/${realmId}`);
  return data.CompanyInfo;
}

/** Change data capture: entities changed since a timestamp (must be within 30 days). */
export async function changedSince(entities: string[], since: Date) {
  return request<{ CDCResponse: Array<{ QueryResponse: Array<Record<string, unknown>> }> }>("/cdc", {
    entities: entities.join(","),
    changedSince: since.toISOString(),
  });
}
