// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import { prisma } from "@/lib/prisma";
import { assertDeskContext, type DeskContext } from "@/lib/desk-guard";
import { lineOrder } from "@/lib/commerce/line-order";

// from src/app/[locale]/desk/[requestId]/page.tsx
export async function loadRequest(
  ctx: DeskContext,
  args: { requestId: string },
) {
  assertDeskContext(ctx);
  const { requestId } = args;
  return prisma.request.findUnique({
    where: { id: requestId },
    include: {
      organization: true,
      plan: { include: { items: true } },
      quotes: {
        orderBy: { createdAt: "desc" },
        include: {
          lines: {
            orderBy: lineOrder(),
            include: {
              priceSetBy: { select: { name: true, email: true } },
            },
          },
          order: true,
          documents: { orderBy: { version: "desc" } },
          // Revision chain (lib/commerce/quote-revision.ts).
          nextRevision: { select: { id: true, revision: true, status: true } },
          previousQuote: { select: { id: true, revision: true } },
        },
      },
    },
  });
}

// from src/app/[locale]/desk/[requestId]/page.tsx
export async function loadProducts(
  ctx: DeskContext,
  args: { productIds: string[] },
) {
  assertDeskContext(ctx);
  const { productIds } = args;
  return prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { title: true },
  });
}

// from src/app/[locale]/desk/[requestId]/page.tsx
export async function loadPrimaryContacts(
  ctx: DeskContext,
  args: { allTitleIds: string[] },
) {
  assertDeskContext(ctx);
  const { allTitleIds } = args;
  return prisma.salesContactTitle.findMany({
    where: { titleId: { in: allTitleIds }, isPrimary: true },
    select: {
      titleId: true,
      salesContact: { select: { name: true, email: true, phone: true } },
    },
  });
}

// from src/app/[locale]/desk/[requestId]/page.tsx
export async function loadTitles(
  ctx: DeskContext,
  args: { titleIds: string[] },
) {
  assertDeskContext(ctx);
  const { titleIds } = args;
  return prisma.title.findMany({
    where: { id: { in: titleIds } },
    select: { id: true, name: true },
  });
}

// from src/app/[locale]/desk/[requestId]/page.tsx
export async function loadPlacementProducts(
  ctx: DeskContext,
  args: { titleIds: string[] },
) {
  assertDeskContext(ctx);
  const { titleIds } = args;
  return prisma.product.findMany({
    where: { titleId: { in: titleIds }, active: true, bookable: true },
    select: {
      id: true,
      type: true,
      titleId: true,
      active: true,
      confirmedAt: true,
      pricingModel: true,
      basePrice: true,
      currency: true,
      productionFee: true,
      priceRules: { select: { marginPct: true, seasonalMultiplier: true, minVolume: true } },
      title: {
        select: {
          pricesPublic: true,
          productionFeeDefault: true,
          market: { select: { code: true } },
          publisher: { select: { pricesPublic: true } },
        },
      },
    },
  });
}

// from src/app/[locale]/desk/[requestId]/page.tsx
export async function loadRefProducts(
  ctx: DeskContext,
  args: { quoteLineProductIds: string[] },
) {
  assertDeskContext(ctx);
  const { quoteLineProductIds } = args;
  return prisma.product.findMany({
    where: { id: { in: quoteLineProductIds } },
    select: {
      id: true,
      type: true,
      active: true,
      confirmedAt: true,
      pricingModel: true,
      basePrice: true,
      currency: true,
      productionFee: true,
      priceRules: {
        select: { marginPct: true, seasonalMultiplier: true, minVolume: true },
      },
      title: {
        select: {
          productionFeeDefault: true,
          market: { select: { code: true } },
        },
      },
    },
  });
}
