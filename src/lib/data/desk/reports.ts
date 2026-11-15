// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import { prisma } from "@/lib/prisma";
import { assertDeskContext, type DeskContext } from "@/lib/desk-guard";
import { buyerVisibleQuoteWhere } from "@/lib/commerce/quote-validity";

// from src/app/[locale]/desk/reports/page.tsx
export async function loadRequestCount(
  ctx: DeskContext,
  args: { inWindow: { createdAt: { gte?: Date; lt?: Date; }; } | { readonly createdAt?: undefined; } },
) {
  assertDeskContext(ctx);
  const { inWindow } = args;
  return prisma.request.count({ where: inWindow });
}

// from src/app/[locale]/desk/reports/page.tsx
export async function loadQuotedRequestCount(
  ctx: DeskContext,
  args: { inWindow: { createdAt: { gte?: Date; lt?: Date; }; } | { readonly createdAt?: undefined; } },
) {
  assertDeskContext(ctx);
  const { inWindow } = args;
  return prisma.request.count({ where: { ...inWindow, quotes: { some: buyerVisibleQuoteWhere() } } });
}

// from src/app/[locale]/desk/reports/page.tsx
export async function loadOrderCount(
  ctx: DeskContext,
  args: { inWindow: { createdAt: { gte?: Date; lt?: Date; }; } | { readonly createdAt?: undefined; } },
) {
  assertDeskContext(ctx);
  const { inWindow } = args;
  return prisma.order.count({ where: inWindow });
}

// from src/app/[locale]/desk/reports/page.tsx
export async function loadDecidedQuotes(
  ctx: DeskContext,
  args: { DECIDED: readonly ["ACCEPTED", "DECLINED", "EXPIRED"]; inWindow: { createdAt: { gte?: Date; lt?: Date; }; } | { readonly createdAt?: undefined; } },
) {
  assertDeskContext(ctx);
  const { DECIDED, inWindow } = args;
  return prisma.quote.findMany({
    where: { status: { in: [...DECIDED] }, ...inWindow },
    select: {
      status: true,
      lines: {
        where: { kind: "INVENTORY" },
        select: { productId: true, marginPct: true, lineTotal: true },
      },
    },
  });
}

// from src/app/[locale]/desk/reports/page.tsx
export async function loadBenchProducts(
  ctx: DeskContext,
  args: { benchProductIds: string[] },
) {
  assertDeskContext(ctx);
  const { benchProductIds } = args;
  return prisma.product.findMany({
    where: { id: { in: benchProductIds } },
    select: { id: true, title: { select: { category: true } } },
  });
}
