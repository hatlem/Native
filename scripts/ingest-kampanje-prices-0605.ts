import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";
const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-05T13:43:00.000Z");
const KAMP = "cmpmdiqa401yi0hu09lgnjq4p";
const PROD = "cmpn1ct4i00hc0hvyb0swb0mu";
async function main() {
  const log = await createContactLog({ titleId:KAMP, channel:"EMAIL", direction:"INBOUND",
    note:"INBOUND 2026-06-05 13:43: Nina Gade Tenvik (Kampanje). FASTE Branded Content-priser: 1 native artikkel = 25 000 kr; pakke med 4 artikler (ender i Branded Stories-feltet i 2 uker) = 75 000 kr. Beskrivelse i produktlenke (kampanje.com).",
    actorId:ACTOR });
  await logQuote({ productId:PROD, contactLogId:log.id, price:25000, currency:"NOK", priceUnit:"FLAT",
    includedText:"1 native artikkel (Branded Content), fast pris. Eks. mva.", recordedById:ACTOR });
  await logQuote({ draftProductType:"PACKAGE", draftProductName:"Branded Stories – 4 artikler (Kampanje)",
    draftProductDesc:"Pakke med 4 native-artikler som ender i Branded Stories-feltet i 2 uker.",
    contactLogId:log.id, price:75000, currency:"NOK", priceUnit:"FLAT",
    includedText:"Pakke 4 native-artikler, ender i Branded Stories-feltet i 2 uker. Fast pris. Eks. mva.", recordedById:ACTOR });
  const cur = await prisma.title.findUnique({ where:{id:KAMP}, select:{outstandingInfo:true} });
  await prisma.title.update({ where:{id:KAMP}, data:{ offersNativeContent:true, pricingAsOf:NOW, lastVerifiedAt:NOW,
    verificationStatus:"LIVE", verificationSource:"Kampanje (Nina Gade Tenvik) faste priser 2026-06-05",
    outstandingInfo:{ set:(cur?.outstandingInfo??[]).filter(s=>!s.includes("Indikativ native-/Branded Content-pris avventer")) } } });
  console.log("Kampanje: 2 native-quotes (25 000 / 75 000) logget, outstanding fjernet.");
  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
