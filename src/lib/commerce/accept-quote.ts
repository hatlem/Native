// Shared accept-quote machinery: turn one SENT quote into a CONFIRMED
// order inside the caller's transaction. acceptQuote (single) and
// acceptAllQuotesForRequest (multi-market) both delegate here so the
// order/brief/booking shape can't drift between the two paths.
//
// The caller owns the surrounding gates (scope, commit authority,
// already-ordered check) and the request-level status update.

import type { Prisma } from "@prisma/client";
import {
  authorshipForOrderLine,
  type AuthorshipMode,
} from "@/lib/authorship";

export type AcceptableQuoteLine = {
  kind: "INVENTORY" | "CONTENT_FEE";
  productId: string | null;
  quantity: number;
  lineTotal: Prisma.Decimal | number;
};

export type AcceptablePlan = {
  startDate: Date | null;
  endDate: Date | null;
  goal: string | null;
  audienceNote: string | null;
  items: { productId: string; authorshipMode: AuthorshipMode }[];
};

export function authorshipByProduct(
  plan: AcceptablePlan,
): Map<string, AuthorshipMode> {
  return new Map(plan.items.map((i) => [i.productId, i.authorshipMode]));
}

// Creates the order (CONFIRMED) with lines copied off the quote, attaches
// briefs + publisher bookings to placement lines only (CONTENT_FEE lines
// are billing-only), and marks the quote ACCEPTED. Returns the order id
// plus the product ids on the quote for publisher notification fan-out.
export async function createOrderFromQuote(
  tx: Prisma.TransactionClient,
  args: {
    organizationId: string;
    quote: { id: string; lines: AcceptableQuoteLine[] };
    plan: AcceptablePlan;
  },
): Promise<{ orderId: string; productIds: string[] }> {
  const { organizationId, quote, plan } = args;
  const authorship = authorshipByProduct(plan);

  const order = await tx.order.create({
    data: {
      organizationId,
      quoteId: quote.id,
      status: "CONFIRMED",
      flightStartDate: plan.startDate ?? null,
      flightEndDate: plan.endDate ?? null,
      lines: {
        create: quote.lines.map((l) => ({
          kind: l.kind,
          authorshipMode: authorshipForOrderLine(l, authorship),
          productId: l.productId,
          quantity: l.quantity,
          lineTotal: l.lineTotal,
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
  await tx.publisherBooking.createMany({
    data: placementLines.map((line) => ({ orderLineId: line.id })),
  });

  await tx.quote.update({
    where: { id: quote.id },
    data: { status: "ACCEPTED" },
  });

  return {
    orderId: order.id,
    productIds: quote.lines
      .map((l) => l.productId)
      .filter((id): id is string => !!id),
  };
}
