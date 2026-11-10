"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function QuickBooksActions({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function sync() {
    setBusy("sync"); setMsg(null);
    const res = await fetch("/api/qbo/sync", { method: "POST" });
    const body = await res.json();
    setMsg(body.ok ? `Synced: ${JSON.stringify(body.stats)}` : `Sync failed: ${body.error}`);
    setBusy(null); router.refresh();
  }
  async function disconnect() {
    if (!confirm("Disconnect QuickBooks? Synced data stays; new syncs stop until reconnected.")) return;
    setBusy("disconnect");
    await fetch("/api/qbo/disconnect", { method: "POST" });
    setBusy(null); router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      {connected ? (
        <>
          <button onClick={sync} disabled={busy !== null} className="rounded bg-navy text-white px-4 py-2 disabled:opacity-50">
            {busy === "sync" ? "Syncing…" : "Sync reference data"}
          </button>
          <button onClick={disconnect} disabled={busy !== null} className="rounded border border-line-strong px-4 py-2 disabled:opacity-50">
            Disconnect
          </button>
        </>
      ) : (
        <a href="/api/qbo/connect" className="rounded bg-navy text-white px-4 py-2 inline-block">
          Connect to QuickBooks
        </a>
      )}
      {msg && <span className="text-sm text-muted font-mono">{msg}</span>}
    </div>
  );
}
