// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertScope, readableOrNull, requireWorkspace, type BuyerScope } from "@/lib/data/buyer/guard";
import { viewOrgIds } from "@/lib/workspace";
import { lineOrder } from "@/lib/commerce/line-order";

// from src/app/[locale]/orders/page.tsx
export async function loadListOrders(
  scope: BuyerScope,
  args: { orderBy: Prisma.OrderOrderByWithRelationInput },
) {
  const { orderBy } = args;
  return prisma.order.findMany({
    where: { organizationId: { in: viewOrgIds(requireWorkspace(scope)) } },
    orderBy,
    include: {
      organization: { select: { name: true } },
      quote: { select: { currency: true, total: true } },
      invoices: { select: { id: true, status: true } },
      lines: { include: { booking: true } },
    },
  });
}

// from src/app/[locale]/orders/[orderId]/page.tsx
export async function loadDetailOrder(
  scope: BuyerScope,
  args: { orderId: string },
) {
  const { orderId } = args;
  const row = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      // The quote's lines only to tell which placement each content fee
      // writes for (orderFeePlacements); the order's own lines are below.
      quote: { include: { lines: { select: { kind: true, description: true, productId: true, position: true } } } },
      invoices: { select: { id: true, status: true } },
      feedback: { select: { score: true } },
      lines: {
        orderBy: lineOrder(),
        include: {
          articlePlacement: {
            select: {
              id: true,
              articleId: true,
              lockedAssetId: true,
              specPassed: true,
            },
          },
          booking: {
              include: {
                metrics: true,
                publisher: { select: { name: true } },
                title: { select: { name: true } },
              },
            },
        },
      },
    },
  });
  return readableOrNull(scope, row);
}

// from src/app/[locale]/orders/[orderId]/page.tsx
export async function loadDetailProducts(
  scope: BuyerScope,
  args: { lineProductIds: string[] },
) {
  assertScope(scope);
  const { lineProductIds } = args;
  return prisma.product.findMany({
    where: {
      id: {
        in: lineProductIds,
      },
    },
    include: { title: true },
  });
}

// from src/app/[locale]/orders/[orderId]/extra-work-section.tsx
export async function loadExtraWorkQuoteLines(
  scope: BuyerScope,
  args: { quoteId: string },
) {
  assertScope(scope);
  const { quoteId } = args;
  return prisma.quoteLine.findMany({
    where: { quoteId, kind: "EXTRA_WORK" },
    orderBy: lineOrder(),
    select: { id: true, description: true, hours: true, hourlyRate: true, lineTotal: true },
  });
}

// from src/app/[locale]/orders/[orderId]/extra-work-section.tsx
export async function loadExtraWorkEntries(
  scope: BuyerScope,
  args: { orderId: string },
) {
  assertScope(scope);
  const { orderId } = args;
  return prisma.orderExtraWork.findMany({
    where: { orderId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, description: true, hours: true, hourlyRate: true, lineTotal: true, invoiceId: true },
  });
}
