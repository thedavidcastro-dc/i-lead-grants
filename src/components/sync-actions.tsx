"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function SyncActions({ defaultFrom }: { defaultFrom: string }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function call(label: string, url: string, body?: unknown) {
    setBusy(label); setMsg(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const data = await res.json();
      setMsg(data.ok ? `${label}: ${JSON.stringify(data.stats)}` : `${label} failed: ${data.error}`);
    } catch (e) {
      setMsg(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null); router.refresh();
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-muted">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded border border-line-strong bg-paper px-2 py-1" />
        </label>
        <label className="block">
          <span className="text-muted">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded border border-line-strong bg-paper px-2 py-1" />
        </label>
        <button onClick={() => call("Date-range load", "/api/qbo/sync/transactions", { from, to })} disabled={busy !== null} className="rounded bg-navy text-white px-4 py-2 disabled:opacity-50">
          {busy === "Date-range load" ? "Loading…" : "Load transactions for range"}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => call("Incremental sync", "/api/qbo/sync/cdc")} disabled={busy !== null} className="rounded border border-navy text-navy px-4 py-2 disabled:opacity-50">
          {busy === "Incremental sync" ? "Syncing…" : "Pull changes since last sync"}
        </button>
        <button onClick={() => call("Reference sync", "/api/qbo/sync")} disabled={busy !== null} className="rounded border border-line-strong px-4 py-2 disabled:opacity-50">
          Refresh accounts, classes, vendors, employees
        </button>
      </div>
      {msg && <p className="font-mono text-xs text-muted break-all">{msg}</p>}
    </div>
  );
}
