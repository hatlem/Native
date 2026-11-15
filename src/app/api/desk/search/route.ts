import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { deskSearch, normalizeDeskQuery } from "@/lib/desk-search";

export const dynamic = "force-dynamic";

// Entity search behind the desk command palette. Desk-only: every hit spans
// all customer organisations, so the role is checked here on every call —
// never inferred from the page that rendered the palette.
export async function GET(req: NextRequest) {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const q = normalizeDeskQuery(req.nextUrl.searchParams.get("q"));
  if (!q) return NextResponse.json({ hits: [] });
  // Titles administration is superadmin-only (see /desk/titles).
  const hits = await deskSearch(q, role === "SUPERADMIN");
  return NextResponse.json({ hits }, { headers: { "Cache-Control": "no-store" } });
}
