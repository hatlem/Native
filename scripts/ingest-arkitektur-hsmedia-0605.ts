/** Anita Lindberg (HS Media, al@hsmedia.no), reply 2026-06-04 08:40 (behandlet 06-05).
 * Arkitektur N + Arkitekturnytt (Arkitektnytt) slått sammen -> "Arkitektur" (arkitektur.no).
 * Native ad = 15 000 kr eks mva / 14 dager. Byggekunst: Anita håndterer ikke. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";
const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-04T08:40:00.000Z");
const ARKITEKTUR = "cmpmdiqa201v30hu06yzscfna"; // Arkitektur N -> survivor "Arkitektur"
const ARK_PROD = "cmpn1ct4400dw0hvywwcu4kf2";
const ARKITEKTNYTT = "cmpmdiqa201v20hu0x6z0ynvm";
const BYGGEKUNST = "cmpmdiqa201w40hu05hi2tk0x";
const SRC = "HS Media (Anita Lindberg, al@hsmedia.no) 2026-06-04";
async function main() {
  // Survivor: rename Arkitektur N -> Arkitektur, reactivate
  await prisma.title.update({ where:{ id:ARKITEKTUR }, data:{
    name:"Arkitektur", slug:"arkitektur-no", websiteUrl:"https://www.arkitektur.no",
    aliases:{ set:["Arkitektur N","Arkitekturnytt","Arkitektnytt"] },
    discontinuedAt:null, discontinuedNote:null, offersNativeContent:true, pricingAsOf:NOW, lastVerifiedAt:NOW,
    verificationStatus:"LIVE", verificationSource:SRC,
    description:"Arkitektur (arkitektur.no) – HS Media. Sammenslåing av tidl. Arkitektur N og Arkitekturnytt (2025/26)." } });
  const log = await createContactLog({ titleId:ARKITEKTUR, channel:"EMAIL", direction:"INBOUND",
    note:"INBOUND 2026-06-04 08:40: Anita Lindberg (HS Media, al@hsmedia.no, ansvarlig for Arkitektur). Arkitektur N og Arkitekturnytt EKSISTERER IKKE MER – slått sammen til ett magasin+nettside: Arkitektur / arkitektur.no. NATIVE AD = 15 000 kr eks mva for 14 dager. Medieplaner vedlagt (Arkitektur + arkitektur.no). Byggekunst: Anita håndterer ikke / vet ikke hvem som har ansvar.",
    actorId:ACTOR });
  await logQuote({ productId:ARK_PROD, contactLogId:log.id, price:15000, currency:"NOK", priceUnit:"FLAT",
    includedText:"Native ad (arkitektur.no), 14 dager. Eks. mva. (Tidl. Arkitektur N + Arkitekturnytt, nå slått sammen.)", recordedById:ACTOR });
  // Arkitektnytt -> merged, stays discontinued with note
  await prisma.title.update({ where:{ id:ARKITEKTNYTT }, data:{ discontinuedNote:"Slått sammen med Arkitektur N til 'Arkitektur' (arkitektur.no) – HS Media (Anita Lindberg) 2026-06-04. Se Arkitektur.", lastVerifiedAt:NOW, verificationSource:SRC } });
  // Byggekunst -> note Anita doesn't handle
  await createContactLog({ titleId:BYGGEKUNST, channel:"EMAIL", direction:"INBOUND",
    note:"INBOUND 2026-06-04: Anita Lindberg (HS Media) håndterer IKKE Byggekunst og vet ikke hvem som har ansvar. Byggekunst (historisk arkitekturtidsskrift, ble Arkitektur N) – forblir deaktivert; egen kontakt kreves hvis fortsatt aktiv.", actorId:ACTOR });
  console.log("Arkitektur: opprettet/omdøpt fra Arkitektur N + native 15 000/14 dager logget; Arkitektnytt merged; Byggekunst notert.");
  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
