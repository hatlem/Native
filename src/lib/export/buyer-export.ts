import type { Prisma } from "@prisma/client";
import { buyerVisibleQuoteWhere } from "@/lib/commerce/quote-validity";
import { lineOrder } from "@/lib/commerce/line-order";

// What a BUYER's export may contain. Explicit allowlists, never `include`:
// quote lines carry the publisher's cost and our margin, orders a desk-only
// engagement note, requests the assigned desk user, bookings the publisher's
// tracking URL. None of that is the customer's data. A desk-run export keeps
// the full rows. Adding a column to these models must not leak it by default.
export const BUYER_QUOTE_LINE_SELECT = {
  id: true,
  kind: true,
  productId: true,
  description: true,
  quantity: true,
  lineTotal: true,
  priceOnRequest: true,
  customerNote: true,
  position: true,
} satisfies Prisma.QuoteLineSelect;

export const BUYER_REQUEST_SELECT = {
  id: true,
  organizationId: true,
  planId: true,
  status: true,
  briefSummary: true,
  createdAt: true,
  updatedAt: true,
  quotes: {
    where: buyerVisibleQuoteWhere(),
    select: {
      id: true,
      status: true,
      currency: true,
      subtotal: true,
      vatPct: true,
      total: true,
      validUntil: true,
      createdAt: true,
      updatedAt: true,
      lines: { orderBy: lineOrder(), select: BUYER_QUOTE_LINE_SELECT },
    },
  },
} satisfies Prisma.RequestSelect;

export const BUYER_ORDER_SELECT = {
  id: true,
  organizationId: true,
  quoteId: true,
  status: true,
  cancelledAt: true,
  cancelReason: true,
  flightStartDate: true,
  flightEndDate: true,
  createdAt: true,
  updatedAt: true,
  lines: {
    orderBy: lineOrder(),
    select: {
      id: true,
      kind: true,
      authorshipMode: true,
      productId: true,
      quantity: true,
      lineTotal: true,
      position: true,
      brief: true,
      articlePlacement: { include: { article: { include: { versions: true } } } },
      booking: {
        select: {
          id: true,
          publisherId: true,
          titleId: true,
          status: true,
          placementDate: true,
          liveStartDate: true,
          liveEndDate: true,
          liveUrl: true,
          confirmedAt: true,
        },
      },
    },
  },
} satisfies Prisma.OrderSelect;

