// The scheduled sweeps, as one registry used by BOTH runners:
//   - the in-process timers in instrumentation-node.ts (default), and
//   - GET/POST /api/cron/sweeps, for an external scheduler (Railway cron).
// Every sweep is safe to run from several places at once: they take a
// Postgres advisory lock, a daily latch, or are revision-guarded.
//
// Node runtime only (the sweeps reach Prisma and node:crypto) — import this
// dynamically, never from the edge compile.
import { log } from "@/lib/log";

export type SweepName = "autosend" | "metrics" | "price-bands" | "placement-ready" | "retention";

export type SweepDef = {
  name: SweepName;
  // Env kill switch: the sweep is off when this variable is "0".
  envFlag: string;
  // Delay after boot for the in-process scheduler, so jobs never contend.
  offsetMs: number;
  // Resolves to a one-line summary and whether any unit of work failed.
  run: () => Promise<{ summary: string; failed: number }>;
};

export const SWEEPS: SweepDef[] = [
  {
    name: "autosend",
    envFlag: "AUTOSEND_SWEEP",
    offsetMs: 0,
    run: async () => {
      const { runAutoSendSweepWithLock } = await import("@/lib/programme-autosend");
      const res = await runAutoSendSweepWithLock();
      if (!res) return { summary: "skipped: another instance holds the lock", failed: 0 };
      return { summary: `done: sent=${res.sent} skipped=${res.skipped} failed=${res.failed}`, failed: res.failed };
    },
  },
  {
    name: "metrics",
    envFlag: "METRICS_SWEEP",
    offsetMs: 5 * 60_000,
    run: async () => {
      const { runMetricsSweepWithLock } = await import("@/lib/metrics-sweep");
      const res = await runMetricsSweepWithLock();
      if (!res) return { summary: "skipped: another instance holds the lock", failed: 0 };
      if (!res.ran) return { summary: "skipped: already ran today (latch)", failed: 0 };
      return {
        summary: `done: created=${res.built?.requests_created ?? 0} frozen=${res.frozen ?? 0} sent=${res.sent ?? 0} failed=${res.failed ?? 0} skipped=${JSON.stringify(res.skipped ?? {})}`,
        failed: res.failed ?? 0,
      };
    },
  },
  {
    // Recomputes the stored catalog price bands the DB triggers invalidated
    // (lib/pricing/title-band.ts). Its first tick after a deploy is also the
    // backfill of the migration that introduced the column. No lock: the
    // writes are revision-guarded, so two instances only duplicate work.
    name: "price-bands",
    envFlag: "PRICE_BAND_SWEEP",
    offsetMs: 60_000,
    run: async () => {
      const { runTitlePriceBandSweep } = await import("@/lib/pricing/title-band");
      return { summary: await runTitlePriceBandSweep(), failed: 0 };
    },
  },
  {
    name: "placement-ready",
    envFlag: "PLACEMENT_READY_SWEEP",
    offsetMs: 10 * 60_000,
    run: async () => {
      const { runPlacementReadySweepWithLock } = await import("@/lib/placement-ready-sweep");
      const res = await runPlacementReadySweepWithLock();
      if (!res) return { summary: "skipped: another instance holds the lock", failed: 0 };
      return { summary: `done: notified=${res.notified} failed=${res.failed}`, failed: res.failed };
    },
  },
  {
    // Deletes spent tokens / dead invites / old idempotency keys and scrubs
    // IPs and emails out of audit rows past 90 days (lib/retention.ts).
    // Advisory lock + once-per-UTC-day latch, like the metrics sweep.
    name: "retention",
    envFlag: "RETENTION_SWEEP",
    offsetMs: 15 * 60_000,
    run: async () => {
      const { runRetentionSweepWithLock } = await import("@/lib/retention");
      const res = await runRetentionSweepWithLock();
      if (!res) return { summary: "skipped: another instance holds the lock", failed: 0 };
      if (!res.ran) return { summary: "skipped: already ran today (latch)", failed: 0 };
      return {
        summary: `done: tokens=${res.tokens} invites=${res.invites} idempotencyKeys=${res.idempotencyKeys} auditScrubbed=${res.auditScrubbed}`,
        failed: 0,
      };
    },
  },
];

export function enabledSweeps(env: NodeJS.ProcessEnv = process.env): SweepDef[] {
  return SWEEPS.filter((s) => env[s.envFlag] !== "0");
}

export type SweepOutcome = { name: SweepName; ok: boolean; summary: string; failed: number; ms: number };

// Run one sweep and log the outcome. Never throws: a crashing sweep is an
// error log line (which alerts via ERROR_WEBHOOK_URL), and the next tick
// retries. Partial failures (failed > 0) alert too — they were previously
// only visible to someone reading the logs.
export async function runSweep(def: SweepDef, via: "timer" | "cron"): Promise<SweepOutcome> {
  const started = Date.now();
  let outcome: SweepOutcome;
  try {
    const { summary, failed } = await def.run();
    const ms = Date.now() - started;
    if (failed > 0) log.error("sweep.partial_failure", { sweep: def.name, via, summary, failed, ms });
    else log.info("sweep.done", { sweep: def.name, via, summary, ms });
    outcome = { name: def.name, ok: failed === 0, summary, failed, ms };
  } catch (err) {
    const ms = Date.now() - started;
    log.error("sweep.crashed", { sweep: def.name, via, err, ms });
    outcome = { name: def.name, ok: false, summary: "crashed", failed: 1, ms };
  }
  await recordSweepRun(outcome, via, started);
  return outcome;
}

// Run history (SweepRun), read by /desk/jobs and /api/health/deep. Ticks that
// did nothing because another instance held the lock or the daily latch was
// set are not stored — they would bury the real runs.
export function isSkippedSweep(summary: string): boolean {
  return summary.startsWith("skipped:");
}

async function recordSweepRun(o: SweepOutcome, via: "timer" | "cron", startedMs: number): Promise<void> {
  if (o.ok && isSkippedSweep(o.summary)) return;
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.sweepRun.create({
      data: {
        name: o.name,
        via,
        startedAt: new Date(startedMs),
        finishedAt: new Date(startedMs + o.ms),
        ok: o.ok,
        failed: o.failed,
        summary: o.summary.slice(0, 1000),
      },
    });
  } catch (err) {
    log.warn("sweep.history_write_failed", { sweep: o.name, err });
  }
}
