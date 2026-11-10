import { NextResponse } from "next/server";
import { getProfile, isAdmin } from "@/lib/auth";
import { getRefreshTokenForRevoke, markDisconnected } from "@/lib/qbo/connection";
import { revokeToken } from "@/lib/qbo/oauth";

export async function POST() {
  const profile = await getProfile();
  if (!profile || !isAdmin(profile.role)) {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  const rt = await getRefreshTokenForRevoke();
  if (rt) {
    try { await revokeToken(rt); } catch { /* best effort */ }
  }
  await markDisconnected("Disconnected by " + profile.email);
  return NextResponse.json({ ok: true });
}
