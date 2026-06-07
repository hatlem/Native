/** A2Media (Knut Rismyhr) – prices were in the EMAIL BODY (07:23), not just PDFs.
 * Park & Anlegg native = «annonsørinnhold»-plass 10 000/mnd. Enrich Gartneryrket + Fjell og Vidde. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";
const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-05T07:23:00.000Z");
const PA = { title:"cmpmdiqa702250hu08hjc85av", prod:"cmpn1ct4j00kz0hvyvybd7re4" };
const GA = { title:"cmpmdiqa301xq0hu0ywvth9h1", prod:"cmpn1ct4400gk0hvyfzefo99c" };
const FV = { title:"cmpmdiqa301x20hu0hc5pg9eb", prod:"cmpn1ct4400fw0hvy3cp6f6na" };
const SRC = "A2Media (Knut Rismyhr) e-post 2026-06-05; Norsk Gartnerforbund";

async function main() {
  // --- Park & Anlegg ---
  const pcur = await prisma.title.findUnique({ where:{id:PA.title}, select:{outstandingInfo:true} });
  const plog = await createContactLog({ titleId:PA.title, channel:"EMAIL", direction:"INBOUND",
    note:"INBOUND 2026-06-05: Knut Rismyhr (A2Media, knut@a2media.no, +47 900 95 203), Norsk Gartnerforbund. NATIVE «annonsørinnhold»-plass: eksklusiv plass høyt på forsiden av parkoganlegg.no, hele måneden, dere alene = 10 000 kr/måned (utsolgt september + november for park). Print: 2/1 side (oppslag) 18 000/innrykk (veil 25 000); 1/1 side 13 000/innrykk (veil 16 000). Samme priser gjelder Gartneryrket.",
    actorId:ACTOR });
  await logQuote({ productId:PA.prod, contactLogId:plog.id, price:10000, currency:"NOK", priceUnit:"FLAT",
    includedText:"Native «annonsørinnhold»-plass: eksklusiv, høyt på forsiden parkoganlegg.no, hele måneden. Pris per måned. Utsolgt sept+nov. Eks. mva.", recordedById:ACTOR });
  await logQuote({ draftProductType:"ADVERTORIAL", draftProductName:"1/1 side print (Park & Anlegg)", draftProductDesc:"1/1 side i printutgaven, per innrykk.",
    contactLogId:plog.id, price:13000, currency:"NOK", priceUnit:"FLAT", includedText:"1/1 side print, per innrykk (veil 16 000). 2/1 oppslag 18 000. Eks. mva.", recordedById:ACTOR });
  await prisma.title.update({ where:{id:PA.title}, data:{ offersNativeContent:true, pricingAsOf:NOW, lastVerifiedAt:NOW,
    verificationStatus:"LIVE", verificationSource:SRC,
    outstandingInfo:{ set:(pcur?.outstandingInfo??[]).filter(s=>!s.includes("Native-pris i A2Media medieplan-PDF")) } } });

  // --- Gartneryrket: add native «annonsørinnhold» 10 000/mnd ---
  const glog = await createContactLog({ titleId:GA.title, channel:"EMAIL", direction:"INBOUND",
    note:"INBOUND 2026-06-05: Knut Rismyhr (A2Media). NATIVE «annonsørinnhold»-plass på gartneryrket.no = 10 000 kr/måned (eksklusiv, hele måneden). Print 2/1 oppslag 18 000/innrykk, 1/1 13 000/innrykk (logget tidligere). Norsk Gartnerforbund.",
    actorId:ACTOR });
  await logQuote({ productId:GA.prod, contactLogId:glog.id, price:10000, currency:"NOK", priceUnit:"FLAT",
    includedText:"Native «annonsørinnhold»-plass: eksklusiv, høyt på forsiden gartneryrket.no, hele måneden. Pris per måned. Eks. mva.", recordedById:ACTOR });

  // --- Fjell og Vidde: add 2/1 + DNT approval note ---
  const flog = await createContactLog({ titleId:FV.title, channel:"EMAIL", direction:"INBOUND",
    note:"INBOUND 2026-06-05: Knut Rismyhr (A2Media), Fjell & Vidde (DNT). Print 2/1 side 70 000 (veil 100 000, kun 1 igjen); 1/1 side 50 000 (veil 75 000, kun 3 igjen) – logget. Utgivelse 26. sept. VIKTIG: annonsør må godkjennes av DNT (hyttebygging, reiseliv utenlands, motorferdsel i utmark er IKKE godkjent). Digitalt (ut.no/dnt.no) = kun bannerløsninger, visningsbasert (XL Board CPM 70, Board CPM 50) – display, utenfor native-scope.",
    actorId:ACTOR });
  await logQuote({ draftProductType:"ADVERTORIAL", draftProductName:"2/1 oppslag print (Fjell & Vidde)", draftProductDesc:"2/1 oppslag i printutgaven av Fjell & Vidde (DNT).",
    contactLogId:flog.id, price:70000, currency:"NOK", priceUnit:"FLAT", includedText:"2/1 oppslag print (veil 100 000, kun 1 igjen). Annonsør må godkjennes av DNT. Eks. mva.", recordedById:ACTOR });
  const fcur = await prisma.title.findUnique({ where:{id:FV.title}, select:{outstandingInfo:true} });
  await prisma.title.update({ where:{id:FV.title}, data:{ lastVerifiedAt:NOW, verificationStatus:"LIVE", verificationSource:SRC,
    outstandingInfo:{ set:[...new Set([...(fcur?.outstandingInfo??[]), "Annonsør må godkjennes av DNT (ikke hyttebygging/reiseliv utenlands/motorferdsel i utmark)"])] } } });

  console.log("A2Media rest: Park & Anlegg native 10 000/mnd + print logget (outstanding fjernet); Gartneryrket native 10 000/mnd lagt til; Fjell og Vidde 2/1 70 000 + DNT-godkjenning notert.");
  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
