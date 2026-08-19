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
      organization: { select: { id: true, name: true } },
    },
  });
  if (!list || list.archivedAt || list.requests.length > 0 || list.items.length === 0) {
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
  // they land where the quote will appear. Notification copy is deliberately
  // neutral English (notifications have no per-user locale yet).
  await notifyOrg(list.organizationId, {
    kind: "RFQ_SUBMITTED",
    title: `Wave ${wave.waveNumber} of ${wave.plannedWaves} sent to the desk`,
    body: `${wave.programmeName}: this wave was submitted automatically. You approve the quote before anything is booked.`,
    link: `/en/requests/${result.requestId}`,
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
export async function runAutoSendSweep(now: Date = new Date()): Promise<AutoSendSweepResult> {
  const due = await findDueAutoSendWaves(now);
  const result: AutoSendSweepResult = { sent: 0, skipped: 0, failed: 0 };
  for (const wave of due) {
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
 * holder has the lock. Session advisory locks are per-connection and Prisma
 * pools connections, so lock and unlock are issued inside one interactive
 * transaction — that pins a single connection, guaranteeing the unlock hits
 * the same backend that took the lock. The transaction itself carries no
 * writes; it exists purely to pin the connection for the lock's lifetime.
 */
export async function runAutoSendSweepWithLock(now: Date = new Date()): Promise<AutoSendSweepResult | null> {
  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<[{ locked: boolean }]>`
        SELECT pg_try_advisory_lock(hashtext('programme-autosend')) AS locked`;
      if (!locked) return null;
      try {
        return await runAutoSendSweep(now);
      } finally {
        await tx.$queryRaw`SELECT pg_advisory_unlock(hashtext('programme-autosend'))`;
      }
    },
    // A sweep can take a while (one RFQ transaction per due wave); default
    // interactive-transaction timeout is 5s, far too tight.
    { timeout: 10 * 60_000, maxWait: 10_000 },
  );
}
