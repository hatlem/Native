// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import { prisma } from "@/lib/prisma";
import { assertDeskContext, type DeskContext } from "@/lib/desk-guard";

// from src/app/[locale]/desk/jobs/page.tsx
export async function loadDead(
  ctx: DeskContext,
  args: { DEAD_SHOWN: number },
) {
  assertDeskContext(ctx);
  const { DEAD_SHOWN } = args;
  return prisma.job.findMany({
    where: { status: "FAILED" },
    orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
    take: DEAD_SHOWN,
    select: { id: true, kind: true, attempts: true, lastError: true, createdAt: true, finishedAt: true },
  });
}

// from src/app/[locale]/desk/jobs/page.tsx
export async function loadRecent(
  ctx: DeskContext,
  args: { RECENT: number },
) {
  assertDeskContext(ctx);
  const { RECENT } = args;
  return prisma.job.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: RECENT,
    select: { id: true, kind: true, status: true, attempts: true, maxAttempts: true, runAt: true, createdAt: true },
  });
}

// from src/app/[locale]/desk/jobs/page.tsx
export async function loadSweeps(
  ctx: DeskContext,
  args: { SWEEP_RUNS: number },
) {
  assertDeskContext(ctx);
  const { SWEEP_RUNS } = args;
  return prisma.sweepRun.findMany({
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: SWEEP_RUNS,
  });
}
