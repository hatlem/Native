/** Anleggsmaskinen (A2Media, Ann-Kristin Haugen) native prices, 2026-06-05 12:29.
 * Body: kun print 1/1 side 23 650; print 1/1 + nett 25 900 (per publisering).
 * Nett = nettside (AM.no) + FB + LinkedIn + nyhetsbrev. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";
const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-05T12:29:00.000Z");
const ANL = "cmpmdiqa9025s0hu08wf4adrr";
const ANL_NATIVE = "cmpn1ct4y00on0hvymwvip6zm";
async function main() {
  const log = await createContactLog({ titleId: ANL, channel:"EMAIL", direction:"INBOUND",
    note: "INBOUND 2026-06-05: Ann-Kristin Haugen (A2Media, ann-kristin@a2media.no, tlf 41812132), medieselger for Anleggsmaskinen (MEFs medlemsmagasin). " +
      "Annonsørinnhold: KUN PRINT 1/1 side 23 650 kr/publisering; PRINT 1/1 + NETT 25 900 kr/publisering. På nett: publiseres på AM.no + deles på Facebook, LinkedIn og nyhetsbrev. " +
      "Magasinet når 41 000 lesere (inkl. 2 400 medlemsbedrifter i MEF). AM.no ~52 000 sidevisninger/mnd. Kan kjøre kun print eller print+nett. Tilbud kan justeres ved flere publiseringer. Medieplan vedlagt.",
    actorId: ACTOR });
  await logQuote({ productId: ANL_NATIVE, contactLogId: log.id, price: 25900, currency:"NOK", priceUnit:"FLAT",
    includedText: "Annonsørinnhold print 1/1 side + nett (publiseres på AM.no + deles FB/LinkedIn/nyhetsbrev), per publisering. Eks. mva. Magasin 41 000 lesere; AM.no ~52 000 visn/mnd.", recordedById: ACTOR });
  await logQuote({ draftProductType:"ADVERTORIAL", draftProductName:"Annonsørinnhold kun print 1/1 (Anleggsmaskinen)",
    draftProductDesc:"Annonsørinnhold 1/1 side kun i printutgaven av Anleggsmaskinen.",
    contactLogId: log.id, price: 23650, currency:"NOK", priceUnit:"FLAT",
    includedText:"Annonsørinnhold kun print 1/1 side, per publisering. Eks. mva.", recordedById: ACTOR });
  await prisma.title.update({ where:{ id:ANL }, data:{ offersNativeContent:true, pricingAsOf:NOW, lastVerifiedAt:NOW,
    verificationStatus:"LIVE", verificationSource:"A2Media (Ann-Kristin Haugen) 2026-06-05; AM.no" } });
  console.log("Anleggsmaskinen: 2 native-quotes (23 650 print / 25 900 print+nett), offersNative=true.");
  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
