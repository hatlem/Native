// Which order lines an article may be linked to ("Link to a placement").
// One rule, used by the article page to build the dropdown and by
// linkArticleToOrderLine to refuse anything else.
//
//  - Only open placements: an INVENTORY line with no article yet, on an
//    order of the article's own organization that is still in production
//    (not cancelled, completed or invoiced).
//  - Once an article belongs to an order, it is offered that order's lines
//    only — an article written for one campaign doesn't wander into
//    another's. An unlinked (library) article may go to any open order.
//  - Authorship must match: a buyer-written article can fill only lines
//    where the buyer supplies the copy; a NativeSpin-written one only lines
//    NativeSpin produces.

import type { AuthorshipMode, OrderStatus, Prisma } from "@prisma/client";

const CLOSED_ORDER_STATUSES: OrderStatus[] = ["CANCELLED", "COMPLETED", "INVOICED"];

export function linkableLinesWhere(article: {
  organizationId: string;
  // Orders the article is already placed on.
  linkedOrderIds: string[];
  // True when NativeSpin writes it (a writer is assigned).
  nativeSpinWritten: boolean;
}): Prisma.OrderLineWhereInput {
  const authorshipMode: AuthorshipMode = article.nativeSpinWritten
    ? "NATIVESPIN_PRODUCED"
    : "BUYER_SUPPLIED";
  return {
    kind: "INVENTORY",
    articlePlacement: null,
    authorshipMode,
    ...(article.linkedOrderIds.length > 0 ? { orderId: { in: article.linkedOrderIds } } : {}),
    order: {
      organizationId: article.organizationId,
      status: { notIn: CLOSED_ORDER_STATUSES },
    },
  };
}

// Short, human order reference — the same last-8 convention invoices use.
export function orderRef(orderId: string): string {
  return orderId.slice(-8).toUpperCase();
}

// Dropdown labels that can't collide: "Title · Format · order ABC12345",
// with "(2)", "(3)" appended when one order has several identical lines.
export function linkOptionLabels(
  options: { id: string; base: string }[],
): { id: string; label: string }[] {
  const seen = new Map<string, number>();
  return options.map(({ id, base }) => {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { id, label: n === 1 ? base : `${base} (${n})` };
  });
}
