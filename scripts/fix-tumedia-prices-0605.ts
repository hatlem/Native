import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";
const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-05T11:43:00.000Z");
const XNOTE = "Krysspublisering TU+DIGI: premium native 95 000; Brand story 300 000/år. Priser eks. mva, basert på ferdig innhold fra kunde/byrå (produksjon via TU innholdsteam = egne priser).";
const TU_LOG = "cmq0su57b00010hfewclt8zsc";
const DIGI = { title:"cmpmdiq9y01qa0hu0r405b45z", prod:"cmpn1ct3o00930hvy4stm6rvz", name:"Digi.no", premium:50000, basic:30000 };

async function main() {
  // TU.no: add missing brand story to existing log
  await logQuote({ draftProductType:"PACKAGE", draftProductName:"Brand story (TU.no)",
    draftProductDesc:"Brand story: ubegrenset antall artikler, 20% share of voice, per nettsted.",
    contactLogId: TU_LOG, price:180000, currency:"NOK", priceUnit:"FLAT",
    includedText:"Brand story: ubegrenset artikler, 20% SOV, per år per nettsted (15 000/mnd). Krysspub TU+DIGI 300 000/år. Eks. mva.", recordedById:ACTOR });
  await prisma.title.update({ where:{id:"cmpmdiqaa02740hu0wmaem2bd"}, data:{ offersNativeContent:true, pricingAsOf:NOW, lastVerifiedAt:NOW,
    verificationStatus:"LIVE", verificationSource:"TU Media (Jan-Øyvind Kristiansen) konkrete priser 2026-06-05" } });

  // Digi.no: full log + 3 quotes
  const log = await createContactLog({ titleId:DIGI.title, channel:"EMAIL", direction:"INBOUND",
    note:`INBOUND 2026-06-05 11:43: Jan-Øyvind Kristiansen (Strategisk KAM, TU Media, jok@tumedia.no, +47 40213711). Annonsørinnhold Digi.no: Premium native (1 uke forside + artikler + 2 dager nyhetsbrev) 50 000 kr; Basic native (2 uker forside) 30 000 kr; Brand story (ubegrenset artikler, 20% SOV) 180 000 kr/år (15 000/mnd). ${XNOTE} DIGI nesten fullbooket på premium native utover høsten.`,
    actorId:ACTOR });
  await logQuote({ productId:DIGI.prod, contactLogId:log.id, price:DIGI.premium, currency:"NOK", priceUnit:"FLAT",
    includedText:"Premium native: 1 uke forside + artikler + 2 dager i nyhetsbrevet. Eks. mva. Krysspub TU+DIGI 95 000.", recordedById:ACTOR });
  await logQuote({ draftProductType:"NATIVE_ARTICLE", draftProductName:"Basic native (Digi.no)", draftProductDesc:"Basic native: 2 uker forside.",
    contactLogId:log.id, price:DIGI.basic, currency:"NOK", priceUnit:"FLAT", includedText:"Basic native: 2 uker forside. Eks. mva.", recordedById:ACTOR });
  await logQuote({ draftProductType:"PACKAGE", draftProductName:"Brand story (Digi.no)", draftProductDesc:"Brand story: ubegrenset artikler, 20% SOV, per nettsted.",
    contactLogId:log.id, price:180000, currency:"NOK", priceUnit:"FLAT",
    includedText:"Brand story: ubegrenset artikler, 20% SOV, per år per nettsted (15 000/mnd). Krysspub TU+DIGI 300 000/år. Eks. mva.", recordedById:ACTOR });
  await prisma.title.update({ where:{id:DIGI.title}, data:{ offersNativeContent:true, pricingAsOf:NOW, lastVerifiedAt:NOW,
    verificationStatus:"LIVE", verificationSource:"TU Media (Jan-Øyvind Kristiansen) konkrete priser 2026-06-05" } });

  console.log("TU Media fix: TU.no brand story lagt til; Digi.no full (premium 50k + basic 30k + brand story 180k). Totalt 6 quotes for TU/DIGI.");
  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
