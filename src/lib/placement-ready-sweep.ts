// Placement-ready sweep — finds SavedListItem placeholders (titleId set,
// productId null) whose Title has since gained a confirmed, bookable
// Product, and nudges the buyer's org + the desk to resolve it via the
// "Use placement" action. Never sets productId itself — that stays a human
// decision (resolveTitleLine, src/app/list-actions.ts), preserving the
// desk-RFQ gate an unresolved placeholder always forces.
//
// Copy lives in placement-ready-notice.ts (localized by the org's market,
// same convention as programme-autosend-notice.ts).
//
// Idempotency reuses AuditLog as a per-item marker — the same trick
// metrics-sweep.ts uses for its once-per-day latch, keyed per item
// instead of per day, so a given placeholder is ever notified once.

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { notifyOrg, notifyDesk } from "@/lib/notify";
import { buildPlacementReadyNotice } from "@/lib/placement-ready-notice";

const NOTIFIED_ACTION = "placement-ready.notified";
const entityFor = (itemId: string) => `SavedListItem:${itemId}`;

// One sweep notifies at most this many placeholders. The sweep is hourly, so a
// backlog drains within a few runs; an unbounded burst (the first deploy, where
// every stale placeholder system-wide qualifies at once) would flood the desk
// inbox and risk the sweep's own transaction timeout. Capped items are simply
// not marked notified, so the next tick picks them up. Same shape and size as
// programme-autosend's MAX_SENDS_PER_SWEEP.
const MAX_NOTIFICATIONS_PER_SWEEP = 25;

export type PlacementReadySweepResult = { notified: number; failed: number };

export async function runPlacementReadySweep(): Promise<PlacementReadySweepResult> {
  const placeholders = await prisma.savedListItem.findMany({
    // Archived lists are excluded — not to reduce noise, but for link
    // correctness: resolveActiveList refuses to render an archived list and
    // silently falls back to another one, so the notification's deep link
    // could not land the buyer on the plan it talks about.
    where: { productId: null, titleId: { not: null }, list: { archivedAt: null } },
    select: {
      id: true,
      titleId: true,
      list: {
        select: {
          id: true,
          name: true,
          organizationId: true,
          organization: { select: { marketCode: true } },
        },
      },
      title: { select: { name: true } },
    },
  });
  if (placeholders.length === 0) return { notified: 0, failed: 0 };

  let notified = 0;
  let failed = 0;
  let processed = 0;
  for (const item of placeholders) {
    if (notified >= MAX_NOTIFICATIONS_PER_SWEEP) {
      console.warn("placement-ready.capped", { deferred: placeholders.length - processed });
      break;
    }
    processed++;
    // Per-item isolation: one placeholder whose notification write throws must
    // not abort the sweep. Without this, the failing item would block every
    // placeholder ordered after it on EVERY tick (the scan is deterministic)
    // and the audit marker would never be written — silently, forever.
    try {
      const entity = entityFor(item.id);
      const already = await prisma.auditLog.findFirst({
        where: { entity, action: NOTIFIED_ACTION },
        select: { id: true },
      });
      if (already) continue;

      const product = await prisma.product.findFirst({
        where: { titleId: item.titleId!, active: true, bookable: true, confirmedAt: { not: null } },
        select: { id: true },
      });
      if (!product) continue;

      // Buyer copy in the org's market language; desk copy in English, the
      // source language of this codebase (there is no per-desk-user locale).
      const buyer = buildPlacementReadyNotice({
        marketCode: item.list.organization.marketCode,
        titleName: item.title!.name,
        listName: item.list.name,
        listId: item.list.id,
      });
      const desk = buildPlacementReadyNotice({
        marketCode: null,
        titleName: item.title!.name,
        listName: item.list.name,
        listId: item.list.id,
        locale: "en",
      });

      await Promise.all([
        notifyOrg(item.list.organizationId, {
          kind: "TITLE_PRODUCT_READY",
          title: buyer.title,
          body: buyer.body,
          link: buyer.link,
        }),
        notifyDesk({
          kind: "TITLE_PRODUCT_READY",
          title: desk.title,
          body: desk.body,
          link: desk.link,
        }),
      ]);
      await recordAudit(null, NOTIFIED_ACTION, entity, { productId: product.id });
      notified++;
    } catch (err) {
      failed++;
      console.error("placement-ready.item_failed", { itemId: item.id, err });
    }
  }
  return { notified, failed };
}

/** Same xact-scoped advisory-lock pattern as the metrics sweep: null means
 *  another instance holds the lock this tick. */
export async function runPlacementReadySweepWithLock(): Promise<PlacementReadySweepResult | null> {
  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<[{ locked: boolean }]>`
        SELECT pg_try_advisory_xact_lock(hashtext('placement-ready-sweep')) AS locked`;
      if (!locked) return null;
      return runPlacementReadySweep();
    },
    { timeout: 5 * 60_000, maxWait: 10_000 },
  );
}
