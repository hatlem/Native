// Shared accept-quote machinery: turn one SENT quote into a CONFIRMED
// order inside the caller's transaction. acceptQuote (single) and
// acceptAllQuotesForRequest (multi-market) both delegate here so the
// order/brief/booking shape can't drift between the two paths.
//
// The caller owns the surrounding gates (scope, commit authority,
// already-ordered check) and the request-level status update; the
// quote-validity gate (SENT + unexpired) and the offer gate (the quote is
// still the one the buyer looked at) are enforced here, atomically.

import type { LineKind, Prisma } from "@prisma/client";
import {
  authorshipForOrderLine,
  type AuthorshipMode,
} from "@/lib/authorship";
import { acceptableQuoteWhere } from "@/lib/commerce/quote-validity";
import { quoteFingerprint } from "@/lib/commerce/quote-offer";
import { createPublisherBookings } from "@/lib/commerce/bookings";

/**
 * The quote was no longer acceptable when the transaction ran: it expired,
 * it isn't SENT (already accepted by a concurrent click, superseded by a
 * revision, declined, or a draft), or its content no longer matches the offer
 * the buyer accepted. Nothing was written; the caller rolls back and tells
 * the buyer why (quote-offer.ts checkOffer on fresh data).
 */
export class QuoteNotAcceptableError extends Error {
  constructor(readonly quoteId: string) {
    super(`Quote ${quoteId} is not acceptable (expired or not SENT)`);
    this.name = "QuoteNotAcceptableError";
  }
}

export type AcceptableQuoteLine = {
  kind: LineKind;
  productId: string | null;
  quantity: number;
  lineTotal: Prisma.Decimal | number;
  // The quote line's display position, carried onto the order line so the
  // order reads in the same order the buyer accepted (line-order.ts).
  position: number;
};

export type AcceptablePlan = {
  startDate: Date | null;
  endDate: Date | null;
  goal: string | null;
  audienceNote: string | null;
  // productId is nullable: a Plan can hold Title placeholders alongside
  // product lines. Only product lines carry authorship that maps onto an
  // order line, so the title rows are skipped when building the map.
  items: { productId: string | null; authorshipMode: AuthorshipMode }[];
};

export function authorshipByProduct(
  plan: AcceptablePlan,
): Map<string, AuthorshipMode> {
  return new Map(
    plan.items
      .filter((i): i is { productId: string; authorshipMode: AuthorshipMode } => !!i.productId)
      .map((i) => [i.productId, i.authorshipMode]),
  );
}

// Marks the quote ACCEPTED, creates the order (CONFIRMED) with lines copied
// off the quote, and attaches briefs + publisher bookings to placement lines
// only (CONTENT_FEE lines are billing-only). EXTRA_WORK quote lines are not
// copied: order lines are what gets fulfilled (placements, the articles we
// write), while agreed hours are billing only and are invoiced, with their
// hours and description, straight from the accepted quote (lib/billing.ts). Returns the order id plus the
// product ids on the quote for publisher notification fan-out.
//
// The ACCEPTED flip runs first as a compare-and-set on "SENT and still inside
// validUntil": a quote that expired between page load and click — or was
// already accepted by a concurrent request, or superseded by a revision sent
// meanwhile — throws QuoteNotAcceptableError before any order row exists, so
// the caller's transaction rolls back clean.
//
// `offerFingerprint` is the fingerprint of the quote the buyer accepted
// (quote-offer.ts). It is re-computed from the claimed row inside the
// transaction: the claim holds the quote's row lock and a SENT quote's lines
// only change through a revision, so a match here means the order is built
// from exactly the offer the buyer saw.
export async function createOrderFromQuote(
  tx: Prisma.TransactionClient,
  args: {
    organizationId: string;
    quote: { id: string; lines: AcceptableQuoteLine[] };
    offerFingerprint: string;
    plan: AcceptablePlan;
    now?: Date;
  },
): Promise<{ orderId: string; productIds: string[] }> {
  const { organizationId, quote, plan } = args;
  const authorship = authorshipByProduct(plan);

  const claimed = await tx.quote.updateMany({
    where: { id: quote.id, ...acceptableQuoteWhere(args.now ?? new Date()) },
    data: { status: "ACCEPTED" },
  });
  if (claimed.count !== 1) throw new QuoteNotAcceptableError(quote.id);
  const current = await tx.quote.findUniqueOrThrow({
    where: { id: quote.id },
    select: {
      id: true,
      revision: true,
      currency: true,
      subtotal: true,
      vatPct: true,
      total: true,
      lines: { select: { id: true, kind: true, productId: true, quantity: true, lineTotal: true, priceOnRequest: true } },
    },
  });
  if (quoteFingerprint(current) !== args.offerFingerprint) throw new QuoteNotAcceptableError(quote.id);

  const order = await tx.order.create({
    data: {
      organizationId,
      quoteId: quote.id,
      status: "CONFIRMED",
      flightStartDate: plan.startDate ?? null,
      flightEndDate: plan.endDate ?? null,
      lines: {
        create: quote.lines.filter((l) => l.kind !== "EXTRA_WORK").map((l) => ({
          kind: l.kind,
          authorshipMode: authorshipForOrderLine(l, authorship),
          productId: l.productId,
          quantity: l.quantity,
          lineTotal: l.lineTotal,
          position: l.position,
        })),
      },
    },
    include: { lines: true },
  });

  const placementLines = order.lines.filter((l) => l.kind === "INVENTORY");
  await tx.contentBrief.createMany({
    data: placementLines.map((line) => ({
      orderLineId: line.id,
      message: plan.goal,
      audience: plan.audienceNote,
    })),
  });
  // Same factory as the instant path: every booking is anchored to its
  // title/publisher, which the campaign report and metrics sweep group by.
  await createPublisherBookings(tx, placementLines);

  return {
    orderId: order.id,
    productIds: quote.lines
      .map((l) => l.productId)
      .filter((id): id is string => !!id),
  };
}
