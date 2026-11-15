// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import { prisma } from "@/lib/prisma";
import { assertDeskContext, type DeskContext } from "@/lib/desk-guard";

// from src/app/[locale]/desk/writers/page.tsx
export async function loadPendingInvites(ctx: DeskContext) {
  assertDeskContext(ctx);
  return prisma.writerInvite.findMany({
    where: { claimedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
}
