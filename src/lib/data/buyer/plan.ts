// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import { prisma } from "@/lib/prisma";
import { liveOrderForList } from "@/lib/commerce/list-commit";
import { assertScope, canRead, noRows, type BuyerScope } from "@/lib/data/buyer/guard";
import { catalogVisibleTitleWhere } from "@/lib/catalog-visibility";

// from src/app/[locale]/plan/_components/PlanView.tsx
export async function loadPlanActiveOrg(
  scope: BuyerScope,
  args: { wsActiveOrgId: string },
) {
  assertScope(scope);
  if (!canRead(scope, args.wsActiveOrgId)) return null;
  const { wsActiveOrgId } = args;
  return prisma.organization.findUnique({
    where: { id: wsActiveOrgId },
    select: { name: true, marketCode: true, vatId: true },
  });
}

// from src/app/[locale]/plan/_components/PlanView.tsx
export async function loadPlanLists(
  scope: BuyerScope,
  args: { wsActiveOrgId: string },
) {
  assertScope(scope);
  if (!canRead(scope, args.wsActiveOrgId)) return noRows();
  const { wsActiveOrgId } = args;
  return prisma.savedList.findMany({
    where: { organizationId: wsActiveOrgId, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, _count: { select: { items: true } } },
  });
}

// from src/app/[locale]/plan/_components/PlanView.tsx
export async function loadPlanPlacementProducts(
  scope: BuyerScope,
  args: { placeholderTitleIds: string[] },
) {
  assertScope(scope);
  const { placeholderTitleIds } = args;
  return prisma.product.findMany({
    where: { titleId: { in: placeholderTitleIds }, active: true, bookable: true },
    orderBy: [{ type: "asc" }, { basePrice: "asc" }],
    select: {
      id: true,
      type: true,
      titleId: true,
      active: true,
      confirmedAt: true,
      basePrice: true,
      currency: true,
      pricingModel: true,
      productionFee: true,
      inclusions: true,
      priceRules: { select: { marginPct: true, seasonalMultiplier: true, minVolume: true } },
      title: {
        select: {
          pricesPublic: true,
          productionFeeDefault: true,
          publisher: { select: { pricesPublic: true } },
          market: { select: { code: true } },
        },
      },
    },
  });
}

// from src/app/[locale]/plan/_components/PlanView.tsx
export async function loadPlanBlockedDays(
  scope: BuyerScope,
  args: { productIds: string[] },
) {
  assertScope(scope);
  const { productIds } = args;
  return prisma.availability.findMany({
    where: { productId: { in: productIds }, blocked: true },
    select: { productId: true, year: true, month: true },
  });
}

// from src/app/[locale]/plan/_components/PlanView.tsx
export async function loadPlanSubmittedRequest(
  scope: BuyerScope,
  args: { activeListId: string },
) {
  assertScope(scope);
  const { activeListId } = args;
  return prisma.request.findFirst({
    where: { sourceListId: activeListId },
    orderBy: { createdAt: "desc" },
    select: {
      quotes: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { order: { select: { id: true } } },
      },
    },
  });
}

// from src/app/[locale]/plan/_components/PlanView.tsx
export async function loadPlanFavoriteCount(
  scope: BuyerScope,
  args: { listTitleIds: Set<string> },
) {
  assertScope(scope);
  const { listTitleIds } = args;
  return prisma.favorite.count({
    where: {
      userId: scope.userId as string,
      title: catalogVisibleTitleWhere,
      titleId: { notIn: [...listTitleIds] },
    },
  });
}

// from src/app/[locale]/plan/_components/PlanView.tsx
export async function loadPlanWaveItems(
  scope: BuyerScope,
  args: { waveListIds: string[] },
) {
  assertScope(scope);
  const { waveListIds } = args;
  return prisma.savedListItem.findMany({
    where: { listId: { in: waveListIds }, isAlternative: false },
    select: {
      listId: true,
      productId: true,
      quantity: true,
      withContent: true,
      scheduleStart: true,
      scheduleUnits: true,
      product: {
        select: {
          type: true,
          currency: true,
          basePrice: true,
          active: true,
          confirmedAt: true,
          visibility: true,
          pricingModel: true,
          productionFee: true,
          inclusions: true,
          bookingUnit: true,
          titleId: true,
          priceRules: { select: { marginPct: true, seasonalMultiplier: true, minVolume: true } },
          title: {
            select: {
              name: true,
              pricesPublic: true,
              productionFeeDefault: true,
              publisher: { select: { pricesPublic: true } },
              market: { select: { code: true, vatRatePct: true } },
            },
          },
        },
      },
    },
  });
}

// from src/app/[locale]/plan/_components/PlanProgramme.tsx
export async function loadProgrammeList(
  scope: BuyerScope,
  args: { listId: string },
) {
  assertScope(scope);
  const { listId } = args;
  return prisma.savedList.findUnique({
    where: { id: listId },
    select: { organizationId: true },
  });
}

// from src/app/[locale]/plan/_components/PlanProgramme.tsx
export async function loadProgrammeOtherArticles(
  scope: BuyerScope,
  args: { listOrganizationId: string },
) {
  assertScope(scope);
  if (!canRead(scope, args.listOrganizationId)) return noRows();
  const { listOrganizationId } = args;
  return prisma.article.findMany({
    where: { organizationId: listOrganizationId },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { id: true, title: true },
  });
}

// from src/app/[locale]/plan/_components/PlanView.tsx
// The live order a plan already has (lib/commerce/list-commit.ts).
export async function loadPlanLiveOrder(
  scope: BuyerScope,
  args: { listId: string },
) {
  assertScope(scope);
  return liveOrderForList(prisma, args.listId);
}
