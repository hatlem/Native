/** Håkon Nissen-Lie (Norsk Maritimt Forlag, hakon@batmagasinet.no), 2026-06-05 13:49.
 * Mediakit NMF 2026 for Båtmagasinet / Magasinet Båt / Båtliv (+ Seilmagasinet, ikke vår tittel).
 * Digital native (nettsidene): 5 000 kr/uke (regular) + 9 000 kr/uke (større). WebTV advertorial (3 min): 20 000/episode.
 * Print-priser per tittel i mediakit (ikke fabrikert her). Volume-rabatter tilbys. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";
const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const NOW = new Date("2026-06-05T13:49:00.000Z");
const SRC = "Norsk Maritimt Forlag (Håkon Nissen-Lie) Mediakit NMF 2026; batmagasinet.no";
const NOTE = "INBOUND 2026-06-05 13:49: Håkon Nissen-Lie (Sales Manager, Norsk Maritimt Forlag, hakon@batmagasinet.no, +47 410 40 816). Mediakit NMF 2026 (felles for Båtmagasinet/Magasinet Båt/Båtliv/Seilmagasinet). DIGITAL NATIVE på nettsidene: 5 000 kr/uke (regular) + 9 000 kr/uke (større). WebTV advertorial (3 min): 20 000 kr/episode. Display = CPM (Topboard/Megaboard osv – utenfor scope). Print-priser per tittel i mediakit (f.eks. Seilmagasinet 1/1 21 800 / 2/1 39 400). Annonser: annonser@batmagasinet.no. Gode volume-rabatter. Lenker: batmagasinet.no/annonser, seilmagasinet.no/annonser.";
async function logNative(titleId:string, prod:string){
  const log = await createContactLog({ titleId, channel:"EMAIL", direction:"INBOUND", note:NOTE, actorId:ACTOR });
  await logQuote({ productId:prod, contactLogId:log.id, price:5000, currency:"NOK", priceUnit:"FLAT",
    includedText:"Digital native (nettside), regular, pris per uke. NMF 2026-mediakit. Eks. mva. Volume-rabatter.", recordedById:ACTOR });
  await logQuote({ draftProductType:"NATIVE_ARTICLE", draftProductName:"Digital native – større (per uke)", draftProductDesc:"Større digital native-plassering på nettside.",
    contactLogId:log.id, price:9000, currency:"NOK", priceUnit:"FLAT", includedText:"Digital native (nettside), større plassering, per uke. Eks. mva.", recordedById:ACTOR });
  await logQuote({ draftProductType:"CONTENT_VIDEO", draftProductName:"WebTV advertorial (3 min)", draftProductDesc:"3 minutters advertorial på WebTV.",
    contactLogId:log.id, price:20000, currency:"NOK", priceUnit:"FLAT", includedText:"WebTV advertorial, 3 min, per episode. Eks. mva.", recordedById:ACTOR });
  return log;
}
async function main() {
  // Båtmagasinet (active)
  await logNative("cmpmdiq9y01pz0hu080jemb7l","cmpn1ct3o008s0hvyuateb5d2");
  await prisma.title.update({ where:{id:"cmpmdiq9y01pz0hu080jemb7l"}, data:{ offersNativeContent:true, pricingAsOf:NOW, lastVerifiedAt:NOW, verificationStatus:"LIVE", verificationSource:SRC } });
  // Magasinet Båt (reactivate – Håkon/NMF sells it)
  await logNative("cmpmdiqab027g0hu01h56vc06","cmpn1ct4y00qb0hvykv7fcqsd");
  await prisma.title.update({ where:{id:"cmpmdiqab027g0hu01h56vc06"}, data:{ discontinuedAt:null, discontinuedNote:null, offersNativeContent:true, pricingAsOf:NOW, lastVerifiedAt:NOW, verificationStatus:"LIVE", verificationSource:SRC } });
  // Båtliv (NO, batliv.no) – reactivate + note NO/SE distinction
  await logNative("cmpmdiq9y01py0hu0t5a4jqk3","cmpn1ct3o008r0hvy8cvn24c0");
  await prisma.title.update({ where:{id:"cmpmdiq9y01py0hu0t5a4jqk3"}, data:{ discontinuedAt:null, discontinuedNote:null, offersNativeContent:true, pricingAsOf:NOW, lastVerifiedAt:NOW, verificationStatus:"LIVE",
    verificationSource:SRC, aliases:{ set:["Båtliv (NO)","Båtliv Norge"] } } });
  await createContactLog({ titleId:"cmpmdiq9y01py0hu0t5a4jqk3", channel:"EMAIL", direction:"INBOUND",
    note:"MERK: Dette er NORSKE Båtliv (batliv.no, Norsk Maritimt Forlag). IKKE samme som svenske Båtliv (Marina Media/batmedia.se, 'Europas största båttidning') som finnes som egen katalogoppføring. Reaktivert – Håkon (NMF) selger den.", actorId:ACTOR });
  console.log("NMF: Båtmagasinet + Magasinet Båt + Båtliv(NO) – native 5000/9000 per uke + webTV 20000 logget; Magasinet Båt & Båtliv reaktivert; NO/SE Båtliv-distinksjon notert.");
  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
