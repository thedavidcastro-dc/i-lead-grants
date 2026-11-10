import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { changedSince, queryAll } from "@/lib/qbo/client";

/**
 * Transaction sync: expenditure transactions from QuickBooks → grants.qbo_transactions
 * and one row per expense-side line → grants.qbo_lines, with change detection.
 *
 * Entities: Purchase (expense/check/credit-card charge), Bill, VendorCredit, JournalEntry.
 */
export const TXN_ENTITIES = ["Purchase", "Bill", "VendorCredit", "JournalEntry"] as const;
export type TxnEntity = (typeof TXN_ENTITIES)[number];

type Ref = { value: string; name?: string };
type QboLine = {
  Id?: string;
  LineNum?: number;
  Amount?: number;
  Description?: string;
  DetailType: string;
  AccountBasedExpenseLineDetail?: { AccountRef?: Ref; ClassRef?: Ref; CustomerRef?: Ref; BillableStatus?: string };
  ItemBasedExpenseLineDetail?: { ItemRef?: Ref; ClassRef?: Ref; CustomerRef?: Ref; Qty?: number; UnitPrice?: number };
  JournalEntryLineDetail?: { PostingType: "Debit" | "Credit"; AccountRef?: Ref; ClassRef?: Ref; Entity?: { Type?: string; EntityRef?: Ref } };
};
type QboTxn = {
  Id: string;
  SyncToken: string;
  TxnDate: string;
  DocNumber?: string;
  TotalAmt?: number;
  PrivateNote?: string;
  PaymentType?: string;
  Credit?: boolean;
  EntityRef?: Ref & { type?: string };
  VendorRef?: Ref;
  Line?: QboLine[];
  MetaData?: { LastUpdatedTime?: string };
  status?: string; // "Deleted" in CDC responses
};

export type NormalizedLine = {
  txn_type: string; txn_id: string; line_id: string; line_num: number | null; txn_date: string;
  account_id: string | null; class_id: string | null; entity_type: string | null; entity_id: string | null; entity_name: string | null;
  customer_id: string | null; customer_name: string | null; item_id: string | null; detail_type: string;
  description: string | null; amount: number; posting_type: string | null; content_hash: string;
};

function hashOf(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Turn a QBO transaction into expense-side line rows. */
export function normalizeLines(entity: TxnEntity, t: QboTxn): NormalizedLine[] {
  const out: NormalizedLine[] = [];
  const sign = entity === "VendorCredit" || t.Credit === true ? -1 : 1;
  const entityRef = t.VendorRef ?? t.EntityRef;
  const entityType = t.VendorRef ? "Vendor" : t.EntityRef?.type ?? null;

  for (const [i, line] of (t.Line ?? []).entries()) {
    const lineId = line.Id ?? String(i + 1);
    const base = {
      txn_type: entity, txn_id: t.Id, line_id: lineId, line_num: line.LineNum ?? null, txn_date: t.TxnDate,
      description: line.Description ?? null, detail_type: line.DetailType,
      entity_type: entityType, entity_id: entityRef?.value ?? null, entity_name: entityRef?.name ?? null,
      customer_id: null as string | null, customer_name: null as string | null, item_id: null as string | null,
    };
    if (line.DetailType === "AccountBasedExpenseLineDetail" && line.AccountBasedExpenseLineDetail) {
      const d = line.AccountBasedExpenseLineDetail;
      const amount = sign * (line.Amount ?? 0);
      out.push({
        ...base, account_id: d.AccountRef?.value ?? null, class_id: d.ClassRef?.value ?? null,
        customer_id: d.CustomerRef?.value ?? null, customer_name: d.CustomerRef?.name ?? null,
        amount, posting_type: null,
        content_hash: hashOf([t.TxnDate, d.AccountRef?.value, d.ClassRef?.value, amount, line.Description, entityRef?.value, d.CustomerRef?.value]),
      });
    } else if (line.DetailType === "ItemBasedExpenseLineDetail" && line.ItemBasedExpenseLineDetail) {
      const d = line.ItemBasedExpenseLineDetail;
      const amount = sign * (line.Amount ?? 0);
      out.push({
        ...base, account_id: null, class_id: d.ClassRef?.value ?? null, item_id: d.ItemRef?.value ?? null,
        customer_id: d.CustomerRef?.value ?? null, customer_name: d.CustomerRef?.name ?? null,
        amount, posting_type: null,
        content_hash: hashOf([t.TxnDate, "item", d.ItemRef?.value, d.ClassRef?.value, amount, line.Description, entityRef?.value]),
      });
    } else if (line.DetailType === "JournalEntryLineDetail" && line.JournalEntryLineDetail) {
      const d = line.JournalEntryLineDetail;
      const amount = (d.PostingType === "Credit" ? -1 : 1) * (line.Amount ?? 0);
      out.push({
        ...base, account_id: d.AccountRef?.value ?? null, class_id: d.ClassRef?.value ?? null,
        entity_type: d.Entity?.Type ?? null, entity_id: d.Entity?.EntityRef?.value ?? null, entity_name: d.Entity?.EntityRef?.name ?? null,
        amount, posting_type: d.PostingType,
        content_hash: hashOf([t.TxnDate, d.AccountRef?.value, d.ClassRef?.value, amount, line.Description, d.Entity?.EntityRef?.value]),
      });
    }
    // SubTotal / Tax / other detail types carry no expense information.
  }
  return out;
}

type Db = ReturnType<typeof createAdminClient>;

/** Upsert a batch of transactions and their lines; detect changes against what was stored. */
async function storeTransactions(db: Db, entity: TxnEntity, txns: QboTxn[], stats: SyncStats) {
  if (!txns.length) return;
  const g = db.schema("grants");
  const now = new Date().toISOString();

  // Expense accounts, to mark is_expense.
  const { data: accts } = await g.from("qbo_accounts").select("id, classification");
  const expenseAccounts = new Set((accts ?? []).filter((a) => a.classification === "Expense").map((a) => a.id));

  const txnRows = txns.map((t) => {
    const entityRef = t.VendorRef ?? t.EntityRef;
    return {
      id: t.Id, txn_type: entity, txn_date: t.TxnDate, doc_number: t.DocNumber ?? null,
      entity_type: t.VendorRef ? "Vendor" : t.EntityRef?.type ?? null, entity_id: entityRef?.value ?? null, entity_name: entityRef?.name ?? null,
      total_amount: t.TotalAmt ?? null, private_note: t.PrivateNote ?? null, payment_type: t.PaymentType ?? null, is_credit: t.Credit === true,
      sync_token: t.SyncToken, qbo_updated_at: t.MetaData?.LastUpdatedTime ?? null, raw: t, deleted: false, synced_at: now,
    };
  });
  const { error: tErr } = await g.from("qbo_transactions").upsert(txnRows, { onConflict: "txn_type,id" });
  if (tErr) throw new Error(`qbo_transactions: ${tErr.message}`);
  stats.transactions += txnRows.length;

  const ids = txns.map((t) => t.Id);
  const { data: existing } = await g
    .from("qbo_lines")
    .select("id, txn_id, line_id, content_hash, deleted")
    .eq("txn_type", entity)
    .in("txn_id", ids);
  const existingMap = new Map((existing ?? []).map((l) => [`${l.txn_id}/${l.line_id}`, l]));

  const incoming = txns.flatMap((t) => normalizeLines(entity, t));
  const seen = new Set<string>();
  const upserts: Record<string, unknown>[] = [];
  const changedExistingIds: string[] = [];

  for (const l of incoming) {
    const key = `${l.txn_id}/${l.line_id}`;
    seen.add(key);
    const prev = existingMap.get(key);
    const is_expense = l.account_id ? expenseAccounts.has(l.account_id) : true;
    if (!prev) {
      upserts.push({ ...l, is_expense, deleted: false, first_seen_at: now, last_changed_at: now });
      stats.linesNew++;
    } else if (prev.content_hash !== l.content_hash || prev.deleted) {
      upserts.push({ ...l, is_expense, deleted: false, last_changed_at: now });
      changedExistingIds.push(prev.id);
      stats.linesChanged++;
    } else {
      stats.linesUnchanged++;
    }
  }
  if (upserts.length) {
    const { error } = await g.from("qbo_lines").upsert(upserts, { onConflict: "txn_type,txn_id,line_id" });
    if (error) throw new Error(`qbo_lines: ${error.message}`);
  }

  // Lines that vanished from a re-synced transaction.
  const vanished = (existing ?? []).filter((l) => !seen.has(`${l.txn_id}/${l.line_id}`) && !l.deleted);
  if (vanished.length) {
    await g.from("qbo_lines").update({ deleted: true, last_changed_at: now }).in("id", vanished.map((v) => v.id));
    stats.linesDeleted += vanished.length;
  }

  await flagAffected(db, changedExistingIds, "changed", stats);
  await flagAffected(db, vanished.map((v) => v.id), "deleted", stats);
}

/** Raise sync_flags for lines that were already classified or reported. */
async function flagAffected(db: Db, lineIds: string[], change: "changed" | "deleted", stats: SyncStats) {
  if (!lineIds.length) return;
  const g = db.schema("grants");
  const { data: disp } = await g.from("dispositions").select("id, line_id, status").in("line_id", lineIds);
  if (!disp?.length) return;
  const { data: allocs } = await g.from("allocations").select("id, disposition_id").in("disposition_id", disp.map((d) => d.id));
  const allocIds = (allocs ?? []).map((a) => a.id);
  const reportedAllocIds = new Set<string>();
  if (allocIds.length) {
    const { data: sl } = await g.from("submission_lines").select("source_id").eq("source_kind", "allocation").in("source_id", allocIds);
    for (const s of sl ?? []) reportedAllocIds.add(s.source_id);
  }
  const allocsByDisp = new Map<string, string[]>();
  for (const a of allocs ?? []) allocsByDisp.set(a.disposition_id, [...(allocsByDisp.get(a.disposition_id) ?? []), a.id]);

  const flags = disp.map((d) => {
    const reported = (allocsByDisp.get(d.id) ?? []).some((id) => reportedAllocIds.has(id));
    const kind = `${change}_after_${reported ? "report" : "classification"}`;
    return { line_id: d.line_id, kind, detail: { disposition_status: d.status } };
  });
  await g.from("sync_flags").insert(flags);
  // Re-open the disposition so it shows in the queue again.
  await g.from("dispositions").update({ status: "needs_review" }).in("id", disp.map((d) => d.id));
  stats.flags += flags.length;
}

async function markDeletedTransactions(db: Db, entity: TxnEntity, ids: string[], stats: SyncStats) {
  if (!ids.length) return;
  const g = db.schema("grants");
  const now = new Date().toISOString();
  await g.from("qbo_transactions").update({ deleted: true, synced_at: now }).eq("txn_type", entity).in("id", ids);
  const { data: lines } = await g.from("qbo_lines").select("id").eq("txn_type", entity).in("txn_id", ids).eq("deleted", false);
  const lineIds = (lines ?? []).map((l) => l.id);
  if (lineIds.length) {
    await g.from("qbo_lines").update({ deleted: true, last_changed_at: now }).in("id", lineIds);
    stats.linesDeleted += lineIds.length;
    await flagAffected(db, lineIds, "deleted", stats);
  }
}

export type SyncStats = {
  transactions: number; linesNew: number; linesChanged: number; linesUnchanged: number; linesDeleted: number; flags: number;
};
const emptyStats = (): SyncStats => ({ transactions: 0, linesNew: 0, linesChanged: 0, linesUnchanged: 0, linesDeleted: 0, flags: 0 });

async function withRun<T>(kind: string, startedBy: string | null, fn: (stats: SyncStats) => Promise<T>): Promise<{ stats: SyncStats; result: T }> {
  const db = createAdminClient();
  const g = db.schema("grants");
  const { data: run, error } = await g.from("sync_runs").insert({ kind, started_by: startedBy, status: "running" }).select("id").single();
  if (error) throw error;
  const stats = emptyStats();
  try {
    const result = await fn(stats);
    await g.from("sync_runs").update({ status: "ok", finished_at: new Date().toISOString(), stats }).eq("id", run.id);
    return { stats, result };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await g.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), stats, error: message }).eq("id", run.id);
    throw e;
  }
}

/** Initial (or re-) load of every expenditure transaction in a date range. */
export async function loadTransactions(from: string, to: string, startedBy: string | null) {
  return withRun("initial", startedBy, async (stats) => {
    const db = createAdminClient();
    for (const entity of TXN_ENTITIES) {
      const txns = await queryAll<QboTxn>(entity, `TxnDate >= '${from}' and TxnDate <= '${to}'`, "TxnDate");
      for (let i = 0; i < txns.length; i += 200) await storeTransactions(db, entity, txns.slice(i, i + 200), stats);
    }
    const g = db.schema("grants");
    const { data: conn } = await g.from("qbo_connection").select("initial_load_from, initial_load_to").eq("id", 1).maybeSingle();
    await g.from("qbo_connection").update({
      initial_load_from: conn?.initial_load_from && conn.initial_load_from < from ? conn.initial_load_from : from,
      initial_load_to: conn?.initial_load_to && conn.initial_load_to > to ? conn.initial_load_to : to,
      last_cdc_at: new Date().toISOString(),
    }).eq("id", 1);
    return { from, to };
  });
}

/** Incremental sync via change data capture since the last run (≤ 30 days). */
export async function syncChanges(startedBy: string | null, kind: "cdc" | "webhook" = "cdc") {
  return withRun(kind, startedBy, async (stats) => {
    const db = createAdminClient();
    const g = db.schema("grants");
    const { data: conn } = await g.from("qbo_connection").select("last_cdc_at, initial_load_to").eq("id", 1).maybeSingle();
    const now = new Date();
    let since = conn?.last_cdc_at ? new Date(conn.last_cdc_at) : new Date(now.getTime() - 29 * 86400000);
    since = new Date(since.getTime() - 5 * 60 * 1000); // overlap for safety
    if (now.getTime() - since.getTime() > 29 * 86400000) {
      throw new Error("Last sync is older than 30 days; run a date-range load to catch up before incremental sync.");
    }
    const res = await changedSince([...TXN_ENTITIES], since);
    for (const block of res.CDCResponse ?? []) {
      for (const qr of block.QueryResponse ?? []) {
        for (const entity of TXN_ENTITIES) {
          const items = (qr as Record<string, unknown>)[entity] as QboTxn[] | undefined;
          if (!items?.length) continue;
          const deleted = items.filter((t) => t.status === "Deleted").map((t) => t.Id);
          const live = items.filter((t) => t.status !== "Deleted");
          await storeTransactions(db, entity, live, stats);
          await markDeletedTransactions(db, entity, deleted, stats);
        }
      }
    }
    await g.from("qbo_connection").update({ last_cdc_at: now.toISOString() }).eq("id", 1);
    return { since: since.toISOString() };
  });
}
