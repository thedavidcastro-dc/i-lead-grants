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
  for (const [k, v] of Object.entries(params)) if (!k.startsWith("__")) u.searchParams.set(k, v);
  const res = await fetch(u, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  // Intuit's per-request transaction id; quote it to Intuit support when something goes wrong.
  const tid = res.headers.get("intuit_tid") ?? "";
  lastIntuitTid = tid;
  if (res.status === 429 && !params.__retried) {
    await new Promise((r) => setTimeout(r, 1500));
    return request<T>(path, { ...params, __retried: "1" });
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QuickBooks ${res.status} on ${path} [intuit_tid ${tid || "n/a"}]: ${text.slice(0, 400)}`);
  }
  return (await res.json()) as T;
}

/** The intuit_tid of the most recent QuickBooks response, for logs and support tickets. */
export let lastIntuitTid = "";

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
