/** NMF (Norsk Maritimt Forlag) Mediakit 2026 — Båtmagasinet + SEILmagasinet.
 * Captures reader/circulation/newsletter/web stats + native prices (dup-guarded). */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
async function findNO(name: string) {
  return prisma.title.findFirst({ where: { countryCode: "NO", name: { equals: name, mode: "insensitive" } }, select: { id: true, name: true } });
}
async function getOrCreateLog(titleId, note) {
  const existing = await prisma.contactLog.findFirst({ where: { titleId, note: { contains: "NMF Mediakit 2026" } }, select: { id: true } });
  if (existing) return existing;
  return createContactLog({ titleId, channel: "EMAIL", direction: "INBOUND", note, actorId: ACTOR });
}
async function logQuoteSafe(titleId: string, q: any) {
  const exists = await prisma.priceQuote.count({ where: { contactLog: { titleId }, price: q.price, priceUnit: q.priceUnit } });
  if (exists > 0) { console.log(`   skip dup ${q.draftProductName} ${q.price}`); return; }
  await logQuote(q);
}

const NATIVE = (title: string) => [
  { draftProductType:"NATIVE_ARTICLE", draftProductName:`Native ad regular (${title})`, draftProductDesc:"Digital native på nettstedet, per uke.", price:5000, currency:"NOK", priceUnit:"FLAT", includedText:"Native ad regular, pris per uke. eks. mva.", recordedById:ACTOR },
  { draftProductType:"NATIVE_ARTICLE", draftProductName:`Native ad premium (${title})`, draftProductDesc:"Digital native premium på nettstedet, per uke.", price:9000, currency:"NOK", priceUnit:"FLAT", includedText:"Native ad (høyere nivå), pris per uke. eks. mva.", recordedById:ACTOR },
  { draftProductType:"NATIVE_ARTICLE", draftProductName:`Nyhetsbrev native (${title})`, draftProductDesc:"Native i nyhetsbrev, per utsendelse.", price:5500, currency:"NOK", priceUnit:"FLAT", includedText:"Newsletter native ad, per mail-out. eks. mva.", recordedById:ACTOR },
  { draftProductType:"CONTENT_VIDEO", draftProductName:`Web-TV advertorial 3 min (${title})`, draftProductDesc:"Online-TV advertorial, 3 minutter, per episode.", price:20000, currency:"NOK", priceUnit:"FLAT", includedText:"3 minutes advertorial, per episode. eks. mva.", recordedById:ACTOR },
];

async function main() {
  const bm = await findNO("Båtmagasinet");
  if (bm) {
    await prisma.title.update({ where:{id:bm.id}, data:{ offersNativeContent:true, facebookFollowers:33000, digitalReach:100000,
      commercialExtra:{ source:"NMF Mediakit 2026 (Håkon Nissen-Lie)", printReaders:99000, printReadersSource:"Kantar TNS", printCirculation:7600, editionsPerYear:8, webUniqueVisitorsYearly:1200000, newsletterSubscribers:17000, newsletterFreq:"2x/uke, ~50% åpning", facebookFollowers:33000, webBannerCPM:{topboard:390,megaboard:580,brandboard:290,netboard:200,skyscraper:290,videoPreroll:590} } } });
    const log = await getOrCreateLog(bm.id, "INBOUND 2026-06-08: NMF Mediakit 2026 (Håkon Nissen-Lie, hakon@seilmagasinet.no, tlf 410 40 816). BÅTMAGASINET: 8 utg/år, opplag 7600, 99000 lesere (Kantar TNS); batmagasinet.no 1,2M unike/år; nyhetsbrev 17000 (2x/uke ~50% åpning); FB 33000. NATIVE: 5000/uke, 9000/uke; nyhetsbrev-native 5500/utsendelse; web-TV advertorial 3 min 20000/episode; video preroll CPM 590. Print: 1/1 30300, 2/1 53900, 1/2 17100, 1/4 9900, omslag 32500-39600.");
    for (const q of NATIVE("Båtmagasinet")) await logQuoteSafe(bm.id, { ...q, contactLogId: log.id });
    console.log("Båtmagasinet: reader-data + native-quotes (dup-guarded) + offersNative");
  } else console.log("! Båtmagasinet not found");

  const sm = await findNO("Seil Magasinet") || await findNO("SEILmagasinet") || await findNO("Seilmagasinet");
  if (sm) {
    await prisma.title.update({ where:{id:sm.id}, data:{ offersNativeContent:true, facebookFollowers:12000, digitalReach:46000,
      commercialExtra:{ source:"NMF Mediakit 2026 (Håkon Nissen-Lie)", printReaders:42000, printReadersSource:"Kantar TNS", printCirculation:9600, editionsPerYear:6, webUniqueVisitorsYearly:550000, newsletterSubscribers:14000, newsletterFreq:"2x/uke, ~50% åpning", facebookFollowers:12000, webBannerCPM:{topboard:390,megaboard:580,brandboard:290,netboard:200,skyscraper:290,videoPreroll:590} } } });
    const log = await getOrCreateLog(sm.id, "INBOUND 2026-06-08: NMF Mediakit 2026 (Håkon Nissen-Lie). SEILMAGASINET (Skandinavias eneste rene seilmagasin): 6 utg/år, opplag 9600, 42000 lesere (Kantar TNS); seilmagasinet.no 550K unike/år; nyhetsbrev 14000 (2x/uke ~50% åpning); FB 12000; samarbeid med 20 av de største seilforeningene. NATIVE: 5000/uke, 9000/uke; nyhetsbrev-native 5500/utsendelse; web-TV advertorial 3 min 20000/episode; video preroll CPM 590. Print: 1/1 21800, 2/1 39400, 1/2 14100, 1/4 8200, omslag 26200-29500.");
    for (const q of NATIVE("Seil Magasinet")) await logQuoteSafe(sm.id, { ...q, contactLogId: log.id });
    console.log(`Seil Magasinet [${sm.name}]: reader-data + native-quotes + offersNative`);
  } else console.log("! Seil Magasinet not found");

  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
