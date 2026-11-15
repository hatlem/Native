// Deep health check for an external monitor: database, migrations, the job
// queue and the scheduled sweeps (rules in lib/health.ts).
//
// It reveals operational detail (migration names, queue depth), so unlike
// /api/health it is not public: `Authorization: Bearer <CRON_SECRET>`, and
// with CRON_SECRET unset it answers 404.
//
//   200  status "ok" or "degraded" (a backlog, dead letters, a stale sweep)
//   503  status "fail" (database down, migrations pending or failed)
//   `?strict=1` also answers 503 when degraded — for a monitor that can only
//   alert on status codes.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkCronAuth } from "@/lib/cron-auth";
import { enabledSweeps, type SweepName } from "@/lib/sweeps";
import { queueStats } from "@/lib/jobs";
import { evaluateDeepHealth, pendingMigrationNames } from "@/lib/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function deployedMigrations(): Promise<string[] | null> {
  try {
    const entries = await readdir(path.join(process.cwd(), "prisma", "migrations"), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = checkCronAuth(req.headers.get("authorization"));
  if (auth === "disabled") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (auth === "unauthorized") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  let db = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = false;
  }

  let pending: string[] | null = null;
  let failed: string[] = [];
  let queue: Awaited<ReturnType<typeof queueStats>> | null = null;
  const lastSweepOk: Partial<Record<SweepName, Date | null>> = {};

  if (db) {
    try {
      const rows = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
        SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
      const applied = rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
      failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
      const deployed = await deployedMigrations();
      pending = deployed ? pendingMigrationNames(deployed, applied) : null;
    } catch {
      pending = null;
    }
    try {
      queue = await queueStats(now);
    } catch {
      queue = null;
    }
    try {
      const names = enabledSweeps().map((s) => s.name);
      const last = await prisma.sweepRun.groupBy({
        by: ["name"],
        where: { ok: true, name: { in: names } },
        _max: { finishedAt: true },
      });
      for (const n of names) lastSweepOk[n] = last.find((l) => l.name === n)?._max.finishedAt ?? null;
    } catch {
      // Leave the sweeps out rather than report them as broken.
    }
  }

  const health = evaluateDeepHealth({ now, db, pendingMigrations: pending, failedMigrations: failed, queue, lastSweepOk });
  const strict = req.nextUrl.searchParams.get("strict") === "1";
  const httpStatus = health.status === "fail" || (strict && health.status === "degraded") ? 503 : 200;
  return NextResponse.json(
    { ...health, checkedAt: now.toISOString() },
    { status: httpStatus, headers: { "Cache-Control": "no-store" } },
  );
}
