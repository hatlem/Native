/** READ-ONLY. Inspect what's stored for the reply titles so we know what reader/
 * contact data is still missing, and how Polaris titles group by publisher. */
import { prisma } from "@/lib/prisma";

async function dump(names: string[]) {
  for (const n of names) {
    const t = await prisma.title.findFirst({
      where: { countryCode: "NO", name: { equals: n, mode: "insensitive" } },
      select: {
        id: true, name: true, digitalReach: true, monthlyReach: true, audienceNote: true,
        commercialExtra: true, contentPolicy: true, ownContentAllowed: true, offersNativeContent: true,
        outstandingInfo: true, description: true, adSales: true,
        publisher: { select: { id: true, name: true } },
        contactLogs: { select: { direction: true, note: true }, where: { direction: "INBOUND" } },
        products: { select: { id: true, _count: { select: { priceQuotes: true } } } },
      },
    });
    if (!t) { console.log(`\n! ${n}: not found`); continue; }
    const quoteCount = t.products.reduce((s, p) => s + p._count.priceQuotes, 0);
    console.log(`\n• ${t.name} [${t.id}] publisher=${t.publisher?.name}`);
    console.log(`   offersNative=${t.offersNativeContent} digitalReach=${t.digitalReach} monthlyReach=${t.monthlyReach} ownContent=${t.ownContentAllowed}`);
    console.log(`   adSales=${t.adSales}`);
    console.log(`   audienceNote=${t.audienceNote ?? "—"}`);
    console.log(`   contentPolicy=${t.contentPolicy ?? "—"}`);
    console.log(`   commercialExtra=${t.commercialExtra ? JSON.stringify(t.commercialExtra) : "—"}`);
    console.log(`   outstandingInfo=${t.outstandingInfo?.length ? t.outstandingInfo.join(" | ") : "—"}`);
    console.log(`   INBOUND logs=${t.contactLogs.length}  product-priceQuotes=${quoteCount}`);
  }
}

async function main() {
  console.log("=== Bjarte Lerø titles ===");
  await dump(["Dagens Perspektiv", "Samtiden", "Reiseliv1", "Friluftsliv"]);

  console.log("\n=== Polaris anchor titles ===");
  await dump(["Adresseavisen", "Varden", "Sør-Trøndelag", "Vestlandsnytt"]);

  // Group all titles by the publishers of the 4 Polaris anchors.
  const anchors = await prisma.title.findMany({
    where: { countryCode: "NO", name: { in: ["Adresseavisen", "Varden", "Sør-Trøndelag", "Vestlandsnytt"], mode: "insensitive" } },
    select: { publisherId: true, publisher: { select: { name: true } } },
  });
  const pubIds = [...new Set(anchors.map((a) => a.publisherId))];
  console.log(`\n=== Titles sharing the anchor publishers (${anchors.map(a=>a.publisher?.name).join(" / ")}) ===`);
  for (const pid of pubIds) {
    const sibs = await prisma.title.findMany({
      where: { publisherId: pid, active: true },
      select: { name: true, offersNativeContent: true },
      orderBy: { name: "asc" },
    });
    const pubName = sibs.length ? (await prisma.publisher.findUnique({ where: { id: pid }, select: { name: true } }))?.name : "?";
    console.log(`\nPublisher "${pubName}" [${pid}] — ${sibs.length} active titles:`);
    console.log("   " + sibs.map((s) => s.name).join(", "));
  }

  // Also search any publisher whose name mentions Polaris.
  const polarisPubs = await prisma.publisher.findMany({
    where: { name: { contains: "Polaris", mode: "insensitive" } },
    select: { id: true, name: true, _count: { select: { titles: true } } },
  });
  console.log(`\n=== Publishers matching "Polaris": ${polarisPubs.length} ===`);
  for (const p of polarisPubs) console.log(`   ${p.name} [${p.id}] — ${p._count.titles} titles`);

  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
