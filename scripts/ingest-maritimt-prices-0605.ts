/** Maritimt Magasin (tg@maritimt.com) size-based rates after budget brief, 2026-06-05 13:52.
 * Alle priser eks. mva, per utgave, gjelder trykt magasin + e-magasin + digital på maritimt.com.
 * Sponsorartikkel/annonsørinnhold prises etter størrelse (helside = referanse). */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";
const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-05T13:52:00.000Z");
const MAR = "cmpmdiqa501zo0hu06ddam2pc";
const PROD = "cmpn1ct4i00ii0hvyhrw9a36f";
async function main() {
  const log = await createContactLog({ titleId:MAR, channel:"EMAIL", direction:"INBOUND",
    note:"INBOUND 2026-06-05 13:52: Maritimt Magasin (tg@maritimt.com) – priser etter budsjett-brief (vedlegg sizes.pdf). Alle priser eks. mva, PER UTGAVE, gjelder trykt magasin + e-magasin + digital annonse på maritimt.com (digitalt ute 1 mnd). Størrelser: Dobbeltside 430x307mm (stand alone, inkl. 300x500px digital) veil 36 000; Helside 220x307mm print/300x500px digitalt veil 18 000; Halvside veil 16 000; Kvartside veil 14 000. Kampanje (Nor-Fishing): helside+digital i 3 utgaver = 42 000. Sponsorartikkel/annonsørinnhold prises etter størrelse (helside = referanse).",
    actorId:ACTOR });
  await logQuote({ productId:PROD, contactLogId:log.id, price:18000, currency:"NOK", priceUnit:"FLAT",
    includedText:"Annonsørinnhold/sponsorartikkel = helside 220x307mm print + 300x500px digital på maritimt.com, per utgave (veil). Dekker trykt+e-magasin+digital. Dobbeltside 36 000, halvside 16 000, kvartside 14 000. Nor-Fishing-kampanje: helside+digital x3 utgaver 42 000. Eks. mva.",
    recordedById:ACTOR });
  await prisma.title.update({ where:{id:MAR}, data:{ offersNativeContent:true, pricingAsOf:NOW, lastVerifiedAt:NOW,
    verificationStatus:"LIVE", verificationSource:"Maritimt Magasin (tg@maritimt.com) priser 2026-06-05; sizes.pdf" } });
  console.log("Maritimt Magasin: helside annonsørinnhold 18 000 logget (full størrelsesliste + Nor-Fishing i note).");
  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
