import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncChanges } from "@/lib/qbo/transactions";

export const maxDuration = 60;

/**
 * Intuit webhook receiver. Register this URL on the Intuit app (Webhooks → Endpoint URL)
 * and put the verifier token in QBO_WEBHOOK_VERIFIER. Intuit signs the raw body with
 * HMAC-SHA256 (base64) in the `intuit-signature` header.
 * We store the event and run an incremental sync; the payload itself is only a hint.
 */
export async function POST(req: NextRequest) {
  const verifier = process.env.QBO_WEBHOOK_VERIFIER;
  const raw = await req.text();
  const sig = req.headers.get("intuit-signature") ?? "";
  if (!verifier) return NextResponse.json({ error: "Webhook verifier not configured" }, { status: 503 });
  const expected = createHmac("sha256", verifier).update(raw).digest("base64");
  const ok = sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok) return NextResponse.json({ error: "Bad signature" }, { status: 401 });

  let payload: unknown = null;
  try { payload = JSON.parse(raw); } catch { payload = { raw }; }
  const g = createAdminClient().schema("grants");
  const realm = (payload as { eventNotifications?: Array<{ realmId?: string }> })?.eventNotifications?.[0]?.realmId ?? null;
  const { data: ev } = await g.from("webhook_events").insert({ realm_id: realm, payload }).select("id").single();

  try {
    await syncChanges(null, "webhook");
    if (ev) await g.from("webhook_events").update({ processed_at: new Date().toISOString() }).eq("id", ev.id);
  } catch (e) {
    if (ev) await g.from("webhook_events").update({ error: e instanceof Error ? e.message : String(e) }).eq("id", ev.id);
  }
  return NextResponse.json({ ok: true });
}
