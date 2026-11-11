import { NextResponse } from "next/server";
import { documentDownloadUrl } from "@/lib/grants/actions";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = await documentDownloadUrl(id);
  if (!url) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.redirect(url);
}
