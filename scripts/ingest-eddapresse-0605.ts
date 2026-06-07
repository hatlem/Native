/** Edda Presse (Sissel Bjerkeset, sissel@eddapresse.no), 2026-06-05 13:03.
 * Referanse: 4-siders betalt innhold i Aksess = 35 100 NOK eks mva (~8 775/side).
 * Sissel sjekker eksakt pris per helside/native-artikkel for Fotografi/Folkemusikk/Museum med redaktørene.
 * Publisher-bekreftelse overstyrer automatisk verifisering: Aksess + Museumsnytt er LIVE (feil-deaktivert 06-04) -> reaktiver. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";
const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-05T13:03:00.000Z");
const AKSESS = { id:"cmpmdiqa101um0hu0dyiv24f3", prod:"cmpn1ct4300df0hvy9iu99e6h" };
const MUSEUMSNYTT = "cmpmdiqa501zz0hu058hvsrmc";
const FOTOGRAFI = "cmpmdiq9z01qq0hu0gma0oih4";
const FOLKEMUSIKK = "cmpmdiqa301x70hu05uqbgrlq";
const SRC = "Edda Presse (Sissel Bjerkeset) 2026-06-05; Aksess 1+2 2026-utgave";

async function main() {
  // Reactivate Aksess (publisher confirms live; sent current 2026 issue)
  await prisma.title.update({ where:{ id:AKSESS.id }, data:{ discontinuedAt:null, discontinuedNote:null,
    offersNativeContent:true, pricingAsOf:NOW, lastVerifiedAt:NOW, verificationStatus:"LIVE", verificationSource:SRC,
    description:"Aksess – tidsskrift for arkiv og dokumentasjonsforvaltning (Edda Presse)." } });
  const alog = await createContactLog({ titleId:AKSESS.id, channel:"EMAIL", direction:"INBOUND",
    note:"INBOUND 2026-06-05: Sissel Bjerkeset (Edda Presse, sissel@eddapresse.no). REFERANSEPRIS: 4-siders betalt innhold (annonsørinnhold) i Aksess = 35 100 NOK eks mva (~8 775/side). Sendte gjeldende Aksess 1+2 2026-utgave (betalt innhold s. 78-81). Tittelen var feil-deaktivert 06-04 – reaktivert (publisher-bekreftet LIVE). Eksakt native-pris per tittel kommer når sidetall er avklart (svart: 1 helside/native-artikkel per tittel som utgangspunkt).",
    actorId:ACTOR });
  await logQuote({ productId:AKSESS.prod, contactLogId:alog.id, price:35100, currency:"NOK", priceUnit:"FLAT",
    includedText:"Referanse: 4-siders betalt innhold (annonsørinnhold) i Aksess, eks mva (~8 775/side). Eksakt pris per helside/native-artikkel avklares med redaktør.", recordedById:ACTOR });

  // Reactivate Museumsnytt (Sissel offering it)
  await prisma.title.update({ where:{ id:MUSEUMSNYTT }, data:{ discontinuedAt:null, discontinuedNote:null,
    offersNativeContent:true, lastVerifiedAt:NOW, verificationStatus:"LIVE", verificationSource:SRC } });
  await createContactLog({ titleId:MUSEUMSNYTT, channel:"EMAIL", direction:"INBOUND",
    note:"INBOUND 2026-06-05: Sissel Bjerkeset (Edda Presse) tilbyr annonsørinnhold i Museumsnytt. Var feil-deaktivert 06-04 – reaktivert (publisher-bekreftet LIVE). Eksakt native-pris per helside avklares med redaktør (ref. Aksess 35 100/4 sider).",
    actorId:ACTOR });

  // Fotografi + Folkemusikk: pending exact price
  for (const id of [FOTOGRAFI, FOLKEMUSIKK]) {
    const cur = await prisma.title.findUnique({ where:{id}, select:{outstandingInfo:true} });
    await createContactLog({ titleId:id, channel:"EMAIL", direction:"INBOUND",
      note:"INBOUND 2026-06-05: Sissel Bjerkeset (Edda Presse). Eksakt native-/helside-pris kommer når sidetall er avklart med redaktørene. Referanse: Aksess 4 sider = 35 100 NOK eks mva (~8 775/side). Svart: 1 helside/native-artikkel per tittel som utgangspunkt for estimat.",
      actorId:ACTOR });
    await prisma.title.update({ where:{id}, data:{ offersNativeContent:true, lastVerifiedAt:NOW, verificationStatus:"LIVE", verificationSource:SRC,
      outstandingInfo:{ set:[...new Set([...(cur?.outstandingInfo??[]), "Eksakt native-/helside-pris avventer redaktør (Edda Presse 2026-06-05); ref. Aksess ~8 775/side"])] } } });
  }

  console.log("Edda Presse: Aksess reaktivert + referanse-quote 35 100 (4 sider); Museumsnytt reaktivert; Fotografi+Folkemusikk pending-pris notert.");
  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
