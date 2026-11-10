import { NextResponse } from "next/server";
import { getProfile, isAdmin } from "@/lib/auth";
import { syncReference } from "@/lib/qbo/sync";

export const maxDuration = 60;

/** Admin only: pull chart of accounts, classes, vendors, employees. */
export async function POST() {
  const profile = await getProfile();
  if (!profile || !isAdmin(profile.role)) {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  try {
    const stats = await syncReference(profile.id);
    return NextResponse.json({ ok: true, stats });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
