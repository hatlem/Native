// Liveness + readiness probe for the platform healthcheck (Railway hits
// this before switching traffic to a new deploy). Lives under /api so the
// next-intl middleware skips it — no locale prefix, no rewrite, no auth.
//
// We deliberately verify DB connectivity rather than returning a bare 200:
// `prisma migrate deploy` runs in the start command before `next start`, so
// by the time this responds the database must be reachable. Gating the
// healthcheck on a real `SELECT 1` means a deploy that can't reach its DB
// never gets promoted, instead of serving 500s to the first real request.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Never cache — the probe must reflect the live process on every call.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { status: "ok", db: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // Don't leak the underlying error to an unauthenticated probe.
    return NextResponse.json(
      { status: "error", db: "unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
