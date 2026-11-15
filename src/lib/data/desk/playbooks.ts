// Data loaders moved out of the UI layer. Every loader takes its
// authorisation context first, so a page cannot query without one.
import { prisma } from "@/lib/prisma";
import { assertDeskContext, type DeskContext } from "@/lib/desk-guard";

// from src/app/[locale]/desk/playbooks/page.tsx
export async function loadPlaybooks(ctx: DeskContext) {
  assertDeskContext(ctx);
  return prisma.playbook.findMany({
    orderBy: [{ active: "desc" }, { productType: "asc" }, { category: "asc" }],
  });
}
