// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertDeskContext, type DeskContext } from "@/lib/desk-guard";
import { DESK_REQUESTS_PAGE_SIZE, type DeskRequestStatusFilter } from "@/lib/desk-requests-query";

// from src/app/[locale]/desk/requests/page.tsx
export async function loadTotal(
  ctx: DeskContext,
  args: { where: Prisma.RequestWhereInput },
) {
  assertDeskContext(ctx);
  const { where } = args;
  return prisma.request.count({ where });
}

// from src/app/[locale]/desk/requests/page.tsx
export async function loadRequests(
  ctx: DeskContext,
  args: { where: Prisma.RequestWhereInput; status: DeskRequestStatusFilter; page: number },
) {
  assertDeskContext(ctx);
  const { where, status, page } = args;
  return prisma.request.findMany({
    where,
    // Oldest first for the open queue (the longest-waiting buyer is the
    // most urgent), newest activity first otherwise.
    orderBy: status === "open" ? { createdAt: "asc" } : { updatedAt: "desc" },
    skip: (page - 1) * DESK_REQUESTS_PAGE_SIZE,
    take: DESK_REQUESTS_PAGE_SIZE,
    select: {
      id: true,
      status: true,
      briefSummary: true,
      updatedAt: true,
      organization: { select: { name: true } },
      _count: { select: { quotes: true } },
      plan: { select: { _count: { select: { items: true } } } },
    },
  });
}
