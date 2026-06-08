/** FA Brand Studio native (Finansavisen/Hegnar Media) + TU.no/Digi.no reader stats,
 * from mediekit PDFs (06-04 replies). Dup-guarded native quotes. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";
const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
async function findNO(names: string[]) {
  return prisma.title.findFirst({ where: { countryCode: "NO", name: { in: names, mode: "insensitive" } }, select: { id: true, name: true } });
}
async function getOrCreateLog(titleId: string, marker: string, note: string) {
  const e = await prisma.contactLog.findFirst({ where: { titleId, note: { contains: marker } }, select: { id: true } });
  return e ?? await createContactLog({ titleId, channel: "EMAIL", direction: "INBOUND", note, actorId: ACTOR });
}
async function quoteSafe(titleId: string, q: any) {
  const ex = await prisma.priceQuote.count({ where: { contactLog: { titleId }, price: q.price, priceUnit: q.priceUnit, draftProductName: q.draftProductName } });
  if (ex) { console.log(`   skip ${q.draftProductName}`); return; }
  await logQuote(q);
}
async function main() {
  const fa = await findNO(["Finansavisen"]);
  if (fa) {
    await prisma.title.update({ where:{id:fa.id}, data:{ offersNativeContent:true } });
    const note = "INBOUND 2026-06-04: FA Brand Studio muligheter 2026 (Hegnar Media). NATIVE 3 produkter: (1) Native/Readpeak CPC 20 kr/klikk netto; (2) Premium native SOV 60 000/uke brutto ELLER CPC 20/klikk (kun CMS-artikler); (3) Content i display CPM (superboard+produksjon). BRANDED STORIES video premium: CPM 1125 brutto + 20 000 oppsett, kampanje min 300 000, video 1080x1920 maks 60s. Studioprod-intro: videointervju 3-5 min + native-artikkel på FA.no forside + FA Direkte, garantert 3000 visn., kunden eier innhold = 100 000. Video i høydeformat: preroll etter 8s, std OLV-priser. Content på print: Finansavisen + Kapital. Contenttjenester: tekst, video, IR-intervju, podcast, SoMe/LinkedIn, event (Arendalsuka/ONS/Investordagen).";
    const log = await getOrCreateLog(fa.id, "FA Brand Studio", note);
    await quoteSafe(fa.id, { draftProductType:"NATIVE_ARTICLE", draftProductName:"Native (Readpeak) CPC", draftProductDesc:"Native via Readpeak, CMS/VeV/ekstern.", contactLogId:log.id, price:20, currency:"NOK", priceUnit:"CPC", includedText:"20 kr per klikk (netto).", recordedById:ACTOR });
    await quoteSafe(fa.id, { draftProductType:"NATIVE_PLUS", draftProductName:"Premium native SOV", draftProductDesc:"Premium native, kun CMS-artikler, share-of-voice.", contactLogId:log.id, price:60000, currency:"NOK", priceUnit:"FLAT", includedText:"SOV, per uke (brutto). Alt.: CPC 20/klikk.", recordedById:ACTOR });
    await quoteSafe(fa.id, { draftProductType:"CONTENT_VIDEO", draftProductName:"Branded stories video (premium)", draftProductDesc:"Interaktiv superboard video høydeformat 1080x1920, maks 60s, via Ad Manager, eget CMS.", contactLogId:log.id, price:1125, currency:"NOK", priceUnit:"CPM", includedText:"CPM brutto + 20 000 oppsett. Kampanje min 300 000.", recordedById:ACTOR });
    await quoteSafe(fa.id, { draftProductType:"PACKAGE", draftProductName:"FA Brand Studio studioprod-intro", draftProductDesc:"Videointervju 3-5 min + native-artikkel på FA.no forside + FA Direkte + rettigheter. Garantert 3000 artikkelvisninger.", contactLogId:log.id, price:100000, currency:"NOK", priceUnit:"FLAT", includedText:"Introduksjonstilbud: studioproduksjon, artikkel og distribusjon. Kunden eier alt innhold.", recordedById:ACTOR });
    console.log(`Finansavisen: FA Brand Studio native (CPC 20, premium 60k/uke, branded video CPM 1125, studio-pakke 100k) + offersNative`);
  } else console.log("! Finansavisen not found");

  const kap = await findNO(["Kapital"]);
  if (kap) { await prisma.title.update({ where:{id:kap.id}, data:{ offersNativeContent:true } });
    await getOrCreateLog(kap.id, "FA Brand Studio", "INBOUND 2026-06-04: FA Brand Studio (Hegnar Media) tilbyr content på print i Kapital (koordineres med desken) + native-produkter på tvers (se Finansavisen for native-priser: Readpeak CPC 20, premium SOV 60 000/uke, branded video CPM 1125+20k oppsett, studio-pakke 100 000).");
    console.log("Kapital: FA Brand Studio content-note + offersNative"); }

  const tu = await findNO(["TU.no","Teknisk Ukeblad","TU"]);
  if (tu) { await prisma.title.update({ where:{id:tu.id}, data:{ digitalReach:700000, audienceNote:"TU.no: Norges viktigste nettsted for ny teknologi/teknologibransjen. 700 000 lesere/mnd, 3,1 mill sidevisn./mnd. 92% >10 års erfaring, 41% ingeniører, 48% beslutningsmyndighet på teknologiinvesteringer, 75% privat/25% offentlig sektor. Kilde: TU demografi 2026." } });
    console.log(`TU [${tu.name}]: digitalReach 700000 + audienceNote`); } else console.log("! TU.no not found");

  const digi = await findNO(["Digi.no","Digi"]);
  if (digi) { await prisma.title.update({ where:{id:digi.id}, data:{ digitalReach:300000, audienceNote:"Digi.no: Norges eldste nettavis uten papiropphav (1996), nyheter om digital utvikling/IT-bransjen. 300 000 lesere/mnd, 1,3 mill sidevisn./mnd. 44% beslutningsmyndighet, 25% lederrolle, 69% privat/31% offentlig. Kilde: Digi demografi 2026." } });
    console.log(`Digi [${digi.name}]: digitalReach 300000 + audienceNote`); } else console.log("! Digi.no not found");

  await prisma.$disconnect();
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
