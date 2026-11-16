// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import { prisma } from "@/lib/prisma";
import { assertDeskContext, type DeskContext } from "@/lib/desk-guard";

// from src/app/[locale]/desk/metrics-needs-contact/page.tsx
export async function loadRows(ctx: DeskContext) {
  assertDeskContext(ctx);
  return prisma.metricsRequest.findMany({
    where: { status: "NEEDS_CONTACT" },
    include: {
      publisher: { select: { name: true } },
      order: { select: { id: true } },
      _count: { select: { bookings: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}
