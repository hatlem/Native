// Async job queue — Phase 0 ships an in-process runner that persists
// every job to the `Job` table so we keep observability + retry, but
// runs the handler in the same process (best effort, fire-and-forget).
//
// The public surface is `enqueue(kind, payload)`. Swapping to BullMQ /
// SQS later means re-implementing `enqueue` + a worker process — call
// sites don't change.

import { prisma } from "@/lib/prisma";

export type JobHandler<T> = (payload: T) => Promise<void>;

const handlers = new Map<string, JobHandler<unknown>>();

export function registerJob<T>(kind: string, handler: JobHandler<T>) {
  handlers.set(kind, handler as JobHandler<unknown>);
}

async function runOne(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return;
  const handler = handlers.get(job.kind);
  if (!handler) {
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        lastError: `no handler for kind "${job.kind}"`,
        finishedAt: new Date(),
      },
    });
    return;
  }
  await prisma.job.update({
    where: { id: job.id },
    data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
  });
  try {
    await handler(JSON.parse(job.payload));
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "DONE", finishedAt: new Date(), lastError: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "FAILED", lastError: message, finishedAt: new Date() },
    });
    console.error("job.failed", { jobId, kind: job.kind, message });
  }
}

export async function enqueue<T>(kind: string, payload: T): Promise<string> {
  const job = await prisma.job.create({
    data: { kind, payload: JSON.stringify(payload ?? null) },
  });
  // Fire-and-forget: the row is durable, so even if the process dies
  // before the handler runs, a future drainPending() picks it up.
  void runOne(job.id);
  return job.id;
}

// Manual drain — used by tests and ops endpoints. Picks up PENDING jobs
// that were enqueued in a previous process or whose runOne lost the race.
export async function drainPending(limit = 25): Promise<number> {
  const pending = await prisma.job.findMany({
    where: { status: "PENDING", runAt: { lte: new Date() } },
    orderBy: { runAt: "asc" },
    take: limit,
  });
  for (const j of pending) await runOne(j.id);
  return pending.length;
}
