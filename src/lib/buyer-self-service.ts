// Rules for the three things a buyer can do to back out, without calling the
// desk: decline a sent quote, withdraw a request that has no order yet, and
// ask for a confirmed order to be cancelled. Pure — the server actions in
// src/app/buyer-self-service-actions.ts own auth, the writes and the notices.

export const SELF_SERVICE_REASON_MAX = 1000;

/** Trim and bound the free-text reason; "" → null. */
export function normalizeReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/\s+\n/g, "\n").slice(0, SELF_SERVICE_REASON_MAX);
  return v.length > 0 ? v : null;
}

type QuoteLike = { status: string; order: { id: string } | null };

/** A buyer can decline an offer that is on the table: sent, and not yet an order.
 *  (An expired SENT quote can be declined too — it closes the loop for win/loss.) */
export function canDeclineQuote(q: QuoteLike): boolean {
  return q.status === "SENT" && !q.order;
}

type RequestLike = { status: string; quotes: QuoteLike[] };

/** A request can be withdrawn while the desk is still working on it and nothing
 *  has been bought: SUBMITTED / IN_REVIEW / QUOTED with no order on any quote. */
export function canWithdrawRequest(r: RequestLike): boolean {
  if (!["SUBMITTED", "IN_REVIEW", "QUOTED"].includes(r.status)) return false;
  return !r.quotes.some((q) => q.order !== null || q.status === "ACCEPTED");
}

type OrderLike = { status: string; cancellationRequestedAt: Date | null };

/** Orders the buyer can ask to cancel. COMPLETED / INVOICED work is delivered —
 *  that is a credit-note conversation, not a cancellation — and a CANCELLED
 *  order is already there. One open ask at a time. */
export const CANCELLABLE_ORDER_STATUSES = ["CONFIRMED", "IN_PRODUCTION", "SCHEDULED", "LIVE"] as const;

export function canRequestCancellation(o: OrderLike): boolean {
  return (
    (CANCELLABLE_ORDER_STATUSES as readonly string[]).includes(o.status) &&
    o.cancellationRequestedAt === null
  );
}

/** CSAT is asked once the work is delivered. */
export function canGiveFeedback(orderStatus: string): boolean {
  return orderStatus === "COMPLETED" || orderStatus === "INVOICED";
}

export function isCsatScore(n: unknown): n is 1 | 2 | 3 | 4 | 5 {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5;
}
