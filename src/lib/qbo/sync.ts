import { createAdminClient } from "@/lib/supabase/admin";
import { queryAll } from "@/lib/qbo/client";

type Ref = { value: string; name?: string };
type QboAccount = {
  Id: string; Name: string; FullyQualifiedName: string; Active: boolean; SubAccount?: boolean;
  ParentRef?: Ref; AccountType: string; AccountSubType?: string; Classification?: string;
  AcctNum?: string; SyncToken: string; MetaData?: { LastUpdatedTime?: string };
};
type QboClass = {
  Id: string; Name: string; FullyQualifiedName: string; Active: boolean; SubClass?: boolean;
  ParentRef?: Ref; SyncToken: string; MetaData?: { LastUpdatedTime?: string };
};
type QboVendor = { Id: string; DisplayName: string; Active: boolean; SyncToken: string; MetaData?: { LastUpdatedTime?: string } };
type QboEmployee = { Id: string; DisplayName: string; Active: boolean; SyncToken: string; MetaData?: { LastUpdatedTime?: string } };

export type SyncStats = { accounts: number; classes: number; vendors: number; employees: number };

/**
 * Pull reference lists (chart of accounts, classes, vendors, employees)
 * and upsert them. Transactions come in a later sync module.
 */
export async function syncReference(startedBy: string | null): Promise<SyncStats> {
  const db = createAdminClient().schema("grants");
  const { data: run, error: runErr } = await db
    .from("sync_runs")
    .insert({ kind: "reference", started_by: startedBy, status: "running" })
    .select("id")
    .single();
  if (runErr) throw runErr;

  try {
    const [accounts, classes, vendors, employees] = await Promise.all([
      queryAll<QboAccount>("Account"),
      queryAll<QboClass>("Class"),
      queryAll<QboVendor>("Vendor"),
      queryAll<QboEmployee>("Employee"),
    ]);
    const now = new Date().toISOString();

    const up = async (table: string, rows: Record<string, unknown>[]) => {
      if (!rows.length) return;
      const { error } = await db.from(table).upsert(rows, { onConflict: "id" });
      if (error) throw new Error(`${table}: ${error.message}`);
    };

    await up(
      "qbo_accounts",
      accounts.map((a) => ({
        id: a.Id, name: a.Name, fully_qualified_name: a.FullyQualifiedName, active: a.Active,
        parent_id: a.ParentRef?.value ?? null, account_type: a.AccountType, account_sub_type: a.AccountSubType ?? null,
        classification: a.Classification ?? null, account_number: a.AcctNum ?? null, sync_token: a.SyncToken,
        qbo_updated_at: a.MetaData?.LastUpdatedTime ?? null, raw: a, synced_at: now,
      })),
    );
    await up(
      "qbo_classes",
      classes.map((c) => ({
        id: c.Id, name: c.Name, fully_qualified_name: c.FullyQualifiedName, active: c.Active,
        parent_id: c.ParentRef?.value ?? null, sync_token: c.SyncToken,
        qbo_updated_at: c.MetaData?.LastUpdatedTime ?? null, raw: c, synced_at: now,
      })),
    );
    await up(
      "qbo_vendors",
      vendors.map((v) => ({
        id: v.Id, display_name: v.DisplayName, active: v.Active, sync_token: v.SyncToken,
        qbo_updated_at: v.MetaData?.LastUpdatedTime ?? null, raw: v, synced_at: now,
      })),
    );
    await up(
      "qbo_employees",
      employees.map((e) => ({
        id: e.Id, display_name: e.DisplayName, active: e.Active, sync_token: e.SyncToken,
        qbo_updated_at: e.MetaData?.LastUpdatedTime ?? null, raw: e, synced_at: now,
      })),
    );

    const stats: SyncStats = {
      accounts: accounts.length, classes: classes.length, vendors: vendors.length, employees: employees.length,
    };
    await db.from("sync_runs").update({ status: "ok", finished_at: now, stats }).eq("id", run.id);
    return stats;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), error: message }).eq("id", run.id);
    throw e;
  }
}
