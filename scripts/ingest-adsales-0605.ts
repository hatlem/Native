/** Log AdSales Group AB (John Björs) native prices as PriceQuotes + capture
 * digital-native detail + newsletter reach that the earlier 09:18 notes missed.
 * Titles: Socionomen + Tidningen Akademikern (SE). Native-only (attachments were
 * the ordinary display mediekits — not ingested). */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-05T09:20:00.000Z");

const SOC = { title: "cmpmdiqah02h70hu0d0dn9bfe", product: "cmpn1ct5r00zz0hvyxd7a4m42", print: 19900, subs: "~40 000", news: "Socionomen" };
const AKA = { title: "cmpmdiqag02fy0hu0j8mhctpm", product: "cmpn1ct5r00yr0hvyvs9eij2m", print: 34000, subs: "~80 000", news: "Akademikern" };

async function main() {
  for (const t of [SOC, AKA]) {
    const log = await createContactLog({
      titleId: t.title, channel: "EMAIL", direction: "INBOUND",
      note:
        `INBOUND 2026-06-05: John Björs (AdSales Group AB, john@adsales.se, +46 73-590 25 32). ` +
        `KOMPLETT native-prising. DIGITAL native (webb 2 uker + 2 nyhetsbrev-utsendelser med nativepuff): 25 000 SEK per native. ` +
        `${t.news}s nyhetsbrev: ${t.subs} abonnenter, ~50% åpningsrate. ` +
        `PRINT helside native: ${t.print} SEK (publisering). Produksjon: 3 000 SEK eget materiale (text+bild) / 15 000 SEK om redaksjonen produserer fra intervju. ` +
        `To opplegg: Advertorial (eget materiale, annonsmerket) eller Native (redaksjonelt samarbeid, "i samarbete med.."). ` +
        `Native ligger utenfor ordinære rabatt-/volum-/formatstrukturer (redaksjonelt produsert). AdSales selger 30+ varemerker, print+digitalt, ~4 mill lesere brutto. ` +
        `Vedlegg i e-post = ordinære annonsformat-mediekit (display) – ikke native, ikke lagret.`,
      actorId: ACTOR,
    });

    await logQuote({
      productId: t.product, contactLogId: log.id, price: 25000, currency: "SEK", priceUnit: "FLAT",
      includedText: `Digital native: publisering på ${t.news.toLowerCase()}.se, 2 ukers eksponering + 2 nyhetsbrev-utsendelser med nativepuff. Nyhetsbrev ${t.subs} abonnenter, ~50% åpningsrate. "Investering 25 000 kr per native" (AdSales). Produksjon kommer i tillegg (3 000 eget / 15 000 redaksjonelt).`,
      recordedById: ACTOR,
    });
    await logQuote({
      draftProductType: "ADVERTORIAL", draftProductName: `Native helside print (${t.news})`,
      draftProductDesc: "Helside native/advertorial i printutgaven (redaksjonelt produsert eller advertorial, annonsmerket).",
      contactLogId: log.id, price: t.print, currency: "SEK", priceUnit: "FLAT",
      includedText: `Helside native i print. Produksjon: 3 000 SEK eget materiale / 15 000 SEK redaksjonelt fra intervju. Native utenfor ordinære rabattstrukturer.`,
      recordedById: ACTOR,
    });

    await prisma.title.update({ where:{ id:t.title }, data:{ offersNativeContent:true, pricingAsOf:NOW, lastVerifiedAt:NOW,
      verificationStatus:"LIVE", verificationSource:"AdSales Group AB (John Björs) konkret pris 2026-06-05" } });
  }
  // alias so "Akademikern" matches Tidningen Akademikern in future ingest
  const aka = await prisma.title.findUnique({ where:{ id:AKA.title }, select:{ aliases:true } });
  await prisma.title.update({ where:{ id:AKA.title }, data:{ aliases:{ set:[...new Set([...(aka?.aliases??[]), "Akademikern"])] } } });

  console.log("AdSales: 4 PriceQuotes logget (Socionomen 25k digital + 19.9k print; Akademikern 25k digital + 34k print), alias 'Akademikern' lagt til.");
  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
