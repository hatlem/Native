// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import { prisma } from "@/lib/prisma";
import { assertDeskContext, type DeskContext } from "@/lib/desk-guard";

// from src/app/[locale]/desk/page.tsx
export async function loadSubmittedCount(ctx: DeskContext) {
  assertDeskContext(ctx);
  return prisma.request.count({ where: { status: "SUBMITTED" } });
}

// from src/app/[locale]/desk/page.tsx
export async function loadInReviewCount(ctx: DeskContext) {
  assertDeskContext(ctx);
  return prisma.request.count({ where: { status: "IN_REVIEW" } });
}

// from src/app/[locale]/desk/page.tsx
export async function loadQuotedCount(ctx: DeskContext) {
  assertDeskContext(ctx);
  return prisma.request.count({ where: { status: "QUOTED" } });
}

// from src/app/[locale]/desk/page.tsx
export async function loadActiveOrderCount(ctx: DeskContext) {
  assertDeskContext(ctx);
  return prisma.order.count({
    where: {
      status: { in: ["CONFIRMED", "IN_PRODUCTION", "SCHEDULED", "LIVE"] },
    },
  });
}

// from src/app/[locale]/desk/page.tsx
export async function loadPendingTitleCount(ctx: DeskContext) {
  assertDeskContext(ctx);
  return prisma.title.count({ where: { active: false } });
}

// from src/app/[locale]/desk/page.tsx
export async function loadUnconfirmedCount(ctx: DeskContext) {
  assertDeskContext(ctx);
  return prisma.product.count({ where: { active: true, confirmedAt: null } });
}

// from src/app/[locale]/desk/page.tsx
export async function loadNewBriefs(ctx: DeskContext) {
  assertDeskContext(ctx);
  return prisma.request.findMany({
    where: { status: "SUBMITTED" },
    orderBy: { createdAt: "desc" },
    take: 8,
    include: {
      organization: true,
      plan: { include: { _count: { select: { items: true } } } },
    },
  });
}

// from src/app/[locale]/desk/page.tsx
export async function loadActiveRequests(ctx: DeskContext) {
  assertDeskContext(ctx);
  return prisma.request.findMany({
    where: { status: { in: ["IN_REVIEW", "QUOTED"] } },
    orderBy: { updatedAt: "desc" },
    take: 8,
    include: {
      organization: true,
      _count: { select: { quotes: true } },
      plan: { include: { _count: { select: { items: true } } } },
    },
  });
}
