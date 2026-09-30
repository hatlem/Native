// A plan (SavedList) is ordered once. After its order, /plan shows "Ordered"
// with a link to the order instead of "Confirm order", and the checkout
// refuses to order it again (BUG-final-local-4: a second click on an ordered
// plan booked and charged a duplicate order).
//
// Why a spent plan, not "a new order when the lines change": re-ordering an
// edited plan would book every unchanged line a second time. Buying the same
// placements again is what programmes model — each wave is its own list, and
// "Plan next wave" (plan-actions duplicatePlan) copies an ordered plan into a
// new one to edit and order. So the explicit act of a new commitment is a new
// plan or wave; the ordered plan stays the record of what was ordered.
//
// Guarantees, by layer:
//   - Request.instantOrderListId is UNIQUE: at most one live instant order per
//     list, in the database, whatever races the code loses.
//   - createFirmOrder checks liveOrderForList under its per-org advisory lock,
//     so a double click or a second tab returns the first order.
//   - the checkout action checks it up front for both paths (an order that
//     came from an accepted desk quote spends the plan too).
// Cancelling every order of the request releases the plan
// (releaseInstantOrderList): nothing is booked any more, so it can be ordered.

import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export type ListOrder = {
  requestId: string;
  // Every live order of that request (one per placement market).
  orderIds: string[];
  orderedAt: Date;
};

/** The most recent live (not cancelled) order placed from this plan, by either
 *  path — the instant checkout or an accepted desk quote. Null when none. */
export async function liveOrderForList(db: Db, listId: string): Promise<ListOrder | null> {
  const latest = await db.order.findFirst({
    where: { status: { not: "CANCELLED" }, quote: { request: { sourceListId: listId } } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, quote: { select: { requestId: true } } },
  });
  if (!latest) return null;
  const orders = await db.order.findMany({
    where: { status: { not: "CANCELLED" }, quote: { requestId: latest.quote.requestId } },
    orderBy: { createdAt: "asc" },
    select: { id: true, createdAt: true },
  });
  return {
    requestId: latest.quote.requestId,
    orderIds: orders.map((o) => o.id),
    orderedAt: orders[0]?.createdAt ?? latest.createdAt,
  };
}

/**
 * Release the plan an instant order spent once nothing on its request is live
 * any more: the order just cancelled (orderId) was the last one standing.
 * Returns the query unawaited, so it can ride in an array transaction next to
 * the cancellation itself (desk-actions cancelOrder) as well as inside an
 * interactive one (billing issueFullCreditNote).
 */
export function releaseInstantOrderList(db: Db, orderId: string) {
  return db.request.updateMany({
    where: {
      instantOrderListId: { not: null },
      quotes: { some: { order: { is: { id: orderId } } } },
      NOT: { quotes: { some: { order: { is: { status: { not: "CANCELLED" } } } } } },
    },
    data: { instantOrderListId: null },
  });
}

/** Prisma's unique-violation error on Request.instantOrderListId: a second
 *  live instant order of the same plan, refused by the database. */
export function isInstantOrderListConflict(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; meta?: { target?: unknown } };
  if (e.code !== "P2002") return false;
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];
  return fields.some((f) => f.includes("instantOrderListId"));
}
