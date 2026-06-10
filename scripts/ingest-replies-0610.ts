/** 2026-06-10 reply wave from the SE/DK/NO outreach. Native prices from bodies +
 * Akersposten proposal PDF. Dup-guarded by INBOUND note tag; creates missing titles. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { createSalesContact, attachContactToTitle } from "@/lib/pricing/contacts";
import { logQuote } from "@/lib/pricing/quotes";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const MARKET: Record<string, string> = { NO: "cmpmdiq3o00000hu08iw009x9", SE: "cmpmdiq3r00010hu0mbiqfmp0", DK: "cmpmdiq3s00020hu0fggjt0f4" };

async function findT(name: string, cc: string) {
  return prisma.title.findFirst({ where: { name: { equals: name, mode: "insensitive" }, countryCode: cc }, select: { id: true, name: true, publisherId: true, outstandingInfo: true } });
}
async function findBySlug(slug: string) {
  return prisma.title.findFirst({ where: { slug }, select: { id: true, name: true, publisherId: true, outstandingInfo: true } });
}
async function ensurePublisher(name: string, cc: string) {
  let p = await prisma.publisher.findFirst({ where: { name } });
  if (!p) p = await prisma.publisher.create({ data: { name, countryCode: cc, marketId: MARKET[cc] } });
  return p;
}
async function ensureTitle(o: { name: string; cc: string; slug: string; publisherName: string; websiteUrl?: string; category?: string; offersNative?: boolean; aliases?: string[]; keywords?: string[]; description?: string; digitalReach?: number }) {
  const ex = await prisma.title.findFirst({ where: { slug: o.slug }, select: { id: true, name: true, publisherId: true, outstandingInfo: true } });
  if (ex) return ex;
  const pub = await ensurePublisher(o.publisherName, o.cc);
  const c = await prisma.title.create({ data: { name: o.name, slug: o.slug, publisherId: pub.id, marketId: MARKET[o.cc], countryCode: o.cc, category: o.category, websiteUrl: o.websiteUrl, offersNativeContent: o.offersNative ?? true, aliases: o.aliases ?? [], keywords: o.keywords ?? [], description: o.description, digitalReach: o.digitalReach, active: true, lastVerifiedAt: new Date() }, select: { id: true, name: true, publisherId: true, outstandingInfo: true } });
  console.log(`  + created ${o.name} [${o.cc}] ${c.id}`);
  return c;
}
async function done(titleId: string, tag: string) {
  return (await prisma.contactLog.count({ where: { titleId, direction: "INBOUND", note: { contains: tag } } })) > 0;
}
async function ensureContact(publisherId: string, titleId: string, c: { name: string; email: string; phone?: string; role?: string; notes?: string; primary?: boolean }) {
  let sc = await prisma.salesContact.findFirst({ where: { publisherId, email: c.email.toLowerCase() } });
  if (!sc) sc = await createSalesContact({ publisherId, name: c.name, email: c.email, phone: c.phone, role: c.role, notes: c.notes, actorId: ACTOR });
  await attachContactToTitle({ salesContactId: sc.id, titleId, isPrimary: c.primary ?? false, actorId: ACTOR });
}
type Q = { type: string; name: string; price: number; unit?: "FLAT" | "CPC" | "CPM"; cur?: string; desc: string };
async function logQuotes(titleId: string, qs: Q[], note: string, cur = "SEK") {
  const log = await createContactLog({ titleId, channel: "EMAIL", direction: "INBOUND", note, actorId: ACTOR });
  for (const q of qs) await logQuote({ draftProductType: q.type, draftProductName: q.name, draftProductDesc: q.desc, contactLogId: log.id, price: q.price, currency: q.cur ?? cur, priceUnit: q.unit ?? "FLAT", includedText: note.slice(0, 200), recordedById: ACTOR });
  return log;
}
async function setExtra(titleId: string, extra: Record<string, unknown>, offersNative = true) {
  await prisma.title.update({ where: { id: titleId }, data: { offersNativeContent: offersNative, commercialExtra: extra, lastVerifiedAt: new Date() } });
}
async function addOutstanding(titleId: string, current: string[] | undefined, item: string) {
  await prisma.title.update({ where: { id: titleId }, data: { outstandingInfo: { set: [...new Set([...(current ?? []), item])] } } });
}

// 1) Dagens Medicin (SE) — Christine Stenbäck (Bonnier News). Grundpaket 150k / helsida 86.8k / web 80k.
async function dagensMedicinSE() {
  const TAG = "Dagens Medicin SE native 2026 (Christine Stenbäck)";
  const t = await findBySlug("dagens-medicin-se"); if (!t) return console.log("! Dagens Medicin SE missing");
  if (await done(t.id, TAG)) return console.log("Dagens Medicin SE: already");
  const NOTE = "INBOUND 2026-06-10: Christine Stenbäck (annonsförsäljning Dagens Medicin & NetdoktorPro, Bonnier News, christine.stenback@dagensmedicin.se, 070-566 24 47). " +
    "Native skrivs av contentredaktör (underlag från annonsör, ev. egen text justeras till redaktionell tonalitet). Grundpaket (helsida tidningen Dagens Medicin valfri utgåva + 2 veckor dagensmedicin.se): 150 000 SEK. Enbart helsida tidningen: 86 800. Enbart dagensmedicin.se 2 v: 80 000. Frågade efter målgrupp/syfte. " + TAG;
  await setExtra(t.id, { source: "Christine Stenbäck / Bonnier News, e-post 2026-06-10", currency: "SEK", grundpaket: 150000, helsidaTidning: 86800, webb2Veckor: 80000, produktion: "contentredaktör Bonnier", relatedTitle: "NetdoktorPro (samma kontakt)" });
  await logQuotes(t.id, [
    { type: "PACKAGE", name: "Native grundpaket (print helsida + 2 v webb)", price: 150000, desc: "Helsida Dagens Medicin + 2 veckor dagensmedicin.se." },
    { type: "ADVERTORIAL", name: "Native enbart helsida (tidning)", price: 86800, desc: "Helsida i tidningen Dagens Medicin." },
    { type: "NATIVE_ARTICLE", name: "Native enbart webb (2 veckor)", price: 80000, desc: "2 veckor på dagensmedicin.se." },
  ], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "Christine Stenbäck", email: "christine.stenback@dagensmedicin.se", phone: "070-566 24 47", role: "Annonsförsäljning Dagens Medicin & NetdoktorPro (Bonnier News)", notes: "Native 150k/86.8k/80k. 06-10.", primary: true });
  console.log("Dagens Medicin SE: ← native 150k/86.8k/80k + Christine");
}

// 2) Fysioterapi (SE) — Gabrielle Hagman (Mediakraft). Helsida 30 100 (-15% = 25 585).
async function fysioterapi() {
  const TAG = "Fysioterapi native 2026 (Gabrielle Hagman)";
  const t = await findBySlug("fysioterapi-se"); if (!t) return console.log("! Fysioterapi missing");
  if (await done(t.id, TAG)) return console.log("Fysioterapi: already");
  const NOTE = "INBOUND 2026-06-10: Gabrielle Hagman (Mediakraft, gabrielle.hagman@mediakraft.se, +46 736 27 79 84). Native helsida 30 100 SEK; 15% rabatt vid bokning av native helsida → 25 585. Kunden måste godkännas innan bokning. Mediekit Fysioterapi2026.pdf bifogad. " + TAG;
  await setExtra(t.id, { source: "Gabrielle Hagman / Mediakraft, e-post 2026-06-10", currency: "SEK", nativeHelsida: 30100, nativeHelsidaRabatt15: 25585, kravGodkannande: true }, true);
  await logQuotes(t.id, [{ type: "ADVERTORIAL", name: "Native helsida", price: 30100, desc: "15% rabatt → 25 585. Kund godkänns innan bokning." }], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "Gabrielle Hagman", email: "gabrielle.hagman@mediakraft.se", phone: "+46 736 27 79 84", role: "Mediakraft (Fysioterapi/Hem & Hyra)", notes: "Native helsida 30 100 (-15%). 06-10.", primary: true });
  console.log("Fysioterapi: ← native helsida 30 100 + Gabrielle");
}

// 3) Hem & Hyra (SE) — Gabrielle Hagman. Helsida 30 000 (-15% = 25 500). ~576 800 läsare.
async function hemHyra() {
  const TAG = "Hem & Hyra native 2026 (Gabrielle Hagman)";
  const t = await findBySlug("hem-hyra-se"); if (!t) return console.log("! Hem & Hyra missing");
  if (await done(t.id, TAG)) return console.log("Hem & Hyra: already");
  const NOTE = "INBOUND 2026-06-10: Gabrielle Hagman (Mediakraft, gabrielle.hagman@mediakraft.se). Native helsida 30 000 SEK; 15% rabatt → 25 500. Hyresgästföreningens medlemstidning, ~576 800 läsare (40+, storstad). Mediekit Hem&Hyra2026.pdf bifogad. " + TAG;
  await setExtra(t.id, { source: "Gabrielle Hagman / Mediakraft, e-post 2026-06-10", currency: "SEK", nativeHelsida: 30000, nativeHelsidaRabatt15: 25500, lasare: 576800, malgrupp: "40+, storstad" }, true);
  await logQuotes(t.id, [{ type: "ADVERTORIAL", name: "Native helsida", price: 30000, desc: "15% rabatt → 25 500. ~576 800 läsare." }], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "Gabrielle Hagman", email: "gabrielle.hagman@mediakraft.se", phone: "+46 736 27 79 84", role: "Mediakraft (Fysioterapi/Hem & Hyra)", notes: "Native helsida 30 000 (-15%). 06-10.", primary: true });
  console.log("Hem & Hyra: ← native helsida 30 000 + Gabrielle");
}

// 4+5) Akersposten + Ullern Avis (NO) — Henriette/Amedia. Native 1/2/3 saker 12k/14k/16k netto (50% rabatt), 80k visn/mnd.
async function akersposten() {
  const TAG = "Akersposten native tilbud 2026 (Henriette/Amedia)";
  const t = await ensureTitle({ name: "Akersposten", cc: "NO", slug: "akersposten-no", publisherName: "Amedia (NO)", websiteUrl: "https://www.akersposten.no", category: "Lokalavis/Oslo", offersNative: true, aliases: ["Akersposten Oslo vest"], keywords: ["lokalavis", "Oslo vest", "nærområde"], description: "Lokalavis for Oslo vest (Amedia). Native Midtbanner Cross Device. Annonsesalg via Amedia Annonse Oslo." });
  if (await done(t.id, TAG)) { console.log("Akersposten: already"); }
  else {
    const NOTE = "INBOUND 2026-06-10: Henriette Kjærnes Halvåg (Konst. Daglig leder/Salgsdir., Amedia Annonse Oslo, henriette.kjernes@amedia.no, 48 18 14 18), tilbud (AOL_Akerposten_Admirate, 50% rabatt). " +
      "Native Midtbanner Cross Device, 80 000 visninger/måned (~10% SOV): 1 sak brutto 24 000 → netto 12 000; 2 saker 28 000 → 14 000; 3 saker 32 000 → 16 000 (alle 50% rabatt). Fritt valg video/stillbilder. Trykk kan justeres. Gjelder også Ullern Avis. " + TAG;
    await setExtra(t.id, { source: "Henriette Kjærnes Halvåg / Amedia Annonse Oslo, tilbud 2026-06-10", currency: "NOK", produkt: "Native Midtbanner Cross Device", visningerPerMnd: 80000, sovPct: 10, rabattPct: 50, native1Brutto: 24000, native1Netto: 12000, native2Brutto: 28000, native2Netto: 14000, native3Brutto: 32000, native3Netto: 16000, relatedTitle: "Ullern Avis (samme tilbud)" }, true);
    await logQuotes(t.id, [
      { type: "NATIVE_ARTICLE", name: "Native 1 sak (80k visn/mnd)", price: 12000, cur: "NOK", desc: "Netto etter 50% rabatt (brutto 24 000). Midtbanner Cross Device." },
      { type: "NATIVE_ARTICLE", name: "Native 2 saker (80k visn/mnd)", price: 14000, cur: "NOK", desc: "Netto etter 50% rabatt (brutto 28 000)." },
      { type: "NATIVE_ARTICLE", name: "Native 3 saker (80k visn/mnd)", price: 16000, cur: "NOK", desc: "Netto etter 50% rabatt (brutto 32 000)." },
    ], NOTE, "NOK");
    await ensureContact(t.publisherId, t.id, { name: "Henriette Kjærnes Halvåg", email: "henriette.kjernes@amedia.no", phone: "48 18 14 18", role: "Konst. Daglig leder / Salgsdirektør, Amedia Annonse Oslo", notes: "Native 1/2/3 saker 12k/14k/16k netto (50% rab). 06-10.", primary: true });
    console.log("Akersposten: ← native 12k/14k/16k + Henriette");
  }
  // Ullern Avis — same offer
  const u = await ensureTitle({ name: "Ullern Avis", cc: "NO", slug: "ullern-avis-no", publisherName: "Amedia (NO)", websiteUrl: "https://www.ullern.no", category: "Lokalavis/Oslo", offersNative: true, keywords: ["lokalavis", "Oslo vest", "Ullern"], description: "Lokalavis for Ullern/Oslo vest (Amedia). Native via Amedia Annonse Oslo (samme tilbud som Akersposten)." });
  if (!(await done(u.id, TAG))) {
    const NOTE = "INBOUND 2026-06-10: Henriette Kjærnes Halvåg (Amedia Annonse Oslo) — Ullern Avis inngår i samme tilbud som Akersposten: Native Midtbanner Cross Device, 80k visn/mnd, 50% rabatt → 1 sak 12 000 / 2 saker 14 000 / 3 saker 16 000 NOK netto. " + TAG;
    await setExtra(u.id, { source: "Henriette / Amedia Annonse Oslo, tilbud 2026-06-10", currency: "NOK", native1Netto: 12000, native2Netto: 14000, native3Netto: 16000, rabattPct: 50, anm: "Samme tilbud som Akersposten" }, true);
    await logQuotes(u.id, [{ type: "NATIVE_ARTICLE", name: "Native 1 sak (80k visn/mnd)", price: 12000, cur: "NOK", desc: "Netto etter 50% rabatt. Samme tilbud som Akersposten." }], NOTE, "NOK");
    await ensureContact(u.publisherId, u.id, { name: "Henriette Kjærnes Halvåg", email: "henriette.kjernes@amedia.no", phone: "48 18 14 18", role: "Amedia Annonse Oslo", notes: "Samme tilbud som Akersposten. 06-10.", primary: true });
    console.log("Ullern Avis: ← native 12k/14k/16k + Henriette");
  }
}

// 6) Aller DK portfolio — Casper König-Fonberg. Sponsoreret artikel-grid (DKK).
async function allerDK() {
  const TAG = "Aller DK native-grid 2026 (Casper König-Fonberg)";
  const CONTACT = { name: "Casper König-Fonberg", email: "casper.konig-fonberg@aller.com", phone: "+45 50761728", role: "Agency & Client Manager, Aller Media Business (DK)", notes: "Native sponsoreret artikel-grid. Ferie 14/8-7/9. 06-10.", primary: true };
  const RABAT = "Rabat pr. native (ny produktion): 3 stk 20%, 5 stk 25%, 6-10 stk 30%, 10+ 35%. Versioneringspris ved tilpasning til andre medier (afhænger af omfang).";
  // each entry: [titleSlug-or-null, createName, websiteUrl, price, deling]
  const rows: { slug?: string; create?: { name: string; site: string }; price: number; deling: number }[] = [
    { slug: "se-og-h-r-dk", price: 27500, deling: 7500 },
    { slug: "billed-bladet-dk", price: 27500, deling: 7500 },
    { slug: "familie-journal-dk", price: 25000, deling: 5000 },
    { slug: "ude-og-hjemme-dk", price: 25000, deling: 5000 },
    { slug: "spis-bedre-dk", price: 27500, deling: 7500 },
    { create: { name: "Femina", site: "https://www.femina.dk" }, price: 30000, deling: 10000 },
    { create: { name: "Heartbeats", site: "https://heartbeats.dk" }, price: 27500, deling: 7500 },
    { create: { name: "Isabellas", site: "https://www.isabellas.dk" }, price: 25000, deling: 5000 },
    { create: { name: "Vi Elsker Serier", site: "https://vielskerserier.dk" }, price: 25000, deling: 5000 },
  ];
  for (const r of rows) {
    let t = r.slug ? await findBySlug(r.slug) : null;
    if (!t && r.create) {
      const slug = r.create.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-dk";
      t = await ensureTitle({ name: r.create.name, cc: "DK", slug, publisherName: "Aller Media (DK)", websiteUrl: r.create.site, category: "Livsstil/Ugeblad", offersNative: true, keywords: ["livsstil", "ugeblad", "Aller"], description: `Aller Media DK-brand. Native sponsoreret artikel ${r.price} DKK (deling på medie ${r.deling}).` });
    }
    if (!t) { console.log(`! Aller DK title missing: ${r.slug ?? r.create?.name}`); continue; }
    if (await done(t.id, TAG)) { console.log(`Aller DK ${t.name}: already`); continue; }
    const NOTE = `INBOUND 2026-06-10: Casper König-Fonberg (Aller Media Business DK, casper.konig-fonberg@aller.com, +45 50761728), brandpræsentation + native-grid. Sponsoreret artikel ${r.price} DKK (deling på medie ${r.deling} hvis samme native aktiveres på flere sites). ${RABAT} ${TAG}`;
    await setExtra(t.id, { source: "Casper König-Fonberg / Aller Media DK, e-post 2026-06-10", currency: "DKK", sponsoreretArtikel: r.price, delingPaaMedie: r.deling, rabat: { "3stk": 20, "5stk": 25, "6-10stk": 30, "10+": 35 }, versionering: "afhænger af omfang", ferie: "14/8-7/9" }, true);
    await logQuotes(t.id, [
      { type: "NATIVE_ARTICLE", name: "Sponsoreret artikel", price: r.price, cur: "DKK", desc: `Deling på medie ${r.deling}. Volumenrabat 20-35%.` },
    ], NOTE, "DKK");
    await ensureContact(t.publisherId, t.id, CONTACT);
    console.log(`Aller DK ${t.name}: ← sponsoreret ${r.price} + Casper`);
  }
}

// 7) Gartner Tidende (DK) — Karin Svensson. Native helside 10 000 / opslag 13 700.
async function gartnerTidende() {
  const TAG = "Gartner Tidende native 2026 (Karin Svensson)";
  const t = await findBySlug("gartner-tidende-dk"); if (!t) return console.log("! Gartner Tidende missing");
  if (await done(t.id, TAG)) return console.log("Gartner Tidende: already");
  const NOTE = "INBOUND 2026-06-10: Karin Svensson (Hortiadvice A/S, Gartner Tidende, ksv@hortiadvice.dk, +45 2137 9806), medieplan 2026. Ingen særskilt native-prisliste; almindelige annoncestørrelser, forbeholder ret til at skrive 'Annonce' øverst. Native-tilbud: helside (185x260, højreside) 10 000 DKK; opslag (2 helsider) 13 700 DKK. " + TAG;
  await setExtra(t.id, { source: "Karin Svensson / Hortiadvice, medieplan 2026-06-10", currency: "DKK", nativeHelside: 10000, nativeOpslag: 13700, anm: "Mærkes 'Annonce'; ingen særskilt native-prisliste" }, true);
  await logQuotes(t.id, [
    { type: "ADVERTORIAL", name: "Native helside (185x260, højreside)", price: 10000, cur: "DKK", desc: "Mærkes 'Annonce'." },
    { type: "ADVERTORIAL", name: "Native opslag (2 helsider)", price: 13700, cur: "DKK", desc: "2 helsider overfor hinanden." },
  ], NOTE, "DKK");
  await ensureContact(t.publisherId, t.id, { name: "Karin Svensson", email: "ksv@hortiadvice.dk", phone: "+45 2137 9806", role: "Hortiadvice A/S (Gartner Tidende)", notes: "Native helside 10 000 / opslag 13 700. 06-10.", primary: true });
  console.log("Gartner Tidende: ← native 10 000/13 700 + Karin");
}

// 8) ScandAsia (SE) — Finn Balslev (Scandinavian Publishing). Content article $400 / link $100 USD.
async function scandAsia() {
  const TAG = "ScandAsia native 2026 (Finn Balslev)";
  const t = await findBySlug("scandasia-se"); if (!t) return console.log("! ScandAsia missing");
  if (await done(t.id, TAG)) return console.log("ScandAsia: already");
  const NOTE = "INBOUND 2026-06-10: Finn Balslev (scandmedia.com, finn@scandmedia.com). ScandAsia.com: content marketing artikel 400 USD; indsættelse af link i eksisterende artikel 100 USD. Ingen gratis test. " + TAG;
  await setExtra(t.id, { source: "Finn Balslev / Scandinavian Publishing, e-post 2026-06-10", currency: "USD", contentArticle: 400, linkInsertion: 100, noFreeTest: true }, true);
  await logQuotes(t.id, [
    { type: "NATIVE_ARTICLE", name: "Content marketing artikel", price: 400, cur: "USD", desc: "Artikel på ScandAsia.com." },
    { type: "OTHER", name: "Link i eksisterende artikel", price: 100, cur: "USD", desc: "Link-indsættelse." },
  ], NOTE, "USD");
  await ensureContact(t.publisherId, t.id, { name: "Finn Balslev", email: "finn@scandmedia.com", role: "Scandinavian Publishing Co (ScandAsia)", notes: "Content artikel 400 USD / link 100 USD. 06-10.", primary: true });
  console.log("ScandAsia: ← content 400 USD / link 100 USD + Finn");
}

// 9) Dagens Næringsliv (NO) — Anette, wants phone. Routing.
async function dagensNaringsliv() {
  const TAG = "Dagens Næringsliv routing 2026 (Anette Grasmo Johansen)";
  const t = await findBySlug("dagens-n-ringsliv-no"); if (!t) return console.log("! DN missing");
  if (await done(t.id, TAG)) return console.log("DN: already");
  await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-10: Anette Grasmo Johansen (Magasinansvarlig salg D2, Dagens Næringsliv, anette.johansen@dngroup.com, +47 951 91 346) – takket for forespørsel, ønsker telefonnummer for en rask prat om annonsering i DN/D2-magasinet. Ingen pris ennå. " + TAG, actorId: ACTOR });
  await ensureContact(t.publisherId, t.id, { name: "Anette Grasmo Johansen", email: "anette.johansen@dngroup.com", phone: "+47 951 91 346", role: "Magasinansvarlig salg D2, Dagens Næringsliv", notes: "Ønsker telefonprat. Avventer pris. 06-10.", primary: true });
  await addOutstanding(t.id, t.outstandingInfo, "Anette (DN/D2) ønsker telefonprat – avventer pris");
  console.log("Dagens Næringsliv: ← routing + Anette");
}

// 10) Jysk Fynske Medier (Fyens Stiftstidende m.fl.) — Lars Maiborg asks native vs link-building. Routing.
async function jyskFynske() {
  const TAG = "Jysk Fynske routing 2026 (Lars Maiborg)";
  const t = await findBySlug("fyens-stiftstidende-dk"); if (!t) return console.log("! Fyens Stiftstidende missing");
  if (await done(t.id, TAG)) return console.log("Jysk Fynske: already");
  await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-10: Lars Maiborg (Senior Digital KAM Specialist, Jysk Fynske Medier, lam@jfm.dk, +45 2020 5480) – spørger om det er Native artikler eller Link Building artikler vi forespørger på, før han sender prisliste. Dækker Fyens Stiftstidende, JydskeVestkysten, Århus Stiftstidende m.fl. Vi svarer: native artikler. Avventer prisliste. " + TAG, actorId: ACTOR });
  await ensureContact(t.publisherId, t.id, { name: "Lars Maiborg", email: "lam@jfm.dk", phone: "+45 2020 5480", role: "Senior Digital KAM Specialist, Jysk Fynske Medier", notes: "Spørger native vs link-building. Avventer prisliste. 06-10.", primary: true });
  await addOutstanding(t.id, t.outstandingInfo, "Lars Maiborg (JFM) avventer svar native vs link-building → så prisliste");
  console.log("Jysk Fynske: ← routing + Lars");
}

// 11) Forskning.no (NO) — Kristin, meeting times. Routing.
async function forskningNo() {
  const TAG = "Forskning.no møte 2026 (Kristin Jobraaten)";
  const t = await findBySlug("forskning-no-no"); if (!t) return console.log("! Forskning.no missing");
  if (await done(t.id, TAG)) return console.log("Forskning.no: already");
  await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-10: Kristin Jobraaten (Forretningsutvikler salg/arrangement, Forskning.no, kristin.j@forskning.no, +47 918 06 038) – foreslår møtetidspunkt (man/tir etter 12, tor før 12) for 10-min Teams-gjennomgang av native-muligheter. Ingen pris ennå. Avventer at vi avtaler tid. " + TAG, actorId: ACTOR });
  await ensureContact(t.publisherId, t.id, { name: "Kristin Jobraaten", email: "kristin.j@forskning.no", phone: "+47 918 06 038", role: "Forretningsutvikler salg/arrangement, Forskning.no", notes: "Foreslår Teams-møte (man/tir e.12, tor f.12). 06-10.", primary: true });
  await addOutstanding(t.id, t.outstandingInfo, "Forskning.no Teams-møte å avtale (Kristin) – man/tir e.12, tor f.12");
  console.log("Forskning.no: ← møte-routing + Kristin");
}

async function main() {
  await dagensMedicinSE();
  await fysioterapi();
  await hemHyra();
  await akersposten();
  await allerDK();
  await gartnerTidende();
  await scandAsia();
  await dagensNaringsliv();
  await jyskFynske();
  await forskningNo();
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
