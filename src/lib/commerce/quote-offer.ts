// "Accept quote" binds the buyer to the offer they were LOOKING AT — never to
// whatever happens to be current when the click lands. The accept form posts
// one token per quote it showed: the quote id plus a fingerprint of its
// commercial content. The server accepts only when those are exactly the open
// quotes on the request, unchanged. A page left open while the desk sent a
// revision used to accept the revision (another price) that the buyer never
// saw (BUG-final-local-1).
//
// Pure and DB-free: the accept actions and the in-transaction re-check
// (accept-quote.ts) share it, and the rules unit-test without a database.

import { createHash } from "node:crypto";

export type FingerprintLine = {
  id: string;
  kind: "INVENTORY" | "CONTENT_FEE";
  productId: string | null;
  quantity: number;
  lineTotal: unknown;
  priceOnRequest: boolean;
};

export type FingerprintQuote = {
  id: string;
  revision: number;
  currency: string;
  subtotal: unknown;
  vatPct: unknown;
  total: unknown;
  lines: readonly FingerprintLine[];
};

// Decimals arrive as Prisma.Decimal from the DB and numbers from tests; both
// print the same way at the quote's 2-decimal precision.
const money = (v: unknown): string => Number(v).toFixed(2);

/**
 * The identity of an offer: everything the buyer agrees to by accepting it —
 * which lines, how many, at what price, in which currency and with what VAT.
 * Not the validity date (a renewal keeps the same offer) and not the notes.
 * Line order is irrelevant; line ids are part of it, so a revision (new rows)
 * never matches its predecessor even at the same price.
 */
export function quoteFingerprint(q: FingerprintQuote): string {
  const lines = [...q.lines]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((l) => [l.id, l.kind, l.productId ?? "", l.quantity, money(l.lineTotal), l.priceOnRequest ? 1 : 0]);
  const canonical = JSON.stringify([
    q.id,
    q.revision,
    q.currency,
    money(q.subtotal),
    money(q.vatPct),
    money(q.total),
    lines,
  ]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

export type OfferToken = { quoteId: string; fingerprint: string };

/** The hidden-field value the accept form posts for one quote it shows. */
export function offerToken(q: FingerprintQuote): string {
  return `${q.id}:${quoteFingerprint(q)}`;
}

/** Parses the posted tokens; malformed entries are dropped (and so can only
 *  make the check below refuse, never accept more). */
export function parseOfferTokens(values: readonly unknown[]): OfferToken[] {
  const tokens: OfferToken[] = [];
  for (const v of values) {
    if (typeof v !== "string") continue;
    const m = /^([A-Za-z0-9_-]{1,64}):([0-9a-f]{32})$/.exec(v.trim());
    if (m) tokens.push({ quoteId: m[1], fingerprint: m[2] });
  }
  return tokens;
}

export type OfferQuote = FingerprintQuote & {
  status: "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "SUPERSEDED";
  previousQuoteId: string | null;
  order: { id: string } | null;
};

export type OfferCheck =
  // Exactly the open quotes, unchanged: accept these.
  | { ok: true; quoteIds: string[] }
  // A quote the buyer saw was replaced by a revision: point them at it.
  | { ok: false; reason: "replaced"; revision: number }
  // Every quote the buyer saw is already accepted (a double submit): nothing
  // to do, land on the request quietly.
  | { ok: false; reason: "accepted" }
  // Anything else that makes the posted offer not the current one: changed
  // content, a quote added or withdrawn, or a form with no tokens at all.
  | { ok: false; reason: "changed" };

/** A quote is on offer (acceptable or awaiting renewal) until it has an order
 *  or leaves SENT/EXPIRED. Only quotes with a priced line can be accepted. */
export function isOpenOffer(q: Pick<OfferQuote, "status" | "order" | "lines">): boolean {
  return (
    !q.order &&
    (q.status === "SENT" || q.status === "EXPIRED") &&
    q.lines.some((l) => !l.priceOnRequest)
  );
}

// The revision that now stands in for `quote`: follow the revision chain past
// every superseded step to the one the buyer can see (never a DRAFT).
function currentRevision(quote: OfferQuote, all: readonly OfferQuote[]): OfferQuote {
  let current = quote;
  for (let guard = 0; guard < all.length; guard++) {
    const next = all.find((q) => q.previousQuoteId === current.id && q.status !== "DRAFT");
    if (!next) break;
    current = next;
  }
  return current;
}

/**
 * Whether the posted tokens name the request's open quotes, unchanged.
 *
 * `scope: "all"` (the buyer's "Accept quote"): accepting is all-or-nothing
 * across a request's per-market quotes, so the buyer must have seen every one
 * of them — a quote added since the page loaded is as much a change as a
 * repriced one. `scope: "one"` (accepting a single named quote): the posted
 * quote must be open and unchanged; the request's other quotes are not part of
 * that commitment.
 */
export function checkOffer(
  posted: readonly OfferToken[],
  quotes: readonly OfferQuote[],
  scope: "all" | "one" = "all",
): OfferCheck {
  if (posted.length === 0) return { ok: false, reason: "changed" };
  const byId = new Map(quotes.map((q) => [q.id, q]));

  const seen = posted.map((t) => byId.get(t.quoteId));
  // A quote the buyer saw has been replaced: name the revision to review.
  const replaced = seen.find((q) => q?.status === "SUPERSEDED");
  if (replaced) {
    return { ok: false, reason: "replaced", revision: currentRevision(replaced, quotes).revision };
  }
  if (seen.every((q) => !!q?.order)) return { ok: false, reason: "accepted" };

  const postedIds = new Set(posted.map((t) => t.quoteId));
  const open = quotes.filter(isOpenOffer);
  const accepted =
    scope === "all"
      ? open.length === postedIds.size && open.every((q) => postedIds.has(q.id))
        ? open
        : null
      : seen.every((q) => !!q && isOpenOffer(q))
        ? open.filter((q) => postedIds.has(q.id))
        : null;
  if (!accepted) return { ok: false, reason: "changed" };
  const unchanged = posted.every((t) => {
    const q = byId.get(t.quoteId);
    return !!q && quoteFingerprint(q) === t.fingerprint;
  });
  if (!unchanged) return { ok: false, reason: "changed" };
  return { ok: true, quoteIds: accepted.map((q) => q.id) };
}
