/** Complete Bjarte Lerø (Medier og Ledelse) ingest, 2026-06-05.
 * Already logged: Samtiden/DP/Friluftsliv (Tilbud 2 quote + notes). Missing:
 *  - Reiseliv1 not in catalog -> create + native product + quotes (Tilbud 1 3000 / Tilbud 2 7000).
 *  - Add Tilbud 1 quotes (annonsørinnhold-side, min 2 år) for DP/Samtiden/Friluftsliv.
 *  - Tidsskriftet Plan: ingen annonsørinnhold-side enda. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-05T11:12:00.000Z");

const DP = { title:"cmpmdiqaa02720hu0uolx5kip", log:"cmq0qsl5z00010hohaamb2vmp", t1:4000 };
const SAM = { title:"cmpmdiqa001t60hu029kyogof", log:"cmq0qslgg00070hohhi12ql75", t1:4000 };
const FRI = { title:"cmpmdiqa301xk0hu0r4as5tpu", log:"cmq0qsln3000d0hoh2re9wdhw", t1:2000 };
const PLAN = "cmpmdiqa702280hu0sfsafums";

async function main() {
  // --- Tilbud 1 quotes for the three already-logged titles ---
  for (const t of [DP, SAM, FRI]) {
    await logQuote({
      draftProductType: "ADVERTORIAL", draftProductName: "Annonsørinnhold – kun publisering (annonsørinnhold-side)",
      draftProductDesc: "Tilbud 1: publisering av annonsørinnhold på utgivers annonsørinnhold-side (via partnerinnhold.no), ligger i minimum 2 år. Uten fronting/nyhetsbrev.",
      contactLogId: t.log, price: t.t1, currency: "NOK", priceUnit: "FLAT",
      includedText: "Tilbud 1: kun publisering på annonsørinnhold-side, ligger min. 2 år. Eks. mva. (Tilbud 2 med fronting+nyhetsbrev logget separat.)",
      recordedById: ACTOR,
    });
  }

  // --- Reiseliv1: create title + native product + quotes ---
  let reiseliv = await prisma.title.findFirst({ where:{ name:"Reiseliv1", countryCode:"NO" }, select:{id:true} });
  if (!reiseliv) {
    reiseliv = await prisma.title.create({ data:{
      name: "Reiseliv1", slug: "reiseliv1-no", countryCode: "NO",
      publisherId: "cmpmdiq5700jq0hu0a50pq084", marketId: "cmpmdiq3o00000hu08iw009x9",
      websiteUrl: "https://www.reiseliv1.no", category: "Reiseliv", vertical: "B2C – Travel", b2bB2c: "B2C",
      type: "Nettsted/magasin", ownerGroup: "Medier og Ledelse", publisherName: "Medier og Ledelse",
      salesChannel: "DIRECT", adSales: "Direkte hos utgiver (Bjarte Lerø)",
      offersNativeContent: true, active: true, pricingAsOf: NOW, lastVerifiedAt: NOW,
      verificationStatus: "LIVE", verificationSource: "Bjarte Lerø (Medier og Ledelse) tilbud 2026-06-05; reiseliv1.no",
      description: "Norsk reiselivsnettsted (Medier og Ledelse). ~11 000 sidevisninger/mnd, nyhetsbrev ~6 600 abonnenter.",
    }, select:{id:true} });
  }
  const prod = await prisma.product.create({ data:{
    titleId: reiseliv.id, type: "NATIVE_ARTICLE", name: "Native article",
    description: "Annonsørinnhold publisert på reiseliv1.no (via partnerinnhold.no).",
    pricingModel: "FLAT", basePrice: "7000", currency: "NOK", visibility: "INDICATIVE",
    leadTimeDays: 10, active: true, bookable: true,
  }, select:{id:true} });

  const rlog = await createContactLog({ titleId: reiseliv.id, channel:"EMAIL", direction:"INBOUND",
    note: "INBOUND 2026-06-05: Bjarte Lerø (Medier og Ledelse, bjarte@dagensperspektiv.no). Annonsørinnhold Reiseliv1: Tilbud 1 (kun publisering på annonsørinnhold-side, min 2 år) 3000 kr; Tilbud 2 (publisering + fronting forside 2 uker + nyhetsbrev, 8 utsendelser/4 ggr uke) 7000 kr. ~11 000 sidevisninger/mnd, nyhetsbrev 6600 abonnenter. Innhold publiseres via partnerinnhold.no.",
    actorId: ACTOR });
  await logQuote({ productId: prod.id, contactLogId: rlog.id, price: 7000, currency:"NOK", priceUnit:"FLAT",
    includedText: "Tilbud 2: annonsørinnhold publisert + fronting forside 2 uker + nyhetsbrev (8 utsendelser, 4 ggr/uke). Eks. mva.", recordedById: ACTOR });
  await logQuote({ draftProductType:"ADVERTORIAL", draftProductName:"Annonsørinnhold – kun publisering (annonsørinnhold-side)",
    draftProductDesc:"Tilbud 1: publisering på annonsørinnhold-side (via partnerinnhold.no), min 2 år.",
    contactLogId: rlog.id, price: 3000, currency:"NOK", priceUnit:"FLAT",
    includedText:"Tilbud 1: kun publisering på annonsørinnhold-side, min 2 år. Eks. mva.", recordedById: ACTOR });

  // --- Tidsskriftet Plan: no annonsørinnhold page yet ---
  const planCur = await prisma.title.findUnique({ where:{ id:PLAN }, select:{ outstandingInfo:true } });
  await createContactLog({ titleId: PLAN, channel:"EMAIL", direction:"INBOUND",
    note:"INBOUND 2026-06-05: Bjarte Lerø (Medier og Ledelse) – Tidsskriftet Plan har ingen egen annonsørinnhold-side opprettet enda, derfor ikke med i tilbudet. Avventer.",
    actorId: ACTOR });
  await prisma.title.update({ where:{ id:PLAN }, data:{ lastVerifiedAt:NOW, verificationStatus:"LIVE",
    verificationSource:"Bjarte Lerø (Medier og Ledelse) 2026-06-05",
    outstandingInfo:{ set:[...new Set([...(planCur?.outstandingInfo??[]), "Ingen annonsørinnhold-side opprettet enda (Medier og Ledelse 2026-06-05) – pris/native avventer"])] } } });

  console.log("Bjarte Lerø: Reiseliv1 opprettet + 2 quotes (3000/7000); Tilbud 1-quotes lagt til DP/Samtiden/Friluftsliv; Plan notert.");
  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
