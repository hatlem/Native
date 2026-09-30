// One rule for "can this quote still be accepted?", shared by the accept
// actions, the buyer's home/requests views and the desk. A quote is a firm
// offer only while it is SENT and inside its validUntil window; after that
// the price guarantee is gone and the desk must renew it.
//
// Stored status lags reality: nothing flips SENT → EXPIRED on a clock, so
// views derive the effective status here, and reconcileExpiredQuotes()
// catches the stored row up opportunistically (bookkeeping for reports).

import type { Prisma, QuoteStatus } from "@prisma/client";
import { HOUSE_TIME_ZONE } from "@/lib/markets";
import { intlLocale } from "@/lib/money";
import { zonedDateString, zonedEndOfDay } from "@/lib/time-zone";

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
 *  default window. The day is a calendar day in the buyer organisation's
 *  time zone (marketTimeZone), the zone every surface prints it in. */
export function quoteValidUntilInputValue(
  now: Date,
  date: Date = quoteValidUntilFrom(now),
  timeZone: string = HOUSE_TIME_ZONE,
): string {
  return zonedDateString(date, timeZone);
}

export type ParsedValidUntil =
  | { ok: true; validUntil: Date }
  | { ok: false; reason: "invalid" | "past" | "too-far" };

/**
 * Parse the desk's chosen validity date. The quote is valid THROUGH that day
 * on the buyer's calendar: validUntil is the last millisecond of the day in
 * `timeZone` (the buyer organisation's, see marketTimeZone), so "valid until
 * 14 Oct" never lapses on the morning of the 14th, and doesn't run on into
 * the 15th either (23:59 UTC is already 01:59 on the 15th in Oslo). Today is
 * allowed (a same-day offer); anything past QUOTE_VALIDITY_MAX_DAYS is
 * refused. A blank field means the default window, through its last day.
 */
export function parseQuoteValidUntil(
  raw: string,
  now: Date = new Date(),
  timeZone: string = HOUSE_TIME_ZONE,
): ParsedValidUntil {
  const value = raw.trim() || quoteValidUntilInputValue(now, quoteValidUntilFrom(now), timeZone);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return { ok: false, reason: "invalid" };
  const [, y, m, d] = match.map(Number);
  // Date.UTC rolls 2026-02-31 over to March — reject instead of guessing.
  const calendarDay = new Date(Date.UTC(y, m - 1, d));
  if (calendarDay.getUTCMonth() !== m - 1 || calendarDay.getUTCDate() !== d) {
    return { ok: false, reason: "invalid" };
  }
  const endOfDay = zonedEndOfDay(y, m, d, timeZone);
  if (endOfDay.getTime() <= now.getTime()) return { ok: false, reason: "past" };
  if (endOfDay.getTime() > now.getTime() + (QUOTE_VALIDITY_MAX_DAYS + 1) * DAY_MS) {
    return { ok: false, reason: "too-far" };
  }
  return { ok: true, validUntil: endOfDay };
}

/**
 * A quote's validity date as the buyer reads it: the calendar day in their
 * organisation's zone, in the viewer's language. Every surface (desk, buyer
 * page, PDF) formats through this so they can't print different days for
 * one deadline, whatever zone the server runs in.
 */
export function formatQuoteValidUntil(
  validUntil: Date,
  locale: string,
  timeZone: string,
  dateStyle: "long" | "medium" = "long",
): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle, timeZone }).format(validUntil);
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

// ─── Immutability ────────────────────────────────────────────────────────────
//
// A quote's lines and totals change only while it is the desk's DRAFT. Once
// SENT it is the offer the buyer holds — the numbers they may accept — and it
// never changes under them again: repricing means a revision
// (lib/commerce/quote-revision.ts), which the buyer is told about when it is
// sent. Every line-edit action gates on this (and re-checks it atomically with
// editableQuoteWhere), so the rule can't be bypassed by posting to an action
// the page no longer shows.

type QuoteEditFields = { status: QuoteStatus; order?: { id: string } | null };

/** Only an unsent, unordered DRAFT may have its lines, prices or notes changed. */
export function isQuoteEditable(q: QuoteEditFields): boolean {
  return q.status === "DRAFT" && !q.order;
}

/** Prisma filter for quotes whose lines may still change — isQuoteEditable,
 *  for the compare-and-set that guards a line edit against a concurrent send. */
export function editableQuoteWhere(): Prisma.QuoteWhereInput {
  return { status: "DRAFT", order: null };
}

/**
 * May the desk open a revision of this quote? Only an offer the buyer holds
 * and hasn't taken: SENT (or EXPIRED — a lapsed offer is repriced the same
 * way), not ordered, and not already revised (a quote has at most one
 * revision; revise the newest one). A DRAFT is simply edited; an ACCEPTED
 * quote is an order and can't be revised; DECLINED/SUPERSEDED are closed.
 */
export function isQuoteRevisable(
  q: QuoteEditFields & { nextRevision?: { id: string } | null },
): boolean {
  if (q.order || q.nextRevision) return false;
  return q.status === "SENT" || q.status === "EXPIRED";
}

/** A SENT quote whose validity window has closed. A SUPERSEDED quote is never
 *  "expired": it was replaced, and the revision carries its own window. */
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
 * Pinned to status SENT, so a quote superseded by a revision (SUPERSEDED)
 * can never be accepted, even by a click that raced the revision's send.
 */
export function acceptableQuoteWhere(now: Date = new Date()): Prisma.QuoteWhereInput {
  return {
    status: "SENT",
    OR: [{ validUntil: null }, { validUntil: { gt: now } }],
  };
}

/** Prisma filter for SENT quotes whose window has closed. The expiry sweep
 *  uses it, so a SUPERSEDED quote is never flipped to EXPIRED. */
export function expiredSentQuoteWhere(now: Date = new Date()): Prisma.QuoteWhereInput {
  return { status: "SENT", validUntil: { lte: now } };
}
