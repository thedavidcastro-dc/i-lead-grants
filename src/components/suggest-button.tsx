"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function SuggestButton({ unsuggested }: { unsuggested: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/classify/suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 60 }) });
      const d = await res.json();
      setMsg(d.ok ? `Suggested ${d.suggested} lines in ${d.batches} call${d.batches === 1 ? "" : "s"} · $${Number(d.cost).toFixed(3)}` : `Stopped: ${d.error}${d.suggested ? ` (after ${d.suggested} lines)` : ""}`);
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); router.refresh(); }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <button onClick={run} disabled={busy || unsuggested === 0} className="rounded bg-navy text-white px-4 py-2 disabled:opacity-50">
        {busy ? "Asking Claude…" : unsuggested === 0 ? "All pending lines have suggestions" : `Suggest next ${Math.min(60, unsuggested)} of ${unsuggested}`}
      </button>
      {msg && <span className="text-muted font-mono text-xs">{msg}</span>}
    </div>
  );
}
