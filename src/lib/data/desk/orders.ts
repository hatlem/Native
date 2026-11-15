// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertDeskContext, type DeskContext } from "@/lib/desk-guard";
import { PLACEMENT_LINE_WHERE } from "@/lib/commerce/placements";
import { lineOrder } from "@/lib/commerce/line-order";

// from src/app/[locale]/desk/orders/page.tsx
export async function loadListStatusCounts(ctx: DeskContext) {
  assertDeskContext(ctx);
  return prisma.order.groupBy({ by: ["status"], _count: { _all: true } });
}

// from src/app/[locale]/desk/orders/page.tsx
export async function loadListOrders(
  ctx: DeskContext,
  args: { orderBy: Prisma.OrderOrderByWithRelationInput; skip: number; take: number },
) {
  assertDeskContext(ctx);
  const { orderBy, skip, take } = args;
  return prisma.order.findMany({
    orderBy,
    skip,
    take,
    include: {
      organization: true,
      quote: { select: { currency: true, total: true } },
      // Placements only — the article fees are billed with them.
      _count: { select: { lines: { where: PLACEMENT_LINE_WHERE } } },
    },
  });
}

// from src/app/[locale]/desk/orders/[orderId]/page.tsx
export async function loadDetailOrder(
  ctx: DeskContext,
  args: { orderId: string },
) {
  assertDeskContext(ctx);
  const { orderId } = args;
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      organization: true,
      // The buyer's request brief: the per-line brief falls back to it. The
      // quote's lines tell which placement each content fee writes for, and
      // its extra-work lines show beside the hours added since.
      quote: {
        include: {
          request: { select: { briefSummary: true } },
          lines: {
            orderBy: lineOrder(),
            select: {
              id: true,
              kind: true,
              description: true,
              productId: true,
              position: true,
              hours: true,
              hourlyRate: true,
              lineTotal: true,
            },
          },
        },
      },
      invoices: true,
      creditNotes: true,
      extraWork: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      lines: {
        orderBy: lineOrder(),
        include: {
          brief: true,
          articlePlacement: {
            include: { article: { include: { versions: { orderBy: { version: "desc" } } } } },
          },
          trackedLinks: true,
          booking: {
            include: {
              metrics: true,
              publisher: { select: { name: true } },
              title: { select: { name: true } },
            },
          },
        },
      },
      writerPool: {
        select: {
          writerId: true,
          writer: {
            select: { user: { select: { name: true, email: true } } },
          },
        },
      },
    },
  });
}

// from src/app/[locale]/desk/orders/[orderId]/page.tsx
export async function loadDetailMetricsRequests(
  ctx: DeskContext,
  args: { orderId: string },
) {
  assertDeskContext(ctx);
  const { orderId } = args;
  return prisma.metricsRequest.findMany({
    where: { orderId: orderId },
    select: {
      id: true,
      publisherId: true,
      status: true,
      recipientEmail: true,
      sentCount: true,
      token: true,
    },
  });
}

// from src/app/[locale]/desk/orders/[orderId]/page.tsx
export async function loadDetailOrderFeedback(
  ctx: DeskContext,
  args: { orderId: string },
) {
  assertDeskContext(ctx);
  const { orderId } = args;
  return prisma.orderFeedback.findUnique({
    where: { orderId: orderId },
    select: { score: true, comment: true },
  });
}

// from src/app/[locale]/desk/orders/[orderId]/page.tsx
export async function loadDetailProducts(
  ctx: DeskContext,
  args: { lineProductIds: string[] },
) {
  assertDeskContext(ctx);
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

// from src/app/[locale]/desk/orders/[orderId]/page.tsx
export async function loadDetailPlaybooks(ctx: DeskContext) {
  assertDeskContext(ctx);
  return prisma.playbook.findMany({ where: { active: true } });
}

// from src/app/[locale]/desk/orders/[orderId]/programme-panel.tsx
export async function loadProgrammePanelOrder(
  ctx: DeskContext,
  args: { orderId: string },
) {
  assertDeskContext(ctx);
  const { orderId } = args;
  return prisma.order.findUnique({
    where: { id: orderId },
    select: { quote: { select: { request: { select: { sourceListId: true } } } } },
  });
}
