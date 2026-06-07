/** Edda Presse medieplaner (Sissel Bjerkeset 07:22), 2026-06-05. Behandlet etter 13:03-svar.
 * Fotografi medieplan 2026 størrelser (print, eks mva): Oppslag 19 900, Helside 12 900, Bakside 14 900,
 * Halvside 7 900, Kvartside 4 900. 4 utgaver/år. Content/native må godkjennes av redaktør (helside = referanse). */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";
const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-05T07:22:00.000Z");
const FOTOGRAFI = { title:"cmpmdiq9z01qq0hu0gma0oih4", prod:"cmpn1ct3o009j0hvy9iugqval" };
const FOLKEMUSIKK = "cmpmdiqa301x70hu05uqbgrlq";
const MUSEUM = "cmpmdiqa501zz0hu058hvsrmc";
const SRC = "Edda Presse (Sissel Bjerkeset) medieplan 2026, 2026-06-05";
async function main() {
  // Fotografi – konkrete størrelser
  const log = await createContactLog({ titleId:FOTOGRAFI.title, channel:"EMAIL", direction:"INBOUND",
    note:"INBOUND 2026-06-05 07:22: Sissel Bjerkeset (Edda Presse) – medieplan Fotografi 2026 (4 utgaver/år, format 233x328mm). Priser eks mva: Oppslag 19 900, Helside 12 900, Bakside 14 900, Halvside 7 900, Kvartside 4 900. Content/native må godkjennes av redaktør (trenger annonsør+innhold før ferdig materiell); native/content prises på størrelsesnivå (helside = referanse ~12 900, jf. Aksess 4 sider 35 100). Fotografi nr 3 hadde annonsefrist 1. juni.",
    actorId:ACTOR });
  await logQuote({ productId:FOTOGRAFI.prod, contactLogId:log.id, price:12900, currency:"NOK", priceUnit:"FLAT",
    includedText:"Native/content-referanse = helside Fotografi (print), eks mva. Oppslag 19 900, bakside 14 900, halvside 7 900, kvartside 4 900. Content/native må godkjennes redaksjonelt; eksakt native-pris bekreftes per sidetall.", recordedById:ACTOR });
  const fcur = await prisma.title.findUnique({ where:{id:FOTOGRAFI.title}, select:{outstandingInfo:true} });
  await prisma.title.update({ where:{id:FOTOGRAFI.title}, data:{ offersNativeContent:true, pricingAsOf:NOW, lastVerifiedAt:NOW, verificationStatus:"LIVE", verificationSource:SRC,
    outstandingInfo:{ set:(fcur?.outstandingInfo??[]).filter(s=>!s.includes("Eksakt native-/helside-pris avventer redakt")) } } });

  // Folkemusikk + Museum – medieplan mottatt, størrelsesbaserte priser i PDF (ikke fabrikert)
  for (const id of [FOLKEMUSIKK, MUSEUM]) {
    await createContactLog({ titleId:id, channel:"EMAIL", direction:"INBOUND",
      note:"INBOUND 2026-06-05 07:22: Sissel Bjerkeset (Edda Presse) – medieplan 2026 vedlagt (størrelsesbaserte priser i PDF, struktur som Fotografi: oppslag/helside/halvside/kvartside). Content/native = helside-nivå, må godkjennes av redaktør; eksakt native-pris bekreftes per sidetall. Aksess-referanse 4 sider = 35 100.",
      actorId:ACTOR });
    await prisma.title.update({ where:{id}, data:{ offersNativeContent:true, lastVerifiedAt:NOW, verificationStatus:"LIVE", verificationSource:SRC } });
  }
  console.log("Fotografi: helside-native 12 900 + størrelser logget (outstanding fjernet). Folkemusikk + Museum: medieplan-note (størrelser i PDF).");
  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
