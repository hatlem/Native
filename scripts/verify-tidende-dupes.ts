/** Read-only: compare the two suspected-duplicate Tidende titles + their
 * publishers, and count dependent rows so a merge can be done safely. */
import { prisma } from "@/lib/prisma";

const A = "cmpmdiqa201we0hu07ls2kktr"; // Den norske tannlegeforenings Tidende
const B = "cmpmdiqaa02680hu0nxmkoudo"; // Norsk Tannlegeforenings Tidende

async function dump(id: string) {
  const t = await prisma.title.findUniqueOrThrow({
    where: { id },
    include: {
      publisher: { select: { id: true, name: true, contactEmail: true } },
      products: { select: { id: true, type: true, name: true, basePrice: true } },
      _count: { select: { contactLogs: true, priceRequests: true, rateCardDocuments: true, salesContactLinks: true, products: true } },
    },
  });
  console.log(JSON.stringify({
    id: t.id, name: t.name, slug: t.slug, externalRef: t.externalRef,
    websiteUrl: t.websiteUrl, category: t.category, country: t.countryCode,
    circulation: t.circulation, digitalReach: t.digitalReach, active: t.active,
    publisher: t.publisher, counts: t._count, products: t.products,
  }, null, 2));
}

async function main() {
  console.log("=== A (canonical candidate) ==="); await dump(A);
  console.log("\n=== B (duplicate candidate) ==="); await dump(B);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
