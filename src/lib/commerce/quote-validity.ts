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

/** Longest validity the desk may give a quote — a firm price further out
 *  than this is a rate-card promise, not an offer. */
export const QUOTE_VALIDITY_MAX_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export function quoteValidUntilFrom(now: Date): Date {
  return new Date(now.getTime() + QUOTE_VALIDITY_DAYS * DAY_MS);
}

/** The desk's "valid until" date field: YYYY-MM-DD, prefilled with the
 *  default window. Dates are UTC calendar days — the same day the buyer's
 *  quote page and the email print (toISOString().slice(0, 10)). */
export function quoteValidUntilInputValue(now: Date, date: Date = quoteValidUntilFrom(now)): string {
  return date.toISOString().slice(0, 10);
}

export type ParsedValidUntil =
  | { ok: true; validUntil: Date }
  | { ok: false; reason: "invalid" | "past" | "too-far" };

/**
 * Parse the desk's chosen validity date. The quote is valid THROUGH that day:
 * validUntil is its last millisecond (UTC), so "valid until 14 Oct" never
 * lapses on the morning of the 14th. Today is allowed (a same-day offer);
 * anything past QUOTE_VALIDITY_MAX_DAYS is refused. A blank field falls back
 * to the default window.
 */
export function parseQuoteValidUntil(raw: string, now: Date = new Date()): ParsedValidUntil {
  const value = raw.trim();
  if (value === "") return { ok: true, validUntil: quoteValidUntilFrom(now) };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return { ok: false, reason: "invalid" };
  const [, y, m, d] = match.map(Number);
  const endOfDay = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
  // Date.UTC rolls 2026-02-31 over to March — reject instead of guessing.
  if (endOfDay.getUTCMonth() !== m - 1 || endOfDay.getUTCDate() !== d) {
    return { ok: false, reason: "invalid" };
  }
  if (endOfDay.getTime() <= now.getTime()) return { ok: false, reason: "past" };
  if (endOfDay.getTime() > now.getTime() + (QUOTE_VALIDITY_MAX_DAYS + 1) * DAY_MS) {
    return { ok: false, reason: "too-far" };
  }
  return { ok: true, validUntil: endOfDay };
}

/**
 * Prisma filter for the quotes a BUYER may see. A DRAFT is the desk's work in
 * progress — lines still being priced, no validity yet — and must never reach
 * the buyer's request page, lists, Home, API or export until the desk sends
 * it. Every buyer-facing quote read spreads this in.
 */
export function buyerVisibleQuoteWhere(): Prisma.QuoteWhereInput {
  return { status: { not: "DRAFT" } };
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
