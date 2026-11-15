// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import { prisma } from "@/lib/prisma";
import { assertSuperadminContext, type SuperadminContext } from "@/lib/desk-guard";

// from src/app/[locale]/desk/publisher-contacts/page.tsx
export async function loadRequests(ctx: SuperadminContext) {
  assertSuperadminContext(ctx);
  return prisma.rateCardRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { titles: true },
  });
}

// from src/app/[locale]/desk/publisher-contacts/page.tsx
export async function loadCandidates(ctx: SuperadminContext) {
  assertSuperadminContext(ctx);
  return prisma.contactCandidate.findMany({
    where: { status: "PENDING" },
    orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
    take: 200,
    include: {
      publisher: {
        select: {
          name: true,
          countryCode: true,
          titles: { select: { id: true, salesChannel: true, adSales: true } },
        },
      },
    },
  });
}

// from src/app/[locale]/desk/publisher-contacts/page.tsx
export async function loadStatusCounts(ctx: SuperadminContext) {
  assertSuperadminContext(ctx);
  return prisma.contactCandidate.groupBy({ by: ["status"], _count: { _all: true } });
}

// from src/app/[locale]/desk/publisher-contacts/page.tsx
export async function loadChannelCounts(ctx: SuperadminContext) {
  assertSuperadminContext(ctx);
  return prisma.title.groupBy({ by: ["salesChannel"], _count: { _all: true } });
}
