// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import { prisma } from "@/lib/prisma";
import { assertDeskContext, type DeskContext } from "@/lib/desk-guard";

// from src/app/[locale]/desk/content-fees/page.tsx
export async function loadRules(ctx: DeskContext) {
  assertDeskContext(ctx);
  return prisma.contentFeeRule.findMany({
    orderBy: [
      { active: "desc" },
      { productType: "asc" },
      { marketCode: "asc" },
    ],
  });
}

// from src/app/[locale]/desk/content-fees/page.tsx
export async function loadMarginRules(ctx: DeskContext) {
  assertDeskContext(ctx);
  return prisma.marginRule.findMany({
    orderBy: [{ active: "desc" }, { marketCode: "asc" }],
  });
}

// from src/app/[locale]/desk/content-fees/page.tsx
export async function loadMarketCurrencies(ctx: DeskContext) {
  assertDeskContext(ctx);
  return prisma.market.findMany({ select: { currency: true }, distinct: ["currency"] });
}
