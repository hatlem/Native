// One rule for "can this quote still be accepted?", shared by the accept
// actions, the buyer's home/requests views and the desk. A quote is a firm
// offer only while it is SENT and inside its validUntil window; after that
// the price guarantee is gone and the desk must renew it.
//
// Stored status lags reality: nothing flips SENT → EXPIRED on a clock, so
// views derive the effective status here, and reconcileExpiredQuotes()
// catches the stored row up opportunistically (bookkeeping for reports).

import type { Prisma, QuoteStatus } from "@prisma/client";

/** How long a newly issued or renewed quote stays firm. */
export const QUOTE_VALIDITY_DAYS = 14;

/**
 * A buyer's "ask the desk to renew" pings the desk at most once per request
 * per window; inside it the request page shows "renewal requested" instead
 * of the button. Audit action name shared by the action and the page.
 */
export const RENEWAL_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const RENEWAL_REQUESTED_AUDIT_ACTION = "quote.renewal_requested";

type QuoteValidityFields = { status: QuoteStatus; validUntil: Date | null };

export function quoteValidUntilFrom(now: Date): Date {
  return new Date(now.getTime() + QUOTE_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
}

/** A SENT quote whose validity window has closed. */
export function isQuoteExpired(q: QuoteValidityFields, now: Date = new Date()): boolean {
  if (q.status === "EXPIRED") return true;
  return q.status === "SENT" && q.validUntil !== null && q.validUntil.getTime() <= now.getTime();
}

/** Only a SENT, unexpired quote may become an order. */
export function isQuoteAcceptable(q: QuoteValidityFields, now: Date = new Date()): boolean {
  return q.status === "SENT" && !isQuoteExpired(q, now);
}

/** The status a view should show: SENT past its window reads as EXPIRED. */
export function effectiveQuoteStatus(q: QuoteValidityFields, now: Date = new Date()): QuoteStatus {
  return isQuoteExpired(q, now) ? "EXPIRED" : q.status;
}

/**
 * Prisma filter for quotes that are still acceptable at `now` — the same rule
 * as isQuoteAcceptable, for queries (buyer home "needs you") and for the
 * compare-and-set that guards acceptance against a quote expiring mid-click.
 */
export function acceptableQuoteWhere(now: Date = new Date()): Prisma.QuoteWhereInput {
  return {
    status: "SENT",
    OR: [{ validUntil: null }, { validUntil: { gt: now } }],
  };
}

/** Prisma filter for SENT quotes whose window has closed. */
export function expiredSentQuoteWhere(now: Date = new Date()): Prisma.QuoteWhereInput {
  return { status: "SENT", validUntil: { lte: now } };
}
