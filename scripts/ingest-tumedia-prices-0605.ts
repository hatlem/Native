/** TU Media (Jan-Øyvind Kristiansen, jok@tumedia.no) native prices, 2026-06-05 11:43.
 * TU.no + Digi.no. Basert på ferdig innhold fra kunde/byrå (produksjon via innholdsteam = egne priser). */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";
const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-05T11:43:00.000Z");
const TU = { title:"cmpmdiqaa02740hu0wmaem2bd", prod:"cmpn1ct4y00pz0hvy8kmyugu0", name:"TU.no", premium:55000, basic:35000 };
const DIGI = { title:"cmpmdiq9y01qa0hu0r405b45z", prod:"cmpn1ct3o00930hvy4stm6rvz", name:"Digi.no", premium:50000, basic:30000 };
const XNOTE = "Krysspublisering TU+DIGI: premium native 95 000; Brand story 300 000/år. Priser eks. mva, basert på ferdig innhold fra kunde/byrå (produksjon via TU innholdsteam = egne priser).";

async function main() {
  for (const t of [TU, DIGI]) {
    const log = await createContactLog({ titleId:t.title, channel:"EMAIL", direction:"INBOUND",
      note: `INBOUND 2026-06-05 11:43: Jan-Øyvind Kristiansen (Strategisk KAM, TU Media, jok@tumedia.no, +47 40213711). Annonsørinnhold ${t.name}: ` +
        `Premium native (1 uke forside + artikler + 2 dager nyhetsbrev) ${t.premium} kr; Basic native (2 uker forside) ${t.basic} kr; ` +
        `Brand story (ubegrenset artikler, 20% share of voice) 180 000 kr/år (15 000 kr/mnd). ${XNOTE} DIGI nesten fullbooket på premium native utover høsten.`,
      actorId: ACTOR });
    await logQuote({ productId:t.prod, contactLogId:log.id, price:t.premium, currency:"NOK", priceUnit:"FLAT",
      includedText:`Premium native: 1 uke forside + artikler + 2 dager i nyhetsbrevet. Eks. mva. Krysspub TU+DIGI 95 000.`, recordedById:ACTOR });
    await logQuote({ draftProductType:"NATIVE_ARTICLE", draftProductName:`Basic native (${t.name})`, draftProductDesc:"Basic native: 2 uker forside.",
      contactLogId:log.id, price:t.basic, currency:"NOK", priceUnit:"FLAT", includedText:"Basic native: 2 uker forside. Eks. mva.", recordedById:ACTOR });
    await logQuote({ draftProductType:"PACKAGE", draftProductName:`Brand story (${t.name})`,
      draftProductDesc:"Brand story: ubegrenset antall artikler, 20% share of voice, per nettsted.",
      contactLogId:log.id, price:180000, currency:"NOK", priceUnit:"FLAT",
      includedText:"Brand story: ubegrenset artikler, 20% SOV, per år per nettsted (15 000/mnd). Krysspub TU+DIGI 300 000/år. Eks. mva.", recordedById:ACTOR });
    await prisma.title.update({ where:{id:t.title}, data:{ offersNativeContent:true, pricingAsOf:NOW, lastVerifiedAt:NOW,
      verificationStatus:"LIVE", verificationSource:"TU Media (Jan-Øyvind Kristiansen) konkrete priser 2026-06-05" } });
  }
  console.log("TU Media: 6 PriceQuotes logget (TU.no + Digi.no: premium/basic native + brand story).");
  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
