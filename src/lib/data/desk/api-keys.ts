// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import { prisma } from "@/lib/prisma";
import { assertSuperadminContext, type SuperadminContext } from "@/lib/desk-guard";

// from src/app/[locale]/desk/api-keys/page.tsx
export async function loadKeys(ctx: SuperadminContext) {
  assertSuperadminContext(ctx);
  return prisma.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      organization: { select: { name: true } },
      publisher: { select: { name: true } },
    },
  });
}

// from src/app/[locale]/desk/api-keys/page.tsx
export async function loadOrgs(ctx: SuperadminContext) {
  assertSuperadminContext(ctx);
  return prisma.organization.findMany({
    select: { id: true, name: true, type: true, marketCode: true },
  });
}

// from src/app/[locale]/desk/api-keys/page.tsx
export async function loadPublishers(ctx: SuperadminContext) {
  assertSuperadminContext(ctx);
  return prisma.publisher.findMany({
    select: {
      id: true,
      name: true,
      countryCode: true,
      _count: { select: { titles: true } },
      titles: { orderBy: { name: "asc" }, take: 2, select: { name: true } },
    },
  });
}
