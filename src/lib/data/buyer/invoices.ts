// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import { prisma } from "@/lib/prisma";
import { readableOrNull, requireWorkspace, type BuyerScope } from "@/lib/data/buyer/guard";
import { lineOrder } from "@/lib/commerce/line-order";

// from src/app/[locale]/invoices/page.tsx
export async function loadListTotal(scope: BuyerScope) {
  const where = { organizationId: { in: requireWorkspace(scope).scopeOrgIds } };
  return prisma.invoice.count({ where });
}

// from src/app/[locale]/invoices/page.tsx
export async function loadListInvoices(
  scope: BuyerScope,
  args: { skip: number; take: number },
) {
  const { skip, take } = args;
  const where = { organizationId: { in: requireWorkspace(scope).scopeOrgIds } };
  return prisma.invoice.findMany({
    where,
    // id as the final tiebreaker keeps page boundaries stable.
    orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    skip,
    take,
    select: {
      id: true,
      number: true,
      status: true,
      currency: true,
      total: true,
      issuedAt: true,
      dueAt: true,
      organization: { select: { name: true } },
    },
  });
}

// from src/app/[locale]/invoices/[id]/page.tsx
export async function loadDetailInvoice(
  scope: BuyerScope,
  args: { id: string },
) {
  const { id } = args;
  const row = await prisma.invoice.findUnique({
    where: { id },
    include: {
      organization: true,
      lines: { orderBy: lineOrder() },
      creditNotes: { orderBy: { issuedAt: "asc" }, take: 1 },
    },
  });
  return readableOrNull(scope, row);
}
