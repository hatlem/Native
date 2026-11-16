// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertSuperadminContext, type SuperadminContext } from "@/lib/desk-guard";

// from src/app/[locale]/desk/audit/page.tsx
export async function loadTotal(
  ctx: SuperadminContext,
  args: { where: Prisma.AuditLogWhereInput },
) {
  assertSuperadminContext(ctx);
  const { where } = args;
  return prisma.auditLog.count({ where });
}

// from src/app/[locale]/desk/audit/page.tsx
export async function loadRows(
  ctx: SuperadminContext,
  args: { where: Prisma.AuditLogWhereInput; page: number; PAGE_SIZE: number },
) {
  assertSuperadminContext(ctx);
  const { where, page, PAGE_SIZE } = args;
  return prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
}

// from src/app/[locale]/desk/audit/page.tsx
export async function loadUsers(
  ctx: SuperadminContext,
  args: { userIds: string[] },
) {
  assertSuperadminContext(ctx);
  const { userIds } = args;
  return prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } });
}

// from src/app/[locale]/desk/audit/page.tsx
export async function loadOrgs(
  ctx: SuperadminContext,
  args: { orgIds: string[] },
) {
  assertSuperadminContext(ctx);
  const { orgIds } = args;
  return prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } });
}
