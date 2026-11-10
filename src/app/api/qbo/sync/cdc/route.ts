import { NextResponse } from "next/server";
import { getProfile, isAdmin } from "@/lib/auth";
import { syncChanges } from "@/lib/qbo/transactions";

export const maxDuration = 120;

/** Admin only: pull everything changed in QuickBooks since the last sync. */
export async function POST() {
  const profile = await getProfile();
  if (!profile || !isAdmin(profile.role)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  try {
    const { stats, result } = await syncChanges(profile.id, "cdc");
    return NextResponse.json({ ok: true, ...result, stats });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
