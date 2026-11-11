import { NextResponse, type NextRequest } from "next/server";
import { runSuggestions } from "@/lib/classify/actions";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { limit?: number };
  try {
    const result = await runSuggestions(Math.min(Math.max(body.limit ?? 60, 1), 200));
    return NextResponse.json({ ok: !result.error, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
