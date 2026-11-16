// Loads a page of an organisation's own audit trail, already reduced to what
// a customer may see (lib/customer-audit.ts). Shared by the /audit page and
// its CSV export so the two can never disagree about scope.
import { prisma } from "@/lib/prisma";
import {
  CUSTOMER_AUDIT_ACTIONS,
  customerAuditActor,
  customerAuditDetail,
  customerAuditWhere,
  type AuditActorInfo,
  type CustomerAuditActor,
  type CustomerAuditCategory,
  type CustomerAuditFilters,
} from "@/lib/customer-audit";

export type CustomerAuditRow = {
  id: string;
  createdAt: Date;
  action: string;
  category: CustomerAuditCategory;
  actor: CustomerAuditActor;
  detail: [string, string][];
};

export async function countCustomerAudit(organizationId: string, filters: CustomerAuditFilters): Promise<number> {
  return prisma.auditLog.count({ where: customerAuditWhere(organizationId, filters) });
}

export async function loadCustomerAudit(
  organizationId: string,
  filters: CustomerAuditFilters,
  window: { skip: number; take: number },
): Promise<CustomerAuditRow[]> {
  const rows = await prisma.auditLog.findMany({
    where: customerAuditWhere(organizationId, filters),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: window.skip,
    take: window.take,
    select: { id: true, createdAt: true, action: true, actor: true, detail: true },
  });

  // Who the actors on this page are — and whether each belongs to this org.
  const actorIds = [...new Set(rows.map((r) => r.actor).filter((a) => a !== "system" && a !== "anonymous"))];
  const users = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          organizationId: true,
          // Any seat, current or past: a colleague who has since left is
          // still named on what they did while they were here.
          memberships: { where: { organizationId }, select: { id: true }, take: 1 },
        },
      })
    : [];
  const info = new Map<string, AuditActorInfo>(
    users.map((u) => [
      u.id,
      {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        belongsToOrg: u.organizationId === organizationId || u.memberships.length > 0,
      },
    ]),
  );

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    action: r.action,
    category: CUSTOMER_AUDIT_ACTIONS[r.action].category,
    actor: customerAuditActor(r.actor, info.get(r.actor)),
    detail: customerAuditDetail(r.action, r.detail),
  }));
}
