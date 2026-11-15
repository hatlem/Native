// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import { prisma } from "@/lib/prisma";
import { assertScope, readableOrNull, requireWorkspace, type BuyerScope } from "@/lib/data/buyer/guard";
import { viewOrgIds } from "@/lib/workspace";
import { buyerVisibleQuoteWhere, RENEWAL_REQUESTED_AUDIT_ACTION, RENEWAL_REQUEST_COOLDOWN_MS } from "@/lib/commerce/quote-validity";
import { lineOrder } from "@/lib/commerce/line-order";

// from src/app/[locale]/requests/page.tsx
export async function loadListRequests(scope: BuyerScope) {
  return prisma.request.findMany({
    where: { organizationId: { in: viewOrgIds(requireWorkspace(scope)) } },
    orderBy: { updatedAt: "desc" },
    include: {
      organization: { select: { name: true } },
      plan: { select: { name: true, _count: { select: { items: true } } } },
      sourceList: {
        select: { waveNumber: true, programme: { select: { plannedWaves: true } } },
      },
      // Drafts are desk-internal: until the desk sends the quote the row
      // stays at "sent to the desk" (see buyerVisibleQuoteWhere).
      quotes: {
        where: buyerVisibleQuoteWhere(),
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          order: {
            include: { invoices: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } } },
          },
        },
      },
    },
  });
}

// from src/app/[locale]/requests/[id]/page.tsx
export async function loadDetailRequest(
  scope: BuyerScope,
  args: { id: string },
) {
  const { id } = args;
  const row = await prisma.request.findUnique({
    where: { id },
    include: {
      organization: true,
      plan: { include: { items: true } },
      // The buyer's view of the request: a DRAFT is the desk's work in
      // progress and stays off this page until the desk sends it (the desk
      // works it on /desk/[requestId]).
      quotes: {
        where: buyerVisibleQuoteWhere(),
        orderBy: { createdAt: "desc" },
        include: {
          lines: { orderBy: lineOrder() },
          // A superseded quote points the buyer at the revision that replaced
          // it (always sent — superseding happens on the revision's send).
          nextRevision: { select: { id: true, revision: true } },
          order: {
            include: {
              invoices: true,
              lines: {
                orderBy: lineOrder(),
                include: {
                  articlePlacement: {
                    include: {
                      article: {
                        include: {
                          versions: { orderBy: { version: "desc" }, take: 1 },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  return readableOrNull(scope, row);
}

// from src/app/[locale]/requests/[id]/page.tsx
export async function loadDetailProducts(
  scope: BuyerScope,
  args: { productIds: string[] },
) {
  assertScope(scope);
  const { productIds } = args;
  return prisma.product.findMany({
    where: { id: { in: productIds } },
    // spec: the quote's "what you get" states the format's word count.
    include: { title: { include: { market: true } }, spec: true },
  });
}

// from src/app/[locale]/requests/[id]/page.tsx
export async function loadDetailTitles(
  scope: BuyerScope,
  args: { titleIds: string[] },
) {
  assertScope(scope);
  const { titleIds } = args;
  return prisma.title.findMany({
    where: { id: { in: titleIds } },
    select: { id: true, name: true },
  });
}

// from src/app/[locale]/requests/[id]/page.tsx
export async function loadDetailAssignedBuyer(
  scope: BuyerScope,
  args: { requestAssignedDeskUserId: string },
) {
  assertScope(scope);
  const { requestAssignedDeskUserId } = args;
  return prisma.user.findUnique({
    where: { id: requestAssignedDeskUserId },
    select: { name: true, email: true },
  });
}

// from src/app/[locale]/requests/[id]/page.tsx
export async function loadDetailRenewalRequest(
  scope: BuyerScope,
  args: { requestId: string },
) {
  assertScope(scope);
  const { requestId } = args;
  return prisma.auditLog.findFirst({
    where: {
      entity: `Request:${requestId}`,
      action: RENEWAL_REQUESTED_AUDIT_ACTION,
      createdAt: { gte: new Date(Date.now() - RENEWAL_REQUEST_COOLDOWN_MS) },
    },
    select: { id: true },
  });
}
