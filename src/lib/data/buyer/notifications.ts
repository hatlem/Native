// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import { prisma } from "@/lib/prisma";
import { assertScope, type BuyerScope } from "@/lib/data/buyer/guard";

// Notifications belong to a user, not an organisation: every query here is
// keyed on the caller's own id, taken from the scope.
function ownNotifications(scope: BuyerScope) {
  assertScope(scope);
  return { userId: scope.userId as string };
}

// from src/app/[locale]/notifications/page.tsx
export async function loadTotal(scope: BuyerScope) {
  const where = ownNotifications(scope);
  return prisma.notification.count({ where });
}

// from src/app/[locale]/notifications/page.tsx
export async function loadUnread(scope: BuyerScope) {
  const where = ownNotifications(scope);
  return prisma.notification.count({ where: { ...where, readAt: null } });
}

// from src/app/[locale]/notifications/page.tsx
export async function loadRows(
  scope: BuyerScope,
  args: { skip: number; take: number },
) {
  const { skip, take } = args;
  const where = ownNotifications(scope);
  return prisma.notification.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take,
  });
}
