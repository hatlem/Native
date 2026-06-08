/** Capture ALL remaining data from the 06-08 (and follow-up) reply mails into the
 * system: Bjarte Lerø reader/subscriber data, Polaris-wide native CPMs across all
 * Polaris papers, May Britt Røste as SalesContact, and Ruijan Kaiku OOO redirect.
 * Idempotent where it matters (Polaris quotes skip titles already carrying them). */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { createSalesContact, attachContactToTitle } from "@/lib/pricing/contacts";
import { logQuote } from "@/lib/pricing/quotes";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";

async function findNO(name: string) {
  return prisma.title.findFirst({ where: { countryCode: "NO", name: { equals: name, mode: "insensitive" } }, select: { id: true, name: true, outstandingInfo: true } });
}

// ---- A) Bjarte Lerø / Medier og Ledelse reader+subscriber data (e-post 06-05) ----
const BJARTE = [
  { name: "Dagens Perspektiv", pageViews: "40 000–50 000/mnd", subs: 13000, sends: "10 utsendelser/2 uker (daglig)", casino: false },
  { name: "Samtiden",          pageViews: "~70 000/mnd",        subs: 7000,  sends: "6 utsendelser/2 uker (daglig)",  casino: false },
  { name: "Reiseliv1",         pageViews: "~11 000/mnd",        subs: 6600,  sends: "8 utsendelser/2 uker (4×/uke)",  casino: true },
  { name: "Friluftsliv",       pageViews: "~5 000/mnd",         subs: 3000,  sends: "2 utsendelser/2 uker (1×/uke)", casino: true },
];

async function bjarte() {
  for (const b of BJARTE) {
    const t = await findNO(b.name);
    if (!t) { console.log(`! Bjarte: ${b.name} not found`); continue; }
    const data: any = {
      commercialExtra: {
        source: "Bjarte Lerø / Medier og Ledelse, e-post 2026-06-05",
        monthlyPageViews: b.pageViews,
        newsletterSubscribers: b.subs,
        newsletterSendsTilbud2: b.sends,
        liggetid: "minimum 2 år på sidene for annonsørinnhold",
        publisering: "annonsørinnhold publiseres på partnerinnhold.no, vises på titlenes side for annonsørinnhold + evt. forside + nyhetsbrev",
      },
    };
    if (b.casino) data.contentPolicy = "Ikke annonsørinnhold om casino/gambling.";
    // prices now exist → drop the stale 'prisliste annonsørinnhold' outstanding item
    if (t.outstandingInfo?.length) {
      data.outstandingInfo = { set: t.outstandingInfo.filter((x) => !/prisliste annons/i.test(x)) };
    }
    await prisma.title.update({ where: { id: t.id }, data });
    console.log(`Bjarte: ${t.name} ← pageViews ${b.pageViews}, nyhetsbrev ${b.subs} ab., utsendelser, liggetid${b.casino ? ", casino-policy" : ""}`);
  }
}

// ---- B) Polaris Media native/video CPM across ALL Polaris papers (samme pris) ----
const POLARIS_QUOTES = [
  { name: "Native Premium", price: 345, desc: "Native Premium (anbefales for høyeste CTR). annonseweb.adressa.no/products/2780." },
  { name: "Native Standard", price: 260, desc: "Native Standard. annonseweb.adressa.no/products/2780." },
  { name: "Video – Reels", price: 400, desc: "Video-native, Reels. annonseweb.adressa.no/products/3030." },
  { name: "Video – Prerolls", price: 500, desc: "Video-native, Prerolls. annonseweb.adressa.no/products/2780." },
];
const POLARIS_NOTE =
  "Polaris Media native-/video-CPM (NOK), samme pris i alle Polaris-aviser. Kilde: May Britt Røste " +
  "(Salgssjef, Adresseavisen Byråtjenester / Polaris Media Salg), e-post 2026-06-08, annonseweb.adressa.no. " +
  "Native Premium 345 / Native Standard 260 / Reels 400 / Prerolls 500.";

async function polaris() {
  const titles = await prisma.title.findMany({
    where: { countryCode: "NO", active: true, adSales: { contains: "Polaris", mode: "insensitive" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  let added = 0, skipped = 0;
  for (const t of titles) {
    const existing = await prisma.priceQuote.count({
      where: { contactLog: { titleId: t.id }, draftProductName: { contains: "Polaris Media" } },
    });
    if (existing > 0) { skipped++; continue; }
    await prisma.title.update({ where: { id: t.id }, data: { offersNativeContent: true } });
    const log = await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: POLARIS_NOTE, actorId: ACTOR });
    for (const q of POLARIS_QUOTES) {
      await logQuote({
        draftProductType: "NATIVE_ARTICLE", draftProductName: `${q.name} (Polaris Media – ${t.name})`,
        draftProductDesc: q.desc, contactLogId: log.id, price: q.price, currency: "NOK", priceUnit: "CPM",
        includedText: "Polaris Media standard – samme pris i alle avisene (May Britt Røste / annonseweb.adressa.no).", recordedById: ACTOR,
      });
    }
    added++;
    console.log(`Polaris: ${t.name} ← 4 CPM-quotes + offersNative`);
  }
  console.log(`Polaris propagation: ${added} titles enriched, ${skipped} already had it (anchors).`);
}

// ---- C) May Britt Røste as SalesContact (Adresseavisen publisher) ----
async function mayBritt() {
  const adr = await prisma.title.findFirst({ where: { countryCode: "NO", name: { equals: "Adresseavisen", mode: "insensitive" } }, select: { id: true, publisherId: true } });
  if (!adr) { console.log("! Adresseavisen not found for SalesContact"); return; }
  const existing = await prisma.salesContact.findFirst({ where: { publisherId: adr.publisherId, email: "may.britt.roste@adresseavisen.no" } });
  if (existing) { console.log("May Britt: SalesContact already exists"); return; }
  const c = await createSalesContact({
    publisherId: adr.publisherId, name: "May Britt Røste", email: "may.britt.roste@adresseavisen.no",
    phone: "913 22 380", role: "Salgssjef Team Strategisk (Adresseavisen Byråtjenester / Polaris Media Salg)",
    notes: "Håndterer Polaris Media-salg på tvers av avisene. Ga native-/video-CPM 06-08. Kan spisse tilbud ved oppgitt kunde/bransje.",
    actorId: ACTOR,
  });
  await attachContactToTitle({ salesContactId: c.id, titleId: adr.id, isPrimary: false, actorId: ACTOR });
  console.log("May Britt Røste: SalesContact opprettet + koblet til Adresseavisen");
}

// ---- D) Ruijan Kaiku OOO redirect (Yngve Reginiussen away) ----
async function ruijan() {
  const t = await findNO("Ruijan Kaiku");
  if (!t) { console.log("! Ruijan Kaiku not found"); return; }
  await createContactLog({
    titleId: t.id, channel: "EMAIL", direction: "INBOUND",
    note: "INBOUND 2026-06-08: Fraværsmelding fra Yngve Reginiussen (Markedssjef, yngve@altaposten.no) – borte noen uker. " +
      "Bedre kontakt: marked@altaposten.no (generelt) / annonse@altaposten.no (annonsebestilling) / tlf 784 56 702. Ruijan Kaiku utgis via Altaposten.",
    actorId: ACTOR,
  });
  const oi = new Set([...(t.outstandingInfo ?? []), "Avventer prissvar – kontakt i ferie; bruk marked@altaposten.no"]);
  await prisma.title.update({ where: { id: t.id }, data: { outstandingInfo: { set: [...oi] } } });
  console.log("Ruijan Kaiku: OOO-redirect logget + outstandingInfo");
}

async function main() {
  await bjarte();
  await polaris();
  await mayBritt();
  await ruijan();
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
