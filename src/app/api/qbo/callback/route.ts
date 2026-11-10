import { NextResponse, type NextRequest } from "next/server";
import { getProfile, isAdmin } from "@/lib/auth";
import { exchangeCode } from "@/lib/qbo/oauth";
import { saveTokens } from "@/lib/qbo/connection";
import { companyInfo } from "@/lib/qbo/client";
import { publicEnv } from "@/lib/env";

/** Intuit redirects here with ?code=&state=&realmId= */
export async function GET(req: NextRequest) {
  const profile = await getProfile();
  if (!profile || !isAdmin(profile.role)) {
    return NextResponse.redirect(`${publicEnv.siteUrl}/login`);
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const realmId = url.searchParams.get("realmId");
  const err = url.searchParams.get("error");
  const expected = req.cookies.get("qbo_oauth_state")?.value;

  const back = (msg: string) =>
    NextResponse.redirect(`${publicEnv.siteUrl}/settings/quickbooks?${msg}`);

  if (err) return back(`error=${encodeURIComponent(err)}`);
  if (!code || !state || !realmId) return back("error=missing_params");
  if (!expected || expected !== state) return back("error=bad_state");

  try {
    const tokens = await exchangeCode(code);
    await saveTokens(realmId, tokens, { connectedBy: profile.id });
    try {
      const info = await companyInfo();
      await saveTokens(realmId, tokens, { companyName: info.CompanyName });
    } catch {
      // company name is cosmetic
    }
    const res = back("connected=1");
    res.cookies.delete("qbo_oauth_state");
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : "exchange_failed";
    return back(`error=${encodeURIComponent(message)}`);
  }
}
