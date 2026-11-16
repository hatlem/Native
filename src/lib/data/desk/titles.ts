// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertSuperadminContext, type SuperadminContext } from "@/lib/desk-guard";
import { PAGE_SIZE } from "@/app/[locale]/desk/titles/filters";

// from src/app/[locale]/desk/titles/page.tsx
export async function loadListMatches(
  ctx: SuperadminContext,
  args: { where: Prisma.TitleWhereInput; catalogOrder: Prisma.TitleOrderByWithRelationInput[] },
) {
  assertSuperadminContext(ctx);
  const { where, catalogOrder } = args;
  return prisma.title.findMany({ where, select: { id: true, name: true }, orderBy: catalogOrder });
}

// from src/app/[locale]/desk/titles/page.tsx
export async function loadListRows(
  ctx: SuperadminContext,
  args: { pageIds: string[]; include: { publisher: true; market: true; _count: { select: { products: true; }; }; products: { select: { confirmedAt: true; }; }; } },
) {
  assertSuperadminContext(ctx);
  const { pageIds, include } = args;
  return prisma.title.findMany({ where: { id: { in: pageIds } }, include });
}

// from src/app/[locale]/desk/titles/page.tsx
export async function loadListFilteredCount(
  ctx: SuperadminContext,
  args: { where: Prisma.TitleWhereInput },
) {
  assertSuperadminContext(ctx);
  const { where } = args;
  return prisma.title.count({ where });
}

// from src/app/[locale]/desk/titles/page.tsx
export async function loadListPage(
  ctx: SuperadminContext,
  args: { where: Prisma.TitleWhereInput; include: { publisher: true; market: true; _count: { select: { products: true; }; }; products: { select: { confirmedAt: true; }; }; }; catalogOrder: Prisma.TitleOrderByWithRelationInput[]; skip: number },
) {
  assertSuperadminContext(ctx);
  const { where, include, catalogOrder, skip } = args;
  return prisma.title.findMany({ where, include, orderBy: catalogOrder, take: PAGE_SIZE, skip });
}

// from src/app/[locale]/desk/titles/page.tsx
export async function loadListCounts(ctx: SuperadminContext) {
  assertSuperadminContext(ctx);
  return prisma.title.groupBy({
    by: ["active"],
    _count: { _all: true },
  });
}

// from src/app/[locale]/desk/titles/page.tsx
export async function loadListUnverifiedCount(ctx: SuperadminContext) {
  assertSuperadminContext(ctx);
  return prisma.title.count({
    where: { lastVerifiedAt: null },
  });
}

// from src/app/[locale]/desk/titles/[id]/page.tsx
export async function loadDetailTitle(
  ctx: SuperadminContext,
  args: { id: string },
) {
  assertSuperadminContext(ctx);
  const { id } = args;
  return prisma.title.findUnique({
    where: { id },
    include: {
      publisher: true,
      market: true,
      // priceRules included so the per-product margin override renders
      // the rule updateProductPricing targets: the first by minVolume
      // asc, createdAt asc — regardless of label (blank = inherit).
      products: {
        include: {
          priceRules: {
            orderBy: [{ minVolume: "asc" }, { createdAt: "asc" }],
            take: 1,
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

// from src/app/[locale]/desk/titles/[id]/page.tsx
export async function loadDetailPendingInvite(
  ctx: SuperadminContext,
  args: { titlePublisherId: string },
) {
  assertSuperadminContext(ctx);
  const { titlePublisherId } = args;
  return prisma.publisherInvite.findFirst({
    where: { publisherId: titlePublisherId, claimedAt: null },
    orderBy: { createdAt: "desc" },
    select: { email: true, expiresAt: true },
  });
}

// from src/app/[locale]/desk/titles/[id]/page.tsx
export async function loadDetailPortalUsers(
  ctx: SuperadminContext,
  args: { titlePublisherId: string },
) {
  assertSuperadminContext(ctx);
  const { titlePublisherId } = args;
  return prisma.user.count({ where: { publisherId: titlePublisherId } });
}

// from src/app/[locale]/desk/titles/[id]/_components/ContactHistoryPanel.tsx
export async function loadContactHistoryProducts(
  ctx: SuperadminContext,
  args: { titleId: string },
) {
  assertSuperadminContext(ctx);
  const { titleId } = args;
  return prisma.product.findMany({
    where: { titleId, active: true },
    select: { id: true, name: true, currency: true },
    orderBy: { name: "asc" },
  });
}

// from src/app/[locale]/desk/titles/[id]/_components/ContactHistoryPanel.tsx
export async function loadContactHistoryTitleRow(
  ctx: SuperadminContext,
  args: { titleId: string },
) {
  assertSuperadminContext(ctx);
  const { titleId } = args;
  return prisma.title.findUnique({
    where: { id: titleId },
    select: { market: { select: { currency: true } } },
  });
}

// from src/app/[locale]/desk/titles/[id]/_components/PendingQuotesPanel.tsx
export async function loadPendingQuotesQuotes(
  ctx: SuperadminContext,
  args: { titleId: string },
) {
  assertSuperadminContext(ctx);
  const { titleId } = args;
  return prisma.priceQuote.findMany({
    where: {
      appliedAt: null,
      rejectedAt: null,
      OR: [
        { product: { titleId } },
        { priceRequest: { titleId } },
        { contactLog: { titleId } },
      ],
    },
    include: {
      product: true,
      priceRequest: { include: { salesContact: true } },
      contactLog: { include: { salesContact: true } },
    },
    orderBy: { recordedAt: "desc" },
  });
}

// from src/app/[locale]/desk/titles/[id]/_components/PriceRequestsPanel.tsx
export async function loadPriceRequestsRequests(
  ctx: SuperadminContext,
  args: { titleId: string },
) {
  assertSuperadminContext(ctx);
  const { titleId } = args;
  return prisma.priceRequest.findMany({
    where: { titleId },
    include: { salesContact: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

// from src/app/[locale]/desk/titles/[id]/_components/PriceRequestsPanel.tsx
export async function loadPriceRequestsProducts(
  ctx: SuperadminContext,
  args: { titleId: string },
) {
  assertSuperadminContext(ctx);
  const { titleId } = args;
  return prisma.product.findMany({
    where: { titleId, active: true },
    select: { id: true, name: true, type: true, currency: true },
  });
}

// from src/app/[locale]/desk/titles/[id]/_components/RateCardsPanel.tsx
export async function loadRateCardsDocs(
  ctx: SuperadminContext,
  args: { titleId: string },
) {
  assertSuperadminContext(ctx);
  const { titleId } = args;
  return prisma.rateCardDocument.findMany({
    where: { titleId },
    orderBy: { receivedAt: "desc" },
    include: {
      quotes: {
        include: { product: true },
        orderBy: { recordedAt: "desc" },
      },
    },
  });
}
