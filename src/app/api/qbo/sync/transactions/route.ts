import { NextResponse, type NextRequest } from "next/server";
import { getProfile, isAdmin } from "@/lib/auth";
import { loadTransactions } from "@/lib/qbo/transactions";

export const maxDuration = 300;

/** Admin only: load all expenditure transactions in a date range. Body: { from, to } (YYYY-MM-DD). */
export async function POST(req: NextRequest) {
  const profile = await getProfile();
  if (!profile || !isAdmin(profile.role)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { from?: string; to?: string };
  const from = body.from ?? "2026-07-01";
  const to = body.to ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return NextResponse.json({ error: "from/to must be YYYY-MM-DD with from <= to" }, { status: 400 });
  }
  try {
    const { stats } = await loadTransactions(from, to, profile.id);
    return NextResponse.json({ ok: true, from, to, stats });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
