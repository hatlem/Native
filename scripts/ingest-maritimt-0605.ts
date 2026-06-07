/** Log Maritimt Magasin INBOUND (Terje, tg@maritimt.com), 2026-06-05 08:59.
 * Offers native (annonsørinnhold/sponsorartikler) + profil/bedrift, display på
 * Maritimt.com, print, kombipakker. INGEN video-native. Needs brief before quote.
 * Confirms Maritimt/Maritimt.com is NOT Sjøfartsbladet (validates FAKE flag). */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-05T08:59:00.000Z");
const MARITIMT = "cmpmdiqa501zo0hu06ddam2pc";
const SJOFART = "cmpmdiqa7022u0hu0b0c2kz0x";

async function main() {
  await createContactLog({
    titleId: MARITIMT, channel: "EMAIL", direction: "INBOUND",
    note:
      "INBOUND 2026-06-05: Maritimt Magasin (tg@maritimt.com) svarte. Tilbyr: annonsørinnhold/sponsorartikler (NATIVE), profil- og bedriftsartikler, " +
      "display på Maritimt.com, annonser i printutgaven, kombinasjonspakker (digitalt+print). Tilbyr IKKE video-native/videoproduksjon. " +
      "Trenger brief (annonsør, målgruppe, mål, ønsket periode/varighet) før de gir tilbud – periode/varighet påvirker format og pris. Ingen priser ennå. " +
      "Avklarte: Maritimt Magasin og Maritimt.com er IKKE tilknyttet Sjøfartsbladet (kan ikke bistå på den).",
    actorId: ACTOR,
  });
  const cur = await prisma.title.findUnique({ where:{ id:MARITIMT }, select:{ outstandingInfo:true } });
  await prisma.title.update({ where:{ id:MARITIMT }, data:{
    offersNativeContent: true, pricingAsOf: NOW, lastVerifiedAt: NOW,
    verificationStatus: "LIVE", verificationSource: "Maritimt Magasin (tg@maritimt.com) reply 2026-06-05",
    outstandingInfo: { set: [...new Set([...(cur?.outstandingInfo??[]), "Native-pris krever brief (annonsør/målgruppe/periode) – Maritimt 2026-06-05; tilbyr ikke video-native"])] },
  }});

  // Confirming note on the (correctly) FAKE Sjøfartsbladet
  await createContactLog({
    titleId: SJOFART, channel: "EMAIL", direction: "INBOUND",
    note: "INBOUND 2026-06-05: Maritimt Magasin bekrefter at Maritimt.com IKKE er tilknyttet Sjøfartsbladet. Støtter FAKE-flagget (maritimt.com tilhører Maritimt Magasin). Forblir deaktivert; egen kontakt kreves dersom et reelt 'Sjøfartsbladet' finnes.",
    actorId: ACTOR,
  });

  console.log("Maritimt Magasin: INBOUND logget, offersNative=true, brief-mangel notert. Sjøfartsbladet: bekreftende FAKE-notat.");
  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
