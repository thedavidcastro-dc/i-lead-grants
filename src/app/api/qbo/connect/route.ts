import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getProfile, isAdmin } from "@/lib/auth";
import { buildAuthorizeUrl } from "@/lib/qbo/oauth";

/** Admin only: start the Intuit OAuth flow. */
export async function GET() {
  const profile = await getProfile();
  if (!profile || !isAdmin(profile.role)) {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(await buildAuthorizeUrl(state));
  res.cookies.set("qbo_oauth_state", state, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/",
  });
  return res;
}
