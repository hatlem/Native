// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import { prisma } from "@/lib/prisma";
import { assertScope, requireWorkspace, type BuyerScope } from "@/lib/data/buyer/guard";
import { viewOrgIds } from "@/lib/workspace";

// from src/app/[locale]/reports/page.tsx
export async function loadOrders(scope: BuyerScope) {
  return prisma.order.findMany({
    where: { organizationId: { in: viewOrgIds(requireWorkspace(scope)) } },
    select: {
      status: true,
      quote: { select: { currency: true, total: true } },
      lines: { select: { productId: true } },
    },
  });
}

// from src/app/[locale]/reports/page.tsx
export async function loadProducts(
  scope: BuyerScope,
  args: { productIds: string[] },
) {
  assertScope(scope);
  const { productIds } = args;
  return prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, title: { select: { category: true } } },
  });
}
