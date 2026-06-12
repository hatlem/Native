/** Apply every pending (unapplied, unrejected) PriceQuote — the backlog captured
 * 06-08…06-10 from inbound publisher replies but never committed. Each draft is
 * deterministically bound to a title via contactLog.titleId (see applyQuote), so
 * applying is safe: it creates an inactive, confirmed-price Product on that title
 * (or updates the product for non-draft quotes). Prints the title each lands on.
 *
 * Idempotent: skips anything already applied/rejected. Products land active=false
 * (curation gate) — activation is a separate desk step.
 * Dry-run by default; --apply to write.
 * Run: railway run --service Postgres sh -c \
 *   'DATABASE_URL="$DATABASE_PUBLIC_URL" pnpm tsx scripts/apply-pending-drafts-0611.ts --apply'
 */
import { prisma } from "@/lib/prisma";
import { applyQuote } from "@/lib/pricing/quotes";

const APPLY = process.argv.includes("--apply");

async function main() {
  const operator = await prisma.user.findFirstOrThrow({ where: { role: "SUPERADMIN" } });
  const pending = await prisma.priceQuote.findMany({
    where: { appliedAt: null, rejectedAt: null },
    include: { contactLog: { include: { title: { select: { name: true } } } }, priceRequest: { include: { title: { select: { name: true } } } } },
    orderBy: { recordedAt: "asc" },
  });
  console.log(`pending quotes: ${pending.length}`);

  let applied = 0, skipped = 0;
  const byTitle: Record<string, number> = {};
  for (const q of pending) {
    const titleName = q.priceRequest?.title?.name ?? q.contactLog?.title?.name ?? null;
    const target = q.productId ? "(existing product)" : titleName ? `→ ${titleName}` : "(NO TITLE — will fail)";
    if (!q.productId && !titleName) { skipped++; console.log(`  SKIP (no title): ${q.draftProductName} [${q.id}]`); continue; }
    console.log(`  ${q.draftProductName ?? "(product update)"} ${q.price} ${q.currency} ${target}`);
    if (APPLY) {
      try { await applyQuote({ quoteId: q.id, actorUserId: operator.id }); applied++; byTitle[titleName ?? "(existing)"] = (byTitle[titleName ?? "(existing)"] ?? 0) + 1; }
      catch (e) { skipped++; console.log(`    ERROR: ${(e as Error).message}`); }
    }
  }
  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"} — applied: ${applied} | skipped: ${skipped}`);
  if (APPLY) console.log("per title:", JSON.stringify(byTitle, null, 2));
}
main().finally(() => prisma.$disconnect());
