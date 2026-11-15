// Which organisation an audit row concerns, worked out from the row's entity
// ("Invoice:<id>", "Quote:<id>" …) when the caller's detail does not name it.
//
// Done centrally in lib/audit.ts so no call site can forget: the customer's
// own audit trail (/audit) is filtered on AuditLog.organizationId, and a row
// without it is invisible to them.
import { prisma } from "@/lib/prisma";

// "Invoice:abc" → { type: "Invoice", id: "abc" }. Wildcards ("Invoice:*") and
// multi-id entities ("Organization:a,b") name no single record.
export function parseAuditEntity(entity: string): { type: string; id: string } | null {
  const i = entity.indexOf(":");
  if (i <= 0) return null;
  const type = entity.slice(0, i);
  const id = entity.slice(i + 1);
  if (!id || id === "*" || id.includes(",") || id.length > 64) return null;
  return { type, id };
}

type Resolver = (id: string) => Promise<string | null>;

const RESOLVERS: Record<string, Resolver> = {
  Organization: async (id) => id,
  Request: async (id) =>
    (await prisma.request.findUnique({ where: { id }, select: { organizationId: true } }))?.organizationId ?? null,
  Quote: async (id) =>
    (await prisma.quote.findUnique({ where: { id }, select: { request: { select: { organizationId: true } } } }))
      ?.request.organizationId ?? null,
  QuoteLine: async (id) =>
    (
      await prisma.quoteLine.findUnique({
        where: { id },
        select: { quote: { select: { request: { select: { organizationId: true } } } } },
      })
    )?.quote.request.organizationId ?? null,
  Order: async (id) =>
    (await prisma.order.findUnique({ where: { id }, select: { organizationId: true } }))?.organizationId ?? null,
  OrderLine: async (id) =>
    (await prisma.orderLine.findUnique({ where: { id }, select: { order: { select: { organizationId: true } } } }))
      ?.order.organizationId ?? null,
  OrderExtraWork: async (id) =>
    (
      await prisma.orderExtraWork.findUnique({
        where: { id },
        select: { order: { select: { organizationId: true } } },
      })
    )?.order.organizationId ?? null,
  Invoice: async (id) =>
    (await prisma.invoice.findUnique({ where: { id }, select: { organizationId: true } }))?.organizationId ?? null,
  CreditNote: async (id) =>
    (await prisma.creditNote.findUnique({ where: { id }, select: { invoice: { select: { organizationId: true } } } }))
      ?.invoice.organizationId ?? null,
  SavedList: async (id) =>
    (await prisma.savedList.findUnique({ where: { id }, select: { organizationId: true } }))?.organizationId ?? null,
  SavedListItem: async (id) =>
    (await prisma.savedListItem.findUnique({ where: { id }, select: { list: { select: { organizationId: true } } } }))
      ?.list.organizationId ?? null,
  Plan: async (id) =>
    (await prisma.plan.findUnique({ where: { id }, select: { organizationId: true } }))?.organizationId ?? null,
  Article: async (id) =>
    (await prisma.article.findUnique({ where: { id }, select: { organizationId: true } }))?.organizationId ?? null,
  ApiKey: async (id) =>
    (await prisma.apiKey.findUnique({ where: { id }, select: { organizationId: true } }))?.organizationId ?? null,
};

export function auditEntityHasOrgResolver(entity: string): boolean {
  const parsed = parseAuditEntity(entity);
  return parsed !== null && parsed.type in RESOLVERS;
}

// Best-effort: an unknown entity type, a deleted record or a database error
// all resolve to null — the audit row is still written, just untagged.
export async function resolveAuditOrganizationId(entity: string): Promise<string | null> {
  const parsed = parseAuditEntity(entity);
  if (!parsed) return null;
  const resolve = RESOLVERS[parsed.type];
  if (!resolve) return null;
  try {
    return await resolve(parsed.id);
  } catch {
    return null;
  }
}
