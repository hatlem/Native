// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import { prisma } from "@/lib/prisma";
import { assertScope, requireWorkspace, type BuyerScope } from "@/lib/data/buyer/guard";
import { viewOrgIds } from "@/lib/workspace";
import { linkableLinesWhere } from "@/lib/content/article-linking";

// from src/app/[locale]/articles/page.tsx
export async function loadListArticles(scope: BuyerScope) {
  return prisma.article.findMany({
    where: { organizationId: { in: viewOrgIds(requireWorkspace(scope)) } },
    orderBy: { updatedAt: "desc" },
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          status: true,
          body: true,
          authorWriter: { select: { user: { select: { name: true, email: true } } } },
        },
      },
      assignedWriter: { select: { user: { select: { name: true, email: true } } } },
      placements: {
        select: {
          orderLine: {
            select: {
              orderId: true,
              productId: true,
            },
          },
        },
      },
    },
  });
}

// from src/app/[locale]/articles/page.tsx
export async function loadListProducts(
  scope: BuyerScope,
  args: { productIds: string[] },
) {
  assertScope(scope);
  const { productIds } = args;
  return prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, title: { select: { name: true } } },
  });
}

// from src/app/[locale]/articles/page.tsx
export async function loadListAuthors(
  scope: BuyerScope,
  args: { authorIds: string[] },
) {
  assertScope(scope);
  const { authorIds } = args;
  return prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, name: true, email: true },
  });
}

// from src/app/[locale]/articles/new/page.tsx
export async function loadNewOrgs(scope: BuyerScope) {
  return prisma.organization.findMany({
    where: { id: { in: requireWorkspace(scope).editOrgIds } },
    select: { id: true, name: true },
  });
}

// from src/app/[locale]/articles/[articleId]/page.tsx
export async function loadDetailArticle(
  scope: BuyerScope,
  args: { articleId: string },
) {
  assertScope(scope);
  const { articleId } = args;
  return prisma.article.findUnique({
    where: { id: articleId },
    select: {
      id: true,
      title: true,
      organizationId: true,
      assignedWriterId: true,
      createdByUserId: true,
      assignedWriter: { select: { user: { select: { name: true, email: true } } } },
      placements: {
        select: {
          id: true,
          lockedAssetId: true,
          specPassed: true,
          specNotes: true,
          retractedAt: true,
          orderLine: { select: { orderId: true, productId: true } },
        },
      },
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          id: true,
          version: true,
          reviewRound: true,
          status: true,
          body: true,
          bodyUrl: true,
          reviewNotes: true,
          authorWriter: { select: { user: { select: { name: true, email: true } } } },
        },
      },
    },
  });
}

// from src/app/[locale]/articles/[articleId]/page.tsx
export async function loadDetailCreatedBy(
  scope: BuyerScope,
  args: { articleCreatedByUserId: string },
) {
  assertScope(scope);
  const { articleCreatedByUserId } = args;
  return prisma.user.findUnique({
    where: { id: articleCreatedByUserId },
    select: { name: true, email: true },
  });
}

// from src/app/[locale]/articles/[articleId]/page.tsx
export async function loadDetailEligibleLines(
  scope: BuyerScope,
  args: { articleOrganizationId: string; linkedOrderIds: string[]; nativeSpinWritten: boolean },
) {
  assertScope(scope);
  const { articleOrganizationId, linkedOrderIds, nativeSpinWritten } = args;
  return prisma.orderLine.findMany({
    where: linkableLinesWhere({
      organizationId: articleOrganizationId,
      linkedOrderIds,
      nativeSpinWritten,
    }),
    select: { id: true, orderId: true, productId: true },
    orderBy: [{ orderId: "asc" }, { id: "asc" }],
  });
}

// from src/app/[locale]/articles/[articleId]/page.tsx
export async function loadDetailProducts(
  scope: BuyerScope,
  args: { allProductIds: string[] },
) {
  assertScope(scope);
  const { allProductIds } = args;
  return prisma.product.findMany({
    where: { id: { in: allProductIds } },
    select: { id: true, type: true, title: { select: { name: true } } },
  });
}
