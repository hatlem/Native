// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertSuperadminContext, type SuperadminContext } from "@/lib/desk-guard";

// from src/app/[locale]/desk/users/page.tsx
export async function loadTotal(
  ctx: SuperadminContext,
  args: { where: Prisma.UserWhereInput },
) {
  assertSuperadminContext(ctx);
  const { where } = args;
  return prisma.user.count({ where });
}

// from src/app/[locale]/desk/users/page.tsx
export async function loadUsers(
  ctx: SuperadminContext,
  args: { where: Prisma.UserWhereInput; page: number; PAGE_SIZE: number },
) {
  assertSuperadminContext(ctx);
  const { where, page, PAGE_SIZE } = args;
  return prisma.user.findMany({
    where,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      deactivatedAt: true,
      emailVerifiedAt: true,
      lastSignInAt: true,
      publisherId: true,
      organization: { select: { id: true, name: true } },
      publisher: { select: { id: true, name: true } },
      memberships: {
        select: { organizationId: true, role: true, status: true },
      },
    },
    orderBy: [{ createdAt: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
}

// from src/app/[locale]/desk/users/page.tsx
export async function loadOrgs(
  ctx: SuperadminContext,
  args: { PICKER_LIMIT: number },
) {
  assertSuperadminContext(ctx);
  const { PICKER_LIMIT } = args;
  return prisma.organization.findMany({
    select: { id: true, name: true, type: true, paymentTermsDays: true },
    orderBy: { name: "asc" },
    take: PICKER_LIMIT,
  });
}

// from src/app/[locale]/desk/users/page.tsx
export async function loadPublishers(
  ctx: SuperadminContext,
  args: { PICKER_LIMIT: number },
) {
  assertSuperadminContext(ctx);
  const { PICKER_LIMIT } = args;
  return prisma.publisher.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: PICKER_LIMIT,
  });
}
