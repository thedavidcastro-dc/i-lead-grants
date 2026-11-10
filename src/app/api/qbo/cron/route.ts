import { NextResponse, type NextRequest } from "next/server";
import { syncChanges } from "@/lib/qbo/transactions";
import { syncReference } from "@/lib/qbo/sync";
import { getConnection } from "@/lib/qbo/connection";

export const maxDuration = 120;

/**
 * Scheduled by vercel.json. Vercel sends `Authorization: Bearer $CRON_SECRET`.
 * Pulls changes since the last run, and refreshes reference lists once a day.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const conn = await getConnection();
  if (conn?.status !== "connected") return NextResponse.json({ ok: false, skipped: "not connected" });

  const out: Record<string, unknown> = {};
  try {
    const { stats } = await syncChanges(null, "cdc");
    out.cdc = stats;
  } catch (e) {
    out.cdcError = e instanceof Error ? e.message : String(e);
  }
  // Reference refresh in the first run after midnight Eastern.
  const hourEastern = Number(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
  if (hourEastern === 0 || req.nextUrl.searchParams.get("reference") === "1") {
    try {
      out.reference = await syncReference(null);
    } catch (e) {
      out.referenceError = e instanceof Error ? e.message : String(e);
    }
  }
  return NextResponse.json({ ok: true, ...out });
}
