// Daily campaign-metrics sweep — the scheduled replacement for running
// `pnpm build-metrics-campaign` / `send-metrics-batch` / `freeze-metrics-campaigns`
// by hand. One sweep: scan ended flights into MetricsRequests, freeze
// campaigns whose collection window closed, then send the day's batch of
// publisher emails (initial + dunning steps).
//
// Safety model, in order:
//  1. pg_try_advisory_xact_lock — only one app instance runs at a time
//     (xact-scoped: released on commit AND rollback/timeout, never leaks).
//  2. A once-per-day latch INSIDE the lock: the newest AuditLog marker row
//     within 20h wins. The marker is written BEFORE any email goes out, so a
//     crash mid-send can only ever UNDER-send today — publisher emails must
//     never double-send. (The scripts remain available for manual catch-up.)
//  3. outreachLimiter (8/h) still paces individual sends; a rate-limited
//     batch simply resumes on a later day's sweep.

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import {
  buildMetricsCampaign,
  freezeDueCampaigns,
  selectMetricsBatchForSend,
  sendMetricsRequestStep,
} from "@/lib/campaign-reporting/campaign";

const LATCH_ENTITY = "MetricsSweep:daily";
// 20h, not 24: an hourly tick drifting a few minutes per day must not skip
// a whole day because yesterday's run finished 23h58m ago.
const LATCH_WINDOW_MS = 20 * 3_600_000;

export type MetricsSweepResult = {
  ran: boolean;
  built?: { requests_created: number; needs_contact: number; orders_scanned: number };
  frozen?: number;
  sent?: number;
  skipped?: Record<string, number>;
};

/** True exactly once per latch window: checks for a fresh marker and writes
 *  one atomically-enough (callers hold the advisory lock, which serializes
 *  check-then-write across instances). */
export async function acquireDailyLatch(now: Date = new Date()): Promise<boolean> {
  const recent = await prisma.auditLog.findFirst({
    where: { entity: LATCH_ENTITY, createdAt: { gt: new Date(now.getTime() - LATCH_WINDOW_MS) } },
    select: { id: true },
  });
  if (recent) return false;
  await recordAudit(null, "metrics.sweep", LATCH_ENTITY, { at: now.toISOString() });
  return true;
}

/** The sweep body. Caller must hold the advisory lock. */
export async function runMetricsSweep(now: Date = new Date()): Promise<MetricsSweepResult> {
  if (!(await acquireDailyLatch(now))) return { ran: false };

  // The scan attributes created MetricsRequests to an operator; without a
  // superadmin (fresh/dev environments) we skip the build but still send any
  // batch that already exists.
  const operator = await prisma.user.findFirst({
    where: { role: "SUPERADMIN" },
    select: { id: true },
  });

  const built = operator
    ? await buildMetricsCampaign({ createdById: operator.id, now })
    : undefined;
  if (!operator) console.warn("[metrics] no SUPERADMIN operator — build step skipped");
  const { frozen } = await freezeDueCampaigns({ now });

  const cap = Number(process.env.METRICS_DAILY_CAP ?? 30);
  const batch = await selectMetricsBatchForSend({ limit: Number.isFinite(cap) && cap > 0 ? cap : 30 });
  let sent = 0;
  const skipped: Record<string, number> = {};
  for (const r of batch) {
    const res = await sendMetricsRequestStep({ requestId: r.id, actorId: operator?.id ?? "system" });
    if ("sent" in res) {
      sent++;
    } else {
      skipped[res.skipped] = (skipped[res.skipped] ?? 0) + 1;
      // The hourly limiter is exhausted — the rest of the batch resumes on a
      // later sweep; hammering on would just burn the loop.
      if (res.skipped === "rate_limited") break;
    }
  }
  return { ran: true, built, frozen, sent, skipped };
}

/** The sweep behind the same xact-scoped advisory-lock pattern as
 *  programme-autosend: null = another instance holds the lock this tick. */
export async function runMetricsSweepWithLock(now: Date = new Date()): Promise<MetricsSweepResult | null> {
  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<[{ locked: boolean }]>`
        SELECT pg_try_advisory_xact_lock(hashtext('metrics-sweep')) AS locked`;
      if (!locked) return null;
      return runMetricsSweep(now);
    },
    // A full batch of 30 sends with per-send DB writes takes a while.
    { timeout: 10 * 60_000, maxWait: 10_000 },
  );
}
