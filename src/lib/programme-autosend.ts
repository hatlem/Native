// Auto-send sweep for campaign programmes that opted in (autoSendEnabled).
// Finds due waves — same due rules the buyer-facing nudge uses — and submits
// each one to the desk as a normal RFQ via submitListAsRfq. Nothing here
// books or charges anything: the wave becomes a Request the desk prices and
// the buyer still approves. Runs from instrumentation.ts on a timer (behind a
// Postgres advisory lock so parallel Railway instances never double-run) and
// from scripts/send-due-waves.ts by hand.

import { prisma } from "@/lib/prisma";
import { findDueAutoSendWaves, type DueWave } from "@/lib/programme";
import { submitListAsRfq, RFQ_LIST_INCLUDE } from "@/lib/commerce/submit-rfq";
import { notifyOrg } from "@/lib/notify";
import { recordAudit } from "@/lib/audit";
import { buildAutoSendNotice } from "@/lib/programme-autosend-notice";

export type AutoSendSweepResult = { sent: number; skipped: number; failed: number };

async function sendDueWave(wave: DueWave): Promise<"sent" | "skipped"> {
  // Re-load the wave's list fresh: the due scan is a snapshot, and between it
  // and this write the buyer may have archived the list, emptied it, or
  // submitted it themselves. Any existing Request means the wave was already
  // sent — skip, never double-submit (findDueWaves only returns draft waves,
  // so this is a belt-and-braces re-check at write time).
  const list = await prisma.savedList.findUnique({
    where: { id: wave.listId },
    include: {
      ...RFQ_LIST_INCLUDE,
      requests: { select: { id: true }, take: 1 },
      organization: { select: { id: true, name: true, marketCode: true } },
    },
  });
  if (!list || list.archivedAt || list.requests.length > 0 || list.items.length === 0) {
    return "skipped";
  }
  // The manual submit path gates on onboarding (org.marketCode drives VAT and
  // invoice currency on the quote we're about to ask the desk to mint). A
  // system submit can't detour the buyer through /onboarding, so an
  // un-onboarded org is skipped — the human nudge on Home still shows.
  if (!list.organization.marketCode) {
    console.warn("programme.autosend_skipped", { reason: "onboarding", listId: wave.listId });
    return "skipped";
  }

  const result = await submitListAsRfq({
    list,
    org: { id: list.organization.id, name: list.organization.name },
    // The wave's stored brief fields — what the buyer set on the list (waves
    // copy them from wave 1). brief.text stays empty: the desk-facing brief
    // becomes the wave's article-angle line via withWaveAngle.
    brief: {
      text: "",
      goal: list.goal,
      audience: list.audienceNote,
      budget: list.budget != null ? Number(list.budget) : null,
      targetGeo: list.targetGeo,
      targetAudience: list.targetAudience,
      targetContext: list.targetContext,
    },
    actorUserId: null, // system actor — recorded as "system" in the audit log
  });
  if (result.outcome !== "submitted") return "skipped";

  // Tell the buying org their wave went out — with a link to the request so
  // they land where the quote will appear. Localized by the org's market,
  // same convention as the ORDER_COMPLETED notice.
  const notice = buildAutoSendNotice({
    marketCode: list.organization.marketCode,
    programmeName: wave.programmeName,
    waveNumber: wave.waveNumber,
    plannedWaves: wave.plannedWaves,
    requestId: result.requestId,
  });
  await notifyOrg(list.organizationId, {
    kind: "RFQ_SUBMITTED",
    title: notice.title,
    body: notice.body,
    link: notice.link,
  });
  await recordAudit(null, "programme.autosend", `Request:${result.requestId}`, {
    programmeId: wave.programmeId,
    listId: wave.listId,
    waveNumber: wave.waveNumber,
    reason: wave.reason,
  });
  return "sent";
}

/**
 * One sweep over every opted-in programme. Per-wave failures are contained —
 * one broken wave must not stop the others — and counted in `failed`.
 */
// One sweep sends at most this many waves. The sweep is hourly, so a backlog
// drains within a few runs; an unbounded burst (say, after long downtime)
// would hammer the desk inbox and the notification fan-out all at once.
const MAX_SENDS_PER_SWEEP = 25;

export async function runAutoSendSweep(now: Date = new Date()): Promise<AutoSendSweepResult> {
  const due = await findDueAutoSendWaves(now);
  const result: AutoSendSweepResult = { sent: 0, skipped: 0, failed: 0 };
  for (const wave of due) {
    if (result.sent >= MAX_SENDS_PER_SWEEP) {
      console.warn("programme.autosend_capped", { deferred: due.length - result.sent - result.skipped - result.failed });
      break;
    }
    try {
      result[await sendDueWave(wave)]++;
    } catch (err) {
      result.failed++;
      console.error("programme.autosend_failed", { listId: wave.listId, programmeId: wave.programmeId, err });
    }
  }
  return result;
}

/**
 * The sweep behind a Postgres advisory lock, so several app instances (or a
 * manual run racing the timer) never double-send. Returns null when another
 * holder has the lock.
 *
 * TRANSACTION-scoped lock (pg_try_advisory_xact_lock), not a session lock:
 * Postgres releases it on commit AND on rollback/timeout, so a sweep that
 * blows the interactive-transaction timeout can never strand the lock on a
 * pooled connection (a leaked session lock would silently kill every future
 * sweep until the process restarts — same xact-lock convention as
 * firm-order.ts / submit-rfq.ts / lists.ts).
 */
export async function runAutoSendSweepWithLock(now: Date = new Date()): Promise<AutoSendSweepResult | null> {
  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<[{ locked: boolean }]>`
        SELECT pg_try_advisory_xact_lock(hashtext('programme-autosend')) AS locked`;
      if (!locked) return null;
      return runAutoSendSweep(now);
    },
    // A sweep can take a while (one RFQ transaction per due wave); default
    // interactive-transaction timeout is 5s, far too tight.
    { timeout: 10 * 60_000, maxWait: 10_000 },
  );
}
