// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import { prisma } from "@/lib/prisma";
import { assertScope, canRead, noRows, type BuyerScope } from "@/lib/data/buyer/guard";

// from src/app/[locale]/lists/page.tsx
export async function loadLists(
  scope: BuyerScope,
  args: { orgId: string },
) {
  assertScope(scope);
  if (!canRead(scope, args.orgId)) return noRows();
  const { orgId } = args;
  return prisma.savedList.findMany({
    where: { organizationId: orgId, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      // Placements and recommended alternatives are counted apart: an
      // alternatives-only plan has nothing to send (lib/lists.ts).
      _count: { select: { items: { where: { isAlternative: false } } } },
      items: { where: { isAlternative: true }, select: { id: true } },
      requests: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

// from src/app/[locale]/lists/page.tsx
export async function loadArchivedLists(
  scope: BuyerScope,
  args: { orgId: string; ARCHIVED_SHOWN: number },
) {
  assertScope(scope);
  if (!canRead(scope, args.orgId)) return noRows();
  const { orgId, ARCHIVED_SHOWN } = args;
  return prisma.savedList.findMany({
    where: { organizationId: orgId, archivedAt: { not: null } },
    orderBy: { archivedAt: "desc" },
    take: ARCHIVED_SHOWN,
    select: {
      id: true,
      name: true,
      archivedAt: true,
      _count: { select: { items: { where: { isAlternative: false } } } },
    },
  });
}
