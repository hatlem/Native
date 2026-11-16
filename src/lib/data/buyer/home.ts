// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import { prisma } from "@/lib/prisma";
import { viewOrgIds } from "@/lib/workspace";
import { requireWorkspace, type BuyerScope } from "@/lib/data/buyer/guard";
import { acceptableQuoteWhere } from "@/lib/commerce/quote-validity";
import { PLACEMENT_LINE_WHERE } from "@/lib/commerce/placements";

// from src/app/[locale]/home/page.tsx
export async function loadPendingQuotes(scope: BuyerScope) {
  const orgIds = viewOrgIds(requireWorkspace(scope));
  return prisma.quote.findMany({
    where: { ...acceptableQuoteWhere(), order: null, request: { organizationId: { in: orgIds } } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      total: true,
      currency: true,
      validUntil: true,
      request: { select: { id: true, organizationId: true, plan: { select: { name: true } } } },
    },
  });
}

// from src/app/[locale]/home/page.tsx
export async function loadPendingContent(scope: BuyerScope) {
  const orgIds = viewOrgIds(requireWorkspace(scope));
  return prisma.contentAsset.findMany({
    where: { status: "IN_REVIEW", article: { organizationId: { in: orgIds } } },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: {
      id: true,
      article: { select: { id: true } },
    },
  });
}

// from src/app/[locale]/home/page.tsx
export async function loadOrders(scope: BuyerScope) {
  const orgIds = viewOrgIds(requireWorkspace(scope));
  return prisma.order.findMany({
    where: { organizationId: { in: orgIds }, status: { in: ["CONFIRMED", "IN_PRODUCTION", "SCHEDULED", "LIVE"] } },
    orderBy: { updatedAt: "desc" },
    take: 6,
    select: {
      id: true,
      status: true,
      flightStartDate: true,
      flightEndDate: true,
      organization: { select: { name: true } },
      quote: { select: { currency: true, total: true, request: { select: { plan: { select: { name: true } } } } } },
      // Placements only — the article fees are billed with them.
      lines: { where: PLACEMENT_LINE_WHERE, select: { id: true } },
    },
  });
}
