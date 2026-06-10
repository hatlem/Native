/** Capture data from two new SE replies (2026-06-08):
 *  A) Sofie Oskarsson / JO Förlaget – Allt om Jakt & Vapen: reader stats, sales
 *     contacts, and the full 2026 rate card (print + digital + film/sponsring +
 *     Jägarstudion videopodcast). Mediekit: Mediafakta_Allt om Jakt & Vapen_2026_A4.pdf.
 *  B) John Björs / AdSales Group – Socionomen + Akademikern: newsletter reach,
 *     native + print prices, production fees. Courtesy close, no reply needed.
 * Idempotent: each title's quotes are skipped if its INBOUND ratecard log already exists. */
import { prisma } from "@/lib/prisma";
import type { ProductType } from "@prisma/client";
import { createContactLog } from "@/lib/pricing/contact-log";
import { createSalesContact, attachContactToTitle } from "@/lib/pricing/contacts";
import { logQuote } from "@/lib/pricing/quotes";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";

async function findSE(name: string) {
  return prisma.title.findFirst({
    where: { countryCode: "SE", name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true, publisherId: true, outstandingInfo: true },
  });
}

// Skip if we've already logged a ratecard INBOUND for this title (idempotent re-runs).
async function alreadyIngested(titleId: string, tag: string) {
  const n = await prisma.contactLog.count({
    where: { titleId, direction: "INBOUND", note: { contains: tag } },
  });
  return n > 0;
}

type Q = { type: ProductType; name: string; price: number; unit: "FLAT" | "CPC" | "CPM"; desc: string };

// ---------------------------------------------------------------------------
// A) Allt om Jakt & Vapen (JO Förlaget)
// ---------------------------------------------------------------------------
const JAKT_TAG = "Allt om Jakt & Vapen – mediekit 2026";
const JAKT_NOTE =
  "INBOUND 2026-06-08: Sofie Oskarsson (JO Förlaget) svarte på prisforespørsel og spurte hvilken annonsør " +
  "det gjelder; sendte mediekit 2026 (Mediafakta_Allt om Jakt & Vapen_2026_A4.pdf). Vi svarte på sektornivå " +
  "(frilufts-/jaktsegmentet, samler inn estimater nå, konkret annonsør/periode etter sommeren). " +
  JAKT_TAG + ". Alle priser eks. moms, SEK. Annonsmateriale: annons@joforlaget.se.";

const JAKT_QUOTES: Q[] = [
  // Print (tidning)
  { type: "OTHER", name: "Uppslag (helsida-uppslag)", price: 31500, unit: "FLAT", desc: "Print, uppslag 394x264 mm. (Sid 2-3: 34 000.)" },
  { type: "OTHER", name: "Helsida", price: 19900, unit: "FLAT", desc: "Print helsida 180x264 mm (utfall 210x297)." },
  { type: "OTHER", name: "Omslag 4 (baksida)", price: 24000, unit: "FLAT", desc: "Print omslagssida 4. Omslag 2/3: 21 900." },
  { type: "OTHER", name: "Halvsida", price: 12600, unit: "FLAT", desc: "Print halvsida (liggande 180x127 / stående 85x264)." },
  { type: "OTHER", name: "Kvartssida", price: 7400, unit: "FLAT", desc: "Print kvartssida. Eftertext: kvarts 4500 / åttondel 2500 / sextondel 1500." },
  // Digital – banner på hemsidan (1 mån; 6/12 mån rabatterat)
  { type: "NATIVE_DISPLAY", name: "Banner Topp 728x90 (hemsida, 1 mån)", price: 5000, unit: "FLAT", desc: "Webb 13 000 besökare/mån. 6 mån 27 000 / 12 mån 48 600." },
  { type: "NATIVE_DISPLAY", name: "Banner Instick 696x180 (hemsida, 1 mån)", price: 2500, unit: "FLAT", desc: "6 mån 13 500 / 12 mån 24 300." },
  { type: "NATIVE_DISPLAY", name: "Banner Mellan 300x220 (hemsida, 1 mån)", price: 1500, unit: "FLAT", desc: "6 mån 8 100 / 12 mån 14 580." },
  { type: "NATIVE_DISPLAY", name: "Banner Liten 300x120 (hemsida, 1 mån)", price: 1000, unit: "FLAT", desc: "6 mån 5 400 / 12 mån 9 720." },
  { type: "NATIVE_DISPLAY", name: "Banner nyhetsbrev 564x140 (4 veckor)", price: 2500, unit: "FLAT", desc: "Nyhetsbrev 5 600 mottagare/vecka. 1 v 1000 / 6 mån 15 000 / 12 mån 25 000." },
  // Film-/seriesponsring (native-aktig content collaboration)
  { type: "CONTENT_VIDEO", name: "Filmsponsor – Jaktresan (per avsnitt)", price: 6500, unit: "FLAT", desc: "YouTube 16 000+ pren., ~100 000 tittare/mån. Jaktresan ~350k visn/år, 15 avsnitt. Hundskolan 6500, Vapenverkstan 4500." },
  { type: "CONTENT_VIDEO", name: "Livesändning mästerskap – Älghunds-SM huvudsponsor", price: 40000, unit: "FLAT", desc: "Älghunds-SM 2026 (26 sep), ~49k tittare 2025. Prissponsor 25 000. Vildsvins-SM huvud 25 000 / pris 15 000." },
  // Jägarstudion videopodcast 2026 (redaktionellt sponsringsformat)
  { type: "CONTENT_VIDEO", name: "Jägarstudion – Logosponsor (helårsbokning/avsnitt)", price: 3000, unit: "FLAT", desc: "Videopodcast varannan vecka, YouTube+Spotify. Enstaka avsnitt 5 500. 20% rabatt vid helårsbokning av komplement." },
  { type: "CONTENT_VIDEO", name: "Jägarstudion – Produktpresentation (per avsnitt)", price: 7000, unit: "FLAT", desc: "Visar upp och pratar om produkt. Produktplacering 4500 helår/6000 enstaka. Reklamfilm (max 20s) 4500/6000." },
  { type: "CONTENT_VIDEO", name: "Jägarstudion – Studiogäst (per avsnitt)", price: 15000, unit: "FLAT", desc: "Sittplats i studion, med i samtal, visar upp produkt/tjänst." },
];

const JAKT_COMMERCIAL = {
  source: "Sofie Oskarsson / JO Förlaget, mediekit 2026 (e-post 2026-06-08)",
  currency: "SEK",
  pricesExclVat: true,
  print: { utgavorPerAr: 10, lasarePerNummer: "50 000–60 000", upplaga: 16000, varavPrenumeranter: 8000, varavButik: 8000, helsida: 19900, uppslag: 31500 },
  webb: { besokarePerManad: 13000 },
  nyhetsbrev: { mottagarePerVecka: 5600, frekvens: "1×/vecka" },
  youtube: { prenumeranter: "16 000+", tittarePerManad: "~100 000" },
  serier: { jaktresan: "~350 000 visn/år (15 avsnitt)", vapenverkstan: "~200 000 visn/år (10)", hundskolan: "~250 000 visn/år (10)" },
  jagarstudion: "Videopodcast varannan vecka fr.o.m. våren 2026, YouTube + Spotify (19 publiceringar 2026)",
  materialTill: "annons@joforlaget.se",
};

const JAKT_AUDIENCE =
  "81% män. 15% storstad / 85% landsbygd. Flest läsare i ålderskategorin 20–64 år, flest heltidsarbetande och " +
  "flest i inkomstgruppen 65 000 kr/mån eller mer (jämfört med övrig jaktpress). Källa: Orvesto.";

async function jakt() {
  const t = await findSE("Allt om Jakt & Vapen");
  if (!t) { console.log("! Allt om Jakt & Vapen: not found in catalog (SE)"); return; }
  if (await alreadyIngested(t.id, JAKT_TAG)) { console.log("Jakt: already ingested, skipping"); return; }

  await prisma.title.update({
    where: { id: t.id },
    data: {
      offersNativeContent: true,
      monthlyReach: 60000,                 // print läsare/nummer (high end)
      digitalReach: 13000,                 // webb besökare/mån
      facebookFollowers: 12000,
      instagramFollowers: 12700,
      audienceNote: JAKT_AUDIENCE,
      commercialExtra: JAKT_COMMERCIAL,
      contentPolicy:
        "Jägarstudion/sponsring: redaktionellt oberoende kan inte köpas, inga förhandslöften om omdömen, " +
        "tydlig märkning enligt marknadsföringslagen, säkerhet/jaktetik överordnat kommersiella intressen.",
      ...(t.outstandingInfo?.length
        ? { outstandingInfo: { set: t.outstandingInfo.filter((x) => !/prisliste|mediakit|mediekit/i.test(x)) } }
        : {}),
    },
  });

  const log = await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: JAKT_NOTE, actorId: ACTOR });
  for (const q of JAKT_QUOTES) {
    await logQuote({
      draftProductType: q.type, draftProductName: q.name, draftProductDesc: q.desc,
      contactLogId: log.id, price: q.price, currency: "SEK", priceUnit: q.unit,
      includedText: "Mediekit 2026, eks. moms (Sofie Oskarsson / JO Förlaget).", recordedById: ACTOR,
    });
  }

  // Sales contacts
  const contacts = [
    { name: "Sofie Oskarsson", email: "sofie@joforlaget.se", phone: "072-236 75 66", primary: true,
      role: "Annonsförsäljning, JO Förlaget (Allt om Jakt & Vapen / Jägarstudion)" },
    { name: "Katharina Olsson", email: "katharina@joforlaget.se", phone: "070-217 92 21", primary: false,
      role: "Annonsförsäljning, JO Förlaget (Jägarstudion)" },
  ];
  for (const c of contacts) {
    const exists = await prisma.salesContact.findFirst({ where: { publisherId: t.publisherId, email: c.email } });
    if (exists) { console.log(`Jakt contact ${c.name}: already exists`); continue; }
    const sc = await createSalesContact({
      publisherId: t.publisherId, name: c.name, email: c.email, phone: c.phone, role: c.role,
      notes: "Mediekit 2026 mottatt 06-08. Materiale: annons@joforlaget.se.", actorId: ACTOR,
    });
    await attachContactToTitle({ salesContactId: sc.id, titleId: t.id, isPrimary: c.primary, actorId: ACTOR });
    console.log(`Jakt: SalesContact ${c.name} opprettet + koblet`);
  }
  console.log(`Jakt: ${t.name} ← ${JAKT_QUOTES.length} quotes + reader stats + audience + commercialExtra`);
}

// ---------------------------------------------------------------------------
// B) AdSales Group – Socionomen + Akademikern (John Björs)
// ---------------------------------------------------------------------------
const ADSALES_TAG = "AdSales Group – native/print 2026";
const ADSALES_NOTE =
  "INBOUND 2026-06-08: John Björs (AdSales Group) – høflig avslutning på dialog, ga lesertall + priser. " +
  "AdSales Group: ~4 milj läsare brutto / 30 varumärken. Native-produksjon: 3 000 (eget material) / " +
  "15 000 (redaktionen producerar). " + ADSALES_TAG + ". Priser eks. moms, SEK. Ingen svar nødvendig (courtesy close).";

const ADSALES_TITLES: { name: string; newsletter: string; quotes: Q[] }[] = [
  {
    name: "Socionomen",
    newsletter: "Nyhetsbrev ~40 000 prenumeranter, ~50% öppningsfrekvens.",
    quotes: [
      { type: "NATIVE_ARTICLE", name: "Native digital (Socionomen)", price: 25000, unit: "FLAT", desc: "Native digital. Nyhetsbrev ~40 000 pren., ~50% open. Produktion: 3 000 eget material / 15 000 redaktionen producerar." },
      { type: "ADVERTORIAL", name: "Native print (Socionomen)", price: 19900, unit: "FLAT", desc: "Native/advertorial print. Produktion: 3 000 eget material / 15 000 redaktionen producerar." },
    ],
  },
  {
    name: "Tidningen Akademikern",
    newsletter: "Nyhetsbrev ~80 000 prenumeranter, ~50% öppningsfrekvens.",
    quotes: [
      { type: "NATIVE_ARTICLE", name: "Native digital (Akademikern)", price: 25000, unit: "FLAT", desc: "Native digital. Nyhetsbrev ~80 000 pren., ~50% open. Produktion: 3 000 eget material / 15 000 redaktionen producerar." },
      { type: "ADVERTORIAL", name: "Native print (Akademikern)", price: 34000, unit: "FLAT", desc: "Native/advertorial print. Produktion: 3 000 eget material / 15 000 redaktionen producerar." },
    ],
  },
];

async function adsales() {
  for (const a of ADSALES_TITLES) {
    const t = await findSE(a.name);
    if (!t) { console.log(`! AdSales: ${a.name} not found (SE)`); continue; }
    if (await alreadyIngested(t.id, ADSALES_TAG)) { console.log(`AdSales: ${a.name} already ingested, skipping`); continue; }

    await prisma.title.update({
      where: { id: t.id },
      data: {
        offersNativeContent: true,
        audienceNote: a.newsletter,
        commercialExtra: {
          source: "John Björs / AdSales Group, e-post 2026-06-08",
          currency: "SEK",
          pricesExclVat: true,
          newsletter: a.newsletter,
          productionFees: { egetMaterial: 3000, redaktionenProducerar: 15000 },
          group: "AdSales Group – ~4 milj läsare brutto / 30 varumärken",
        },
      },
    });
    const log = await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: ADSALES_NOTE, actorId: ACTOR });
    for (const q of a.quotes) {
      await logQuote({
        draftProductType: q.type, draftProductName: q.name, draftProductDesc: q.desc,
        contactLogId: log.id, price: q.price, currency: "SEK", priceUnit: q.unit,
        includedText: "Eks. moms. Produktion 3 000 (eget) / 15 000 (redaktionen) (John Björs / AdSales Group).", recordedById: ACTOR,
      });
    }

    // No SalesContact for John Björs: his email wasn't verified from the thread and
    // createSalesContact requires one. His name/role/data live in the INBOUND note + commercialExtra.
    console.log(`AdSales: ${t.name} ← ${a.quotes.length} quotes + newsletter reach + production fees`);
  }
}

async function main() {
  await jakt();
  await adsales();
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
