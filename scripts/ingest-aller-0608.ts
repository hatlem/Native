/** 2026-06-08 Aller Media (SE) native mediekit (WeTransfer "Native.pdf").
 * Sent by Camilla Hedström (Client Manager). Source backed up at
 * docs/outreach-sources/aller/Aller Native 2026.pdf. All prices = NETTO, exkl. moms, SEK.
 * Dup-guarded via INBOUND note tag. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { createSalesContact, attachContactToTitle } from "@/lib/pricing/contacts";
import { logQuote } from "@/lib/pricing/quotes";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const SRC = "Camilla Hedström / Aller Media (SE), Native-mediekit (WeTransfer) 2026-06-08";

async function findT(name: string, cc = "SE") {
  return prisma.title.findFirst({ where: { name: { equals: name, mode: "insensitive" }, countryCode: cc }, select: { id: true, name: true, publisherId: true, outstandingInfo: true } });
}
async function done(titleId: string, tag: string) {
  return (await prisma.contactLog.count({ where: { titleId, direction: "INBOUND", note: { contains: tag } } })) > 0;
}
async function camilla(publisherId: string, titleId: string) {
  let sc = await prisma.salesContact.findFirst({ where: { publisherId, email: "camilla.hedstrom@aller.com" } });
  if (!sc) sc = await createSalesContact({ publisherId, name: "Camilla Hedström", email: "camilla.hedstrom@aller.com", phone: "+46708613270", role: "Client Manager, Aller Media (SE)", notes: "Sendte Aller SE native-mediekit (WeTransfer) 06-08.", actorId: ACTOR });
  await attachContactToTitle({ salesContactId: sc.id, titleId, isPrimary: true, actorId: ACTOR });
}
type Q = { type: string; name: string; price: number; cur?: string; unit?: "FLAT" | "CPC" | "CPM"; desc: string };
async function logQuotes(titleId: string, qs: Q[], note: string) {
  const log = await createContactLog({ titleId, channel: "EMAIL", direction: "INBOUND", note, actorId: ACTOR });
  for (const q of qs) await logQuote({ draftProductType: q.type, draftProductName: q.name, draftProductDesc: q.desc, contactLogId: log.id, price: q.price, currency: q.cur ?? "SEK", priceUnit: q.unit ?? "FLAT", includedText: note.slice(0, 200), recordedById: ACTOR });
  return log;
}
function clearAwaiting(oi: string[] | undefined) {
  return (oi ?? []).filter((s) => !/mediekit|wetransfer|avventer.*aller|aller.*mediekit/i.test(s));
}

// 1) Allas — Native Digital (3 paket) + Aller-nätverkets video-produkter (lead-kontakt-titel).
async function allas() {
  const TAG = "Aller Allas native-mediekit 2026";
  const t = await findT("Allas");
  if (!t) { console.log("! Allas not found"); return; }
  await camilla(t.publisherId, t.id);
  if (await done(t.id, TAG)) { console.log("Allas: already"); return; }
  const NOTE = "INBOUND 2026-06-08: Camilla Hedström (Aller Media SE) native-mediekit. NATIVE DIGITAL Allas.se (netto, exkl moms): " +
    "Paket 1 = 10 000 unika sidv./1 vecka = 70 000 SEK (brutto 120 000); Paket 2 = 25 000/1-2 veckor = 125 000 (brutto 202 500); " +
    "Paket 3 = 50 000/3-4 veckor = 150 000 (brutto 340 000). Rättigheter 3 mån organiskt; native ligger kvar på sajt 1 år; bench lästid 2-2,5 min. " +
    "Produktion av Aller Media Creative Studio; spridning via 'Läs mer'-widget över Aller-nätverket. Målgrupp 84% kvinnor 46-65 år. " +
    "AGENCY/NÄTVERK: Native SOME Video 150 000 netto (brutto 240 000, 150k plays); Native Video 190 000 netto (brutto 275 000, 200k plays). " + TAG;
  await prisma.title.update({ where: { id: t.id }, data: {
    offersNativeContent: true,
    audienceNote: "Allas.se: kvinnor mitt i livet, 84% kvinnor 46-65 år, intresse hälsa/mode/hår. Bench lästid 2-2,5 min.",
    outstandingInfo: { set: clearAwaiting(t.outstandingInfo) },
    commercialExtra: { source: SRC, currency: "SEK", priceType: "netto_exkl_moms", nativeDigital: { paket1: { unikaSidv: 10000, veckor: 1, netto: 70000, brutto: 120000 }, paket2: { unikaSidv: 25000, veckor: "1-2", netto: 125000, brutto: 202500 }, paket3: { unikaSidv: 50000, veckor: "3-4", netto: 150000, brutto: 340000 } }, rights: "3 mån organiskt egna kanaler; ligger kvar 1 år", benchLastid: "2-2,5 min", network: { nativeSomeVideo: { netto: 150000, brutto: 240000, plays: 150000 }, nativeVideo: { netto: 190000, brutto: 275000, plays: 200000 } } },
  } });
  await logQuotes(t.id, [
    { type: "NATIVE_ARTICLE", name: "Native Digital Allas – Paket 1 (10k sidv, 1 vecka)", price: 70000, desc: "Garanti 10 000 unika sidvisningar, 1 vecka. Netto (brutto 120 000). Aller Media Creative Studio." },
    { type: "NATIVE_ARTICLE", name: "Native Digital Allas – Paket 2 (25k sidv, 1-2 veckor)", price: 125000, desc: "Garanti 25 000 unika sidvisningar, 1-2 veckor. Netto (brutto 202 500)." },
    { type: "NATIVE_ARTICLE", name: "Native Digital Allas – Paket 3 (50k sidv, 3-4 veckor)", price: 150000, desc: "Garanti 50 000 unika sidvisningar, 3-4 veckor. Netto (brutto 340 000)." },
    { type: "CONTENT_VIDEO", name: "Native SOME Video (Aller-nätverket, 1 episod)", price: 150000, desc: "Aller-nätverket. 1 episod 30s-2min, TikTok/Meta/sajt. KPI 150 000 plays. Netto (brutto 240 000)." },
    { type: "CONTENT_VIDEO", name: "Native Video (Aller-nätverket, 1 episod)", price: 190000, desc: "Aller-nätverket. 1 episod 30s-2min, publicistisk sajt + SoMe. KPI 200 000 plays. Netto (brutto 275 000)." },
  ], NOTE);
  console.log("Allas: ← native digital 3 paket + 2 video-produkter + Camilla");
}

// 2) Hänt i Veckan — Native Digital Hänt.se (hant.se), 3 paket + standard + "betala 1 få 2".
async function hant() {
  const TAG = "Aller Hänt native-mediekit 2026";
  const t = await findT("Hänt i Veckan");
  if (!t) { console.log("! Hänt i Veckan not found"); return; }
  await camilla(t.publisherId, t.id);
  if (await done(t.id, TAG)) { console.log("Hänt i Veckan: already"); return; }
  const NOTE = "INBOUND 2026-06-08: Camilla Hedström (Aller Media SE) native-mediekit. NATIVE DIGITAL Hänt.se (netto, exkl moms): " +
    "Standard = 10 000 sidv./vecka = 55 000 SEK; Paket 1 = 20 000 sidv./1 vecka = 95 000 (brutto 145 000); Paket 2 = 40 000/1-2 veckor = 143 000 (brutto 225 000); " +
    "Paket 3 = 80 000/3-4 veckor = 175 000 (brutto 385 000). Kampanj just nu: betala för 1 vecka – få 2. Rättigheter 3 mån; ligger kvar 1 år. " +
    "Målgrupp 67% kvinnor 25-54 år. Utöka räckvidd via print Hänt Extra (helsida 28 000 / uppslag 42 000, 171 000 rv) – se Hänt Extra. " + TAG;
  await prisma.title.update({ where: { id: t.id }, data: {
    offersNativeContent: true,
    audienceNote: "Hänt.se: Sveriges toppsida för nöje/underhållning, köpstark målgrupp, 67% kvinnor 25-54 år. Bench lästid 2-2,5 min.",
    outstandingInfo: { set: clearAwaiting(t.outstandingInfo) },
    commercialExtra: { source: SRC, currency: "SEK", priceType: "netto_exkl_moms", standardPerVecka: { sidv: 10000, netto: 55000 }, nativeDigital: { paket1: { sidv: 20000, veckor: 1, netto: 95000, brutto: 145000 }, paket2: { sidv: 40000, veckor: "1-2", netto: 143000, brutto: 225000 }, paket3: { sidv: 80000, veckor: "3-4", netto: 175000, brutto: 385000 } }, offer: "Just nu: betala för 1 vecka – få 2 veckor", rights: "3 mån organiskt; ligger kvar 1 år" },
  } });
  await logQuotes(t.id, [
    { type: "NATIVE_ARTICLE", name: "Native Digital Hänt.se – Standard (10k sidv/vecka)", price: 55000, desc: "Standard native 10 000 sidvisningar/vecka. Netto. Just nu: betala 1 vecka – få 2." },
    { type: "NATIVE_ARTICLE", name: "Native Digital Hänt.se – Paket 1 (20k sidv, 1 vecka)", price: 95000, desc: "Garanti 20 000 unika sidvisningar, 1 vecka. Netto (brutto 145 000)." },
    { type: "NATIVE_ARTICLE", name: "Native Digital Hänt.se – Paket 2 (40k sidv, 1-2 veckor)", price: 143000, desc: "Garanti 40 000 unika sidvisningar, 1-2 veckor. Netto (brutto 225 000)." },
    { type: "NATIVE_ARTICLE", name: "Native Digital Hänt.se – Paket 3 (80k sidv, 3-4 veckor)", price: 175000, desc: "Garanti 80 000 unika sidvisningar, 3-4 veckor. Netto (brutto 385 000)." },
  ], NOTE);
  console.log("Hänt i Veckan: ← native digital standard + 3 paket + Camilla");
}

// 3) Hänt Extra — print räckvidd add-on till Hänt native (helsida/uppslag, 171 000 rv).
async function hantExtra() {
  const TAG = "Aller Hänt Extra print-native 2026";
  const t = await findT("Hänt Extra");
  if (!t) { console.log("! Hänt Extra not found"); return; }
  await camilla(t.publisherId, t.id);
  if (await done(t.id, TAG)) { console.log("Hänt Extra: already"); return; }
  const NOTE = "INBOUND 2026-06-08: Camilla Hedström (Aller Media SE) native-mediekit. Hänt Extra (print) som räckviddsutökning till Hänt.se native: " +
    "Helsida = 28 000 SEK netto (brutto 100 000), 171 000 rv; Uppslag = 42 000 SEK netto (brutto 175 000), 171 000 rv. Netto, exkl moms. " + TAG;
  await prisma.title.update({ where: { id: t.id }, data: {
    offersNativeContent: true,
    audienceNote: "Hänt Extra (print): 171 000 räckvidd. Används som räckviddsutökning till Hänt.se native.",
    outstandingInfo: { set: clearAwaiting(t.outstandingInfo) },
    commercialExtra: { source: SRC, currency: "SEK", priceType: "netto_exkl_moms", rackvidd: 171000, helsida: { netto: 28000, brutto: 100000 }, uppslag: { netto: 42000, brutto: 175000 } },
  } });
  await logQuotes(t.id, [
    { type: "ADVERTORIAL", name: "Hänt Extra – Helsida (print native)", price: 28000, desc: "Print räckviddsutökning, 171 000 rv. Netto (brutto 100 000)." },
    { type: "ADVERTORIAL", name: "Hänt Extra – Uppslag (print native)", price: 42000, desc: "Print räckviddsutökning, 171 000 rv. Netto (brutto 175 000)." },
  ], NOTE);
  console.log("Hänt Extra: ← helsida 28k + uppslag 42k + Camilla");
}

// 4+5) Native Recept — ELLE Mat & Vin + Femina (delat produkt: Recept.se/ELLE Mat&Vin/Allas/Femina).
async function nativeRecept() {
  const TAG = "Aller Native Recept mediekit 2026";
  const NOTE = "INBOUND 2026-06-08: Camilla Hedström (Aller Media SE) native-mediekit. NATIVE RECEPT (delat över Recept.se/ELLE Mat & Vin/Allas/Femina, netto exkl moms): " +
    "Paket 1 = 15 000 sidv./1 vecka = 70 000 SEK (brutto 120 000); Paket 2 = 25 000/1-2 veckor = 90 000 (brutto 160 000); Paket 3 = 50 000/3-4 veckor = 110 000 (brutto 260 000). " +
    "Add-on: Aller skapar recept med produkt 25 000/recept (med bild); integration i matuniversum 15 000/mån eller 100 000/år. Rättigheter 3 mån. " + TAG;
  for (const name of ["ELLE Mat & Vin", "Femina"]) {
    const t = await findT(name);
    if (!t) { console.log(`! ${name} not found`); continue; }
    await camilla(t.publisherId, t.id);
    if (await done(t.id, TAG)) { console.log(`${name}: already`); continue; }
    await prisma.title.update({ where: { id: t.id }, data: {
      offersNativeContent: true,
      outstandingInfo: { set: clearAwaiting(t.outstandingInfo) },
      commercialExtra: { source: SRC, currency: "SEK", priceType: "netto_exkl_moms", nativeRecept: { paket1: { sidv: 15000, veckor: 1, netto: 70000, brutto: 120000 }, paket2: { sidv: 25000, veckor: "1-2", netto: 90000, brutto: 160000 }, paket3: { sidv: 50000, veckor: "3-4", netto: 110000, brutto: 260000 }, addons: { receptMedBild: 25000, integrationPerMan: 15000, integrationPerAr: 100000 } }, shared: ["Recept.se", "ELLE Mat & Vin", "Allas", "Femina"] },
    } });
    await logQuotes(t.id, [
      { type: "NATIVE_ARTICLE", name: "Native Recept – Paket 1 (15k sidv, 1 vecka)", price: 70000, desc: "Annonserat recept (Recept.se/ELLE Mat&Vin/Allas/Femina). 15 000 unika sidv, 1 vecka. Netto (brutto 120 000)." },
      { type: "NATIVE_ARTICLE", name: "Native Recept – Paket 2 (25k sidv, 1-2 veckor)", price: 90000, desc: "25 000 unika sidv, 1-2 veckor. Netto (brutto 160 000)." },
      { type: "NATIVE_ARTICLE", name: "Native Recept – Paket 3 (50k sidv, 3-4 veckor)", price: 110000, desc: "50 000 unika sidv, 3-4 veckor. Netto (brutto 260 000)." },
      { type: "OTHER", name: "Native Recept add-on – recept skapat av Aller (per recept)", price: 25000, desc: "Aller skapar recept med annonsörens produkt, med bild." },
      { type: "OTHER", name: "Native Recept add-on – integration i matuniversum (per år)", price: 100000, desc: "Recept förblir sökbart i Aller Medias matuniversum. Alt. 15 000/mån." },
    ], NOTE);
    console.log(`${name}: ← native recept 3 paket + add-ons + Camilla`);
  }
}

// 6) Övriga Aller SE-varumärken i native digital-utbudet (offers native, prisspann från mediekit; ingen per-titel-pris extraherad).
async function portfolioFlags() {
  const TAG = "Aller SE native-utbud (mediekit) 2026";
  const others = ["ELLE Sverige", "ELLE Decoration", "MåBra", "Residence", "Svensk Damtidning", "Motherhood"];
  for (const name of others) {
    const t = await findT(name);
    if (!t) { console.log(`! ${name} not found`); continue; }
    await camilla(t.publisherId, t.id);
    if (await done(t.id, TAG)) { console.log(`${name}: already`); continue; }
    await prisma.title.update({ where: { id: t.id }, data: {
      offersNativeContent: true,
      commercialExtra: { source: SRC, currency: "SEK", priceType: "netto_exkl_moms", nativeDigitalListpris: { spann: "55 000–90 000 SEK/vecka", note: "Native digital erbjuds; per-titel-pris ej specificerad i mediekit (listpris-spann över Aller SE-portföljen). Begär exakt offert.", garantiTypiskt: "20 000 unika sidv./vecka" } },
    } });
    await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: `INBOUND 2026-06-08: Camilla Hedström (Aller Media SE) native-mediekit bekräftar att ${name} ingår i Aller Medias native digital-utbud (Creative Studio, spridning via 'Läs mer'-widget). Listpris-spann 55 000–90 000 SEK/vecka beroende på titel; exakt offert per kampanj. ${TAG}`, actorId: ACTOR });
    console.log(`${name}: ← offersNative=true + native-utbud-note + Camilla`);
  }
}

async function main() {
  await allas();
  await hant();
  await hantExtra();
  await nativeRecept();
  await portfolioFlags();
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
