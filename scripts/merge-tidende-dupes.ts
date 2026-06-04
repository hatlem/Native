/** Merge duplicate Tidende titles. Same publication (tannlegetidende.no),
 * two rows under two publisher rows for the same org. Canonical = A (the
 * official media-kit name). Reassign all dependent rows B→A, then
 * deactivate B as a merged duplicate. Idempotent-ish (safe to re-run:
 * reassignment is a no-op once B has nothing left). */
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

const A = "cmpmdiqa201we0hu07ls2kktr"; // Den norske tannlegeforenings Tidende (canonical)
const B = "cmpmdiqaa02680hu0nxmkoudo"; // Norsk Tannlegeforenings Tidende (duplicate)
const ACTOR = "cmpmdiqtg048c0hu080m8kmok";

async function main() {
  const a = await prisma.title.findUniqueOrThrow({ where: { id: A }, include: { products: true } });
  const b = await prisma.title.findUniqueOrThrow({ where: { id: B }, include: { products: true } });
  if (b.websiteUrl !== a.websiteUrl) throw new Error(`Refusing merge: different websiteUrl A=${a.websiteUrl} B=${b.websiteUrl}`);

  await prisma.$transaction(async (tx) => {
    // 1) Move contact logs B→A.
    const cl = await tx.contactLog.updateMany({ where: { titleId: B }, data: { titleId: A } });
    // 2) Move price requests B→A.
    const pr = await tx.priceRequest.updateMany({ where: { titleId: B }, data: { titleId: A } });
    // 3) Move rate-card documents B→A.
    const rc = await tx.rateCardDocument.updateMany({ where: { titleId: B }, data: { titleId: A } });
    // 4) Sales-contact links: move, skipping ones that would collide on (salesContactId,titleId).
    const links = await tx.salesContactTitle.findMany({ where: { titleId: B } });
    let movedLinks = 0;
    for (const l of links) {
      const exists = await tx.salesContactTitle.findUnique({ where: { salesContactId_titleId: { salesContactId: l.salesContactId, titleId: A } } });
      if (exists) { await tx.salesContactTitle.delete({ where: { salesContactId_titleId: { salesContactId: l.salesContactId, titleId: B } } }); }
      else { await tx.salesContactTitle.update({ where: { salesContactId_titleId: { salesContactId: l.salesContactId, titleId: B } }, data: { titleId: A } }); movedLinks++; }
    }
    // 5) B's products: A already has the canonical Native article. Move any
    //    quotes off B's products onto A's first product, then drop B's products.
    const aProduct = a.products[0];
    for (const p of b.products) {
      if (aProduct) await tx.priceQuote.updateMany({ where: { productId: p.id }, data: { productId: aProduct.id } });
      await tx.product.delete({ where: { id: p.id } });
    }
    // 6) Deactivate B as a merged duplicate.
    await tx.title.update({
      where: { id: B },
      data: {
        active: false,
        discontinuedAt: new Date(),
        discontinuedNote: `Duplikat av «${a.name}» [${A}] — slått sammen 2026-06-04. Samme publikasjon (tannlegetidende.no). All historikk flyttet til kanonisk tittel.`,
      },
    });
    console.log(`Reassigned: contactLogs=${cl.count} priceRequests=${pr.count} rateCardDocs=${rc.count} salesLinks=${movedLinks}, deleted B products=${b.products.length}`);
  });

  await recordAudit(ACTOR, "title.merge", `Title:${B}`, { mergedInto: A });
  console.log(`Merged ${B} → ${A}. B deactivated as duplicate.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
