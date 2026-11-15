// Durable background jobs on the `Job` table.
//
//   enqueue(kind, payload, { idempotencyKey? })   — persist, then try at once
//   registerJob(kind, handler, { maxAttempts? })  — see ./handlers.ts
//   drainPending()                                 — run what is due (worker, cron)
//
// Guarantees:
//   - A job row is committed before anything runs, so a deploy or crash never
//     loses work: the next worker tick (or /api/cron/sweeps) picks it up.
//   - Claiming is `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`, so
//     two workers (or web instances) never run the same job at the same time.
//   - A failed attempt is retried with exponential backoff (./backoff.ts) up
//     to `maxAttempts`; then the job is dead-lettered (status FAILED), logged
//     at error level (which alerts via ERROR_WEBHOOK_URL) and listed on
//     /desk/jobs, where a superadmin can retry or discard it.
//   - A worker that dies mid-job leaves a RUNNING row; after the visibility
//     timeout another worker takes it over. Delivery is therefore
//     at-least-once: handlers must be idempotent.
//   - Every attempt is a JobRun row (start, finish, error).
//
// Node runtime only.
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { log } from "@/lib/log";
import { isUniqueViolation } from "@/lib/prisma-errors";
import {
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_MAX_ATTEMPTS,
  backoffDelayMs,
  nextStepAfterFailure,
} from "./backoff";

// Throw this from a handler when retrying cannot help (the receiver rejected
// the payload, the target row is gone): the job is dead-lettered at once.
export class NonRetryableJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableJobError";
  }
}

export type JobContext = { jobId: string; attempt: number; maxAttempts: number };
export type JobHandler<T> = (payload: T, ctx: JobContext) => Promise<void>;
type Registration = { handler: JobHandler<unknown>; maxAttempts?: number; backoffBaseMs?: number };

// On globalThis so dev hot-reload and duplicated bundles share one registry.
type WorkerState = { timer: ReturnType<typeof setInterval> | null; stopping: boolean; inFlight: Promise<unknown> | null };
const g = globalThis as {
  __jobHandlers?: Map<string, Registration>;
  __jobWorker?: WorkerState;
};
const handlers = (g.__jobHandlers ??= new Map<string, Registration>());

export function registerJob<T>(
  kind: string,
  handler: JobHandler<T>,
  opts: { maxAttempts?: number; backoffBaseMs?: number } = {},
): void {
  handlers.set(kind, { handler: handler as JobHandler<unknown>, ...opts });
}

// A RUNNING job whose claim is older than this is assumed orphaned (its
// worker died) and is taken over. Handlers must finish well inside it.
export const VISIBILITY_TIMEOUT_MS = 10 * 60_000;
const MAX_ERROR_CHARS = 2000;

export const WORKER_ID = `${process.env.RAILWAY_REPLICA_ID ?? process.env.HOSTNAME ?? "local"}:${process.pid}:${crypto
  .randomBytes(3)
  .toString("hex")}`;

export type EnqueueOptions = {
  // A second enqueue with the same key returns the existing job instead of
  // creating another — use a key derived from the thing being done
  // ("invoice.archive:<invoiceId>").
  idempotencyKey?: string;
  runAt?: Date;
  maxAttempts?: number;
  // false: only persist; the worker runs it. Default: try at once.
  kick?: boolean;
};

export async function enqueue<T>(kind: string, payload: T, opts: EnqueueOptions = {}): Promise<string> {
  const reg = handlers.get(kind);
  const data = {
    kind,
    payload: JSON.stringify(payload ?? null),
    idempotencyKey: opts.idempotencyKey ?? null,
    maxAttempts: opts.maxAttempts ?? reg?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    ...(opts.runAt ? { runAt: opts.runAt } : {}),
  };
  let id: string;
  try {
    id = (await prisma.job.create({ data, select: { id: true } })).id;
  } catch (err) {
    if (!opts.idempotencyKey || !isUniqueViolation(err)) throw err;
    const existing = await prisma.job.findUnique({
      where: { idempotencyKey: opts.idempotencyKey },
      select: { id: true },
    });
    if (!existing) throw err;
    return existing.id;
  }
  const due = !opts.runAt || opts.runAt.getTime() <= Date.now();
  if (opts.kick !== false && due) {
    // Best effort for low latency; the row is durable, so if this process
    // dies first the worker loop runs it.
    void runJobNow(id).catch((err) => log.error("job.kick_failed", { jobId: id, kind, err }));
  }
  return id;
}

// Claim up to `limit` due jobs for this worker. Exported for tests.
export async function claimDueJobs(
  workerId: string,
  limit: number,
  now: Date = new Date(),
): Promise<string[]> {
  const staleBefore = new Date(now.getTime() - VISIBILITY_TIMEOUT_MS);
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE "Job"
       SET "status" = 'RUNNING'::"JobStatus",
           "attempts" = "attempts" + 1,
           "startedAt" = ${now},
           "lockedAt" = ${now},
           "lockedBy" = ${workerId},
           "updatedAt" = ${now}
     WHERE "id" IN (
       SELECT "id" FROM "Job"
        WHERE ("status" = 'PENDING'::"JobStatus" AND "runAt" <= ${now})
           OR ("status" = 'RUNNING'::"JobStatus" AND COALESCE("lockedAt", "startedAt") < ${staleBefore})
        ORDER BY "runAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
     RETURNING "id"`);
  return rows.map((r) => r.id);
}

async function claimOne(jobId: string, workerId: string, now: Date): Promise<boolean> {
  const n = await prisma.$executeRaw(Prisma.sql`
    UPDATE "Job"
       SET "status" = 'RUNNING'::"JobStatus",
           "attempts" = "attempts" + 1,
           "startedAt" = ${now},
           "lockedAt" = ${now},
           "lockedBy" = ${workerId},
           "updatedAt" = ${now}
     WHERE "id" = ${jobId} AND "status" = 'PENDING'::"JobStatus" AND "runAt" <= ${now}`);
  return n === 1;
}

async function ensureHandlers(): Promise<void> {
  const { registerJobHandlers } = await import("./handlers");
  registerJobHandlers();
}

type Settle =
  | { status: "DONE" }
  | { status: "PENDING"; runAt: Date; error: string }
  | { status: "FAILED"; error: string };

// Write the outcome only if this worker still holds the claim — a job that
// was taken over after the visibility timeout belongs to the new worker.
async function settle(jobId: string, workerId: string, runId: string, outcome: Settle, now: Date): Promise<void> {
  const error = "error" in outcome ? outcome.error.slice(0, MAX_ERROR_CHARS) : null;
  await prisma.$transaction([
    prisma.job.updateMany({
      where: { id: jobId, lockedBy: workerId, status: "RUNNING" },
      data: {
        status: outcome.status,
        lastError: error,
        lockedBy: null,
        lockedAt: null,
        ...(outcome.status === "PENDING" ? { runAt: outcome.runAt } : { finishedAt: now }),
      },
    }),
    prisma.jobRun.update({
      where: { id: runId },
      data: { finishedAt: now, ok: outcome.status === "DONE", error },
    }),
  ]);
}

// Run one job this worker has already claimed. Never throws.
type Clock = () => Date;
const realClock: Clock = () => new Date();

async function execute(
  jobId: string,
  workerId: string,
  clock: Clock = realClock,
): Promise<"done" | "retry" | "dead" | "gone"> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.lockedBy !== workerId || job.status !== "RUNNING") return "gone";
  const run = await prisma.jobRun.create({
    data: { jobId, attempt: job.attempts, workerId, startedAt: clock() },
    select: { id: true },
  });

  const deadLetter = async (error: string): Promise<"dead"> => {
    await settle(jobId, workerId, run.id, { status: "FAILED", error }, clock());
    // Error level on purpose: this is the line that reaches a human.
    log.error("job.dead_lettered", { jobId, kind: job.kind, attempts: job.attempts, reason: error.slice(0, 300) });
    return "dead";
  };

  try {
    await ensureHandlers();
    const reg = handlers.get(job.kind);
    if (!reg) return await deadLetter(`no handler for kind "${job.kind}"`);
    // More claims than attempts allowed: every earlier worker died mid-run.
    if (job.attempts > job.maxAttempts) {
      return await deadLetter(`gave up after ${job.attempts - 1} attempts; the last worker never finished`);
    }
    try {
      await reg.handler(JSON.parse(job.payload), {
        jobId,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
      });
      await settle(jobId, workerId, run.id, { status: "DONE" }, clock());
      return "done";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const step = nextStepAfterFailure({
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        nonRetryable: err instanceof NonRetryableJobError,
      });
      if (step === "dead-letter") return await deadLetter(message);
      const delay = backoffDelayMs(job.attempts, reg.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS);
      const now = clock();
      await settle(
        jobId,
        workerId,
        run.id,
        { status: "PENDING", runAt: new Date(now.getTime() + delay), error: message },
        now,
      );
      log.warn("job.retry_scheduled", { jobId, kind: job.kind, attempt: job.attempts, delayMs: delay, message });
      return "retry";
    }
  } catch (err) {
    // Bookkeeping itself failed (DB down). The claim expires and the job is
    // taken over later; nothing is lost.
    log.error("job.bookkeeping_failed", { jobId, kind: job.kind, err });
    return "gone";
  }
}

// Run this one job now if it is due and unclaimed. Returns whether it ran.
export async function runJobNow(jobId: string, workerId: string = WORKER_ID): Promise<boolean> {
  if (!(await claimOne(jobId, workerId, new Date()))) return false;
  await execute(jobId, workerId);
  return true;
}

export type DrainResult = { ran: number; done: number; retried: number; dead: number };

// Run due jobs, oldest first, until none are left or `limit` have run.
// Sequential on purpose: handlers do I/O against third parties and the DB.
// `now` is injectable so tests can run on a clock no other worker shares.
export async function drainPending(
  limit = 25,
  opts: { workerId?: string; batch?: number; now?: Clock } = {},
): Promise<DrainResult> {
  const workerId = opts.workerId ?? WORKER_ID;
  const clock = opts.now ?? realClock;
  const batch = Math.max(1, opts.batch ?? 5);
  const out: DrainResult = { ran: 0, done: 0, retried: 0, dead: 0 };
  while (out.ran < limit) {
    const ids = await claimDueJobs(workerId, Math.min(batch, limit - out.ran), clock());
    if (ids.length === 0) break;
    for (const id of ids) {
      const r = await execute(id, workerId, clock);
      out.ran++;
      if (r === "done") out.done++;
      else if (r === "retry") out.retried++;
      else if (r === "dead") out.dead++;
    }
  }
  return out;
}

// ---------- worker loop ----------

const POLL_MS = 10_000;
const MAINTENANCE_EVERY_MS = 6 * 60 * 60_000;
// Finished jobs can carry message bodies (queued email); don't keep them.
export const FINISHED_JOB_RETENTION_DAYS = 30;
export const SWEEP_RUN_RETENTION_DAYS = 90;
export const WEBHOOK_RECEIPT_RETENTION_DAYS = 30;

export async function purgeFinishedJobs(now: Date = new Date()): Promise<{ jobs: number; receipts: number; sweepRuns: number }> {
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const [jobs, receipts, sweepRuns] = await Promise.all([
    prisma.job.deleteMany({
      where: { status: { in: ["DONE", "DISCARDED"] }, finishedAt: { lt: days(FINISHED_JOB_RETENTION_DAYS) } },
    }),
    prisma.webhookReceipt.deleteMany({ where: { receivedAt: { lt: days(WEBHOOK_RECEIPT_RETENTION_DAYS) } } }),
    prisma.sweepRun.deleteMany({ where: { startedAt: { lt: days(SWEEP_RUN_RETENTION_DAYS) } } }),
  ]);
  return { jobs: jobs.count, receipts: receipts.count, sweepRuns: sweepRuns.count };
}

// Poll for due jobs in this process. Idempotent; JOB_WORKER=0 turns it off
// (then /api/cron/sweeps is the only runner, apart from the enqueue kick).
export function startJobWorker(): void {
  if (process.env.JOB_WORKER === "0" || g.__jobWorker) return;
  let lastMaintenance = 0;
  const state: WorkerState = { stopping: false, inFlight: null, timer: null };
  state.timer = setInterval(() => {
      if (state.stopping || state.inFlight) return;
      state.inFlight = (async () => {
        try {
          await drainPending(25);
          if (Date.now() - lastMaintenance > MAINTENANCE_EVERY_MS) {
            lastMaintenance = Date.now();
            await purgeFinishedJobs();
          }
        } catch (err) {
          log.error("job.worker_tick_failed", { err });
        } finally {
          state.inFlight = null;
        }
      })();
    }, POLL_MS);
  state.timer.unref();
  g.__jobWorker = state;
  // Graceful stop: take no new batch and let the running one finish. A job
  // cut off anyway is taken over after the visibility timeout.
  process.once("SIGTERM", () => void stopJobWorker());
}

export async function stopJobWorker(): Promise<void> {
  const state = g.__jobWorker;
  if (!state) return;
  state.stopping = true;
  if (state.timer) clearInterval(state.timer);
  if (state.inFlight) await state.inFlight.catch(() => undefined);
  g.__jobWorker = undefined;
}

// ---------- desk operations ----------

// Put a dead-lettered job back in the queue with a fresh attempt budget.
export async function retryDeadJob(jobId: string): Promise<boolean> {
  const res = await prisma.job.updateMany({
    where: { id: jobId, status: "FAILED" },
    data: { status: "PENDING", attempts: 0, runAt: new Date(), finishedAt: null, lockedBy: null, lockedAt: null },
  });
  return res.count === 1;
}

export async function discardDeadJob(jobId: string): Promise<boolean> {
  const res = await prisma.job.updateMany({
    where: { id: jobId, status: "FAILED" },
    data: { status: "DISCARDED", finishedAt: new Date() },
  });
  return res.count === 1;
}

export type QueueStats = {
  pending: number;
  running: number;
  dead: number;
  // Age of the oldest job that is due but has not started.
  oldestDueAgeMs: number | null;
};

export async function queueStats(now: Date = new Date()): Promise<QueueStats> {
  const [pending, running, dead, oldest] = await Promise.all([
    prisma.job.count({ where: { status: "PENDING" } }),
    prisma.job.count({ where: { status: "RUNNING" } }),
    prisma.job.count({ where: { status: "FAILED" } }),
    prisma.job.findFirst({
      where: { status: "PENDING", runAt: { lte: now } },
      orderBy: { runAt: "asc" },
      select: { runAt: true },
    }),
  ]);
  return { pending, running, dead, oldestDueAgeMs: oldest ? now.getTime() - oldest.runAt.getTime() : null };
}
