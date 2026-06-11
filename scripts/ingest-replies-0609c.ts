/** 2026-06-09 reply wave — ATTACHMENT-derived prices (mediekits/rate cards/xlsx).
 * Läkartidningen, Världen Idag, Bonnier idenyt, Media-Partners (Bio/Syge/Pharma/Farmaci/Lægeliv),
 * Story House Egmont (Hus&Hem/Icakuriren/Hemmets Journal/Min Häst + Café/King print), Proffs.
 * Dup-guarded by INBOUND note tag. Creates missing titles/publishers. */
import { prisma } from "@/lib/prisma";
import type { ProductType, Prisma } from "@prisma/client";
import { createContactLog } from "@/lib/pricing/contact-log";
import { createSalesContact, attachContactToTitle } from "@/lib/pricing/contacts";
import { logQuote } from "@/lib/pricing/quotes";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const MARKET: Record<string, string> = { SE: "cmpmdiq3r00010hu0mbiqfmp0", DK: "cmpmdiq3s00020hu0fggjt0f4" };

async function findT(name: string, cc: string) {
  return prisma.title.findFirst({ where: { name: { equals: name, mode: "insensitive" }, countryCode: cc }, select: { id: true, name: true, publisherId: true, outstandingInfo: true } });
}
async function findBySlug(slug: string) {
  return prisma.title.findFirst({ where: { slug }, select: { id: true, name: true, publisherId: true, outstandingInfo: true } });
}
async function ensurePublisher(name: string, cc: string) {
  let p = await prisma.publisher.findFirst({ where: { name } });
  if (!p) p = await prisma.publisher.create({ data: { name, countryCode: cc, marketId: MARKET[cc]! } });
  return p;
}
async function ensureTitle(o: { name: string; cc: string; slug: string; publisherName: string; websiteUrl?: string; category: string; offersNative?: boolean; aliases?: string[]; keywords?: string[]; description?: string; digitalReach?: number }) {
  const ex = await prisma.title.findFirst({ where: { slug: o.slug }, select: { id: true, name: true, publisherId: true, outstandingInfo: true } });
  if (ex) return ex;
  const pub = await ensurePublisher(o.publisherName, o.cc);
  const c = await prisma.title.create({ data: { name: o.name, slug: o.slug, publisherId: pub.id, marketId: MARKET[o.cc]!, countryCode: o.cc, category: o.category, websiteUrl: o.websiteUrl, offersNativeContent: o.offersNative ?? true, aliases: o.aliases ?? [], keywords: o.keywords ?? [], description: o.description, digitalReach: o.digitalReach, active: true, lastVerifiedAt: new Date() }, select: { id: true, name: true, publisherId: true, outstandingInfo: true } });
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
type Q = { type: ProductType; name: string; price: number; unit?: "FLAT" | "CPC" | "CPM"; cur?: string; desc: string };
async function logQuotes(titleId: string, qs: Q[], note: string, cur = "SEK") {
  const log = await createContactLog({ titleId, channel: "EMAIL", direction: "INBOUND", note, actorId: ACTOR });
  for (const q of qs) await logQuote({ draftProductType: q.type, draftProductName: q.name, draftProductDesc: q.desc, contactLogId: log.id, price: q.price, currency: q.cur ?? cur, priceUnit: q.unit ?? "FLAT", includedText: note.slice(0, 200), recordedById: ACTOR });
  return log;
}
async function setExtra(titleId: string, extra: Record<string, unknown>, offersNative = true) {
  await prisma.title.update({ where: { id: titleId }, data: { offersNativeContent: offersNative, commercialExtra: extra as Prisma.InputJsonValue, lastVerifiedAt: new Date() } });
}

// 1) Läkartidningen (SE) — David Andreasson. Native 78 000 / webb 55 000 / print 73 000.
async function lakartidningen() {
  const TAG = "Läkartidningen native pris 2026 (David Andreasson)";
  const t = await findT("Läkartidningen", "SE"); if (!t) return console.log("! Läkartidningen missing");
  if (await done(t.id, TAG)) return console.log("Läkartidningen: already");
  const NOTE = "INBOUND 2026-06-09: David Andreasson (Key Account Manager, Läkartidningen/Informa AB, david@informa.se, 0706 33 08 12), mediekit (LT_nativeannonsering_2025.pdf). " +
    "Native (Informas Content Studio projektleder produktion, granskas av ansvarig utgivare). Komplett: 78 000 SEK (projektledning+produktion intervju/text/layout, publicering lakartidningen.se, nyhetsbrev 1 vecka, helsida i tidningen, äganderätt). " +
    "Endast webb: 55 000. Endast print: 73 000. Exkl moms. " + TAG;
  await setExtra(t.id, { source: "David Andreasson / Informa, mediekit 2026-06-09", currency: "SEK", priceType: "exkl_moms", nativeKomplett: 78000, nativeWebb: 55000, nativePrint: 73000, includes: ["projektledning+produktion", "lakartidningen.se", "nyhetsbrev 1 vecka", "helsida i tidningen", "äganderätt"], contentStudio: "Informas Content Studio" });
  await logQuotes(t.id, [
    { type: "NATIVE_ARTICLE", name: "Native komplett (webb+nyhetsbrev+print+ägande)", price: 78000, desc: "Produktion+lakartidningen.se+nyhetsbrev 1v+helsida print+äganderätt. Exkl moms." },
    { type: "NATIVE_ARTICLE", name: "Native endast webb", price: 55000, desc: "Endast lakartidningen.se. Exkl moms." },
    { type: "ADVERTORIAL", name: "Native endast print", price: 73000, desc: "Endast helsida i tidningen. Exkl moms." },
  ], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "David Andreasson", email: "david@informa.se", phone: "0706 33 08 12", role: "Key Account Manager, Läkartidningen/Informa AB", notes: "Native 78 000/55 000/73 000. 06-09.", primary: true });
  console.log("Läkartidningen: ← native 78 000/55 000/73 000 + David");
}

// 2) Världen Idag (SE) — Johanna Köllerfors. Helsida 25/32.5k, mittuppslag 45/55k, digital 20k, +5k skrivning.
async function varldenIdag() {
  const TAG = "Världen Idag native pris 2026 (Johanna Köllerfors)";
  const t = await findT("Världen Idag", "SE"); if (!t) return console.log("! Världen Idag missing");
  if (await done(t.id, TAG)) return console.log("Världen Idag: already");
  const NOTE = "INBOUND 2026-06-09: Johanna Köllerfors (Marknadskoordinator, Världen Idag, annons@varldenidag.se, 076-869 10 54), PDF NativeAdv_Web. " +
    "Dagstidning Native (helsida med redaktionell text): 25 000 / 32 500. Mittuppslag (2 helsidor): 45 000 / 55 000. " +
    "Digital Native (webbannons med redaktionell text + videoklipp på förstasidan; förstasidespuff+undersida): 20 000. Artikelskrivning som tillägg 5 000. Alla exkl moms. " + TAG;
  await setExtra(t.id, { source: "Johanna Köllerfors / Världen Idag, PDF 2026-06-09", currency: "SEK", priceType: "exkl_moms", dagstidningNativeHelsida: [25000, 32500], mittuppslag: [45000, 55000], digitalNativeWebb: 20000, artikelskrivningTillagg: 5000 });
  await logQuotes(t.id, [
    { type: "ADVERTORIAL", name: "Dagstidning Native (helsida)", price: 25000, desc: "Helsida med redaktionell text. 25 000–32 500. Exkl moms." },
    { type: "ADVERTORIAL", name: "Dagstidning Native (mittuppslag)", price: 45000, desc: "2 helsidor. 45 000–55 000. Exkl moms." },
    { type: "NATIVE_ARTICLE", name: "Digital Native (webbannons)", price: 20000, desc: "Förstasidespuff+undersida, redaktionell text+video. +5 000 för artikelskrivning. Exkl moms." },
  ], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "Johanna Köllerfors", email: "annons@varldenidag.se", phone: "076-869 10 54", role: "Marknadskoordinator, Världen Idag", notes: "Native helsida 25/32.5k, digital 20k. 06-09.", primary: true });
  console.log("Världen Idag: ← native 25/32.5k + digital 20k + Johanna");
}

// 3) Bonnier idenyt (DK) — Michael Nielsen. Native pr. læsninger: idenyt 30/35/45k; øvrige brands 35k(5k). +FB 1k.
async function bonnierIdenyt() {
  const TAG = "idenyt native pris 2026 (Michael Nielsen)";
  const t = await ensureTitle({ name: "idenyt", cc: "DK", slug: "idenyt-dk", publisherName: "Bonnier Publications DK (DK)", websiteUrl: "https://www.idenyt.dk", category: "Bolig/Have/Gør-det-selv", offersNative: true, aliases: ["I Denyt", "idényt"], keywords: ["bolig", "have", "gør-det-selv", "husejere"], description: "Dansk bolig-/have-/gør-det-selv-magasin (Bonnier Publications). 868 000 danskere læser min. ét idenyt-magasin/år. Native pr. læsninger.", digitalReach: 868000 });
  if (await done(t.id, TAG)) return console.log("idenyt: already");
  const NOTE = "INBOUND 2026-06-09: Michael Nielsen (Salgsansvarlig idenyt/Gør Det Selv, Bonnier Publications, michael.nielsen@bonnier.dk, +45 25 70 40 36), præsentation. " +
    "Native artikel på idenyt.dk (pris pr. læsninger, inkl. produktion): 5 000 læsninger 30 000 / 8 000 læsninger 35 000 / 15 000 læsninger 45 000 DKK. " +
    "Øvrige brands (Gør Det Selv, Digital Foto, I Form, Illustreret Videnskab m.fl.): 5 000 læsninger 35 000 DKK. Facebook-boost i målgruppen +1 000 DKK. Artiklen skrives i magasinets stil. 868 000 læser idenyt/år. " + TAG;
  await setExtra(t.id, { source: "Michael Nielsen / Bonnier Publications, præsentation 2026-06-09", currency: "DKK", model: "pris pr. læsninger inkl. produktion", idenyt: { "5000": 30000, "8000": 35000, "15000": 45000 }, ovrigeBrands5000: 35000, facebookBoost: 1000, reachLaesereAar: 868000 });
  await logQuotes(t.id, [
    { type: "NATIVE_ARTICLE", name: "Native idenyt.dk (5 000 læsninger)", price: 30000, cur: "DKK", desc: "Inkl. produktion. Pris pr. læsninger." },
    { type: "NATIVE_ARTICLE", name: "Native idenyt.dk (8 000 læsninger)", price: 35000, cur: "DKK", desc: "Inkl. produktion." },
    { type: "NATIVE_ARTICLE", name: "Native idenyt.dk (15 000 læsninger)", price: 45000, cur: "DKK", desc: "Inkl. produktion." },
  ], NOTE, "DKK");
  await ensureContact(t.publisherId, t.id, { name: "Michael Nielsen", email: "michael.nielsen@bonnier.dk", phone: "+45 25 70 40 36", role: "Salgsansvarlig, Bonnier Publications (idenyt/Gør Det Selv)", notes: "Native idenyt 30/35/45k, øvrige brands 35k. 06-09.", primary: true });
  // representative quote on Gør Det Selv (øvrige brands)
  const gds = await findBySlug("g-r-det-selv-dk");
  if (gds && !(await done(gds.id, TAG))) {
    await logQuotes(gds.id, [{ type: "NATIVE_ARTICLE", name: "Native (5 000 læsninger, øvrige brands)", price: 35000, cur: "DKK", desc: "Bonnier-brand native pr. læsninger, inkl. produktion. +FB-boost 1 000." }], "INBOUND 2026-06-09: Michael Nielsen (Bonnier Publications). Native øvrige brands (Gør Det Selv m.fl.) 5 000 læsninger 35 000 DKK + FB-boost 1 000. Se idenyt for fuld prisliste. " + TAG, "DKK");
    await ensureContact(gds.publisherId, gds.id, { name: "Michael Nielsen", email: "michael.nielsen@bonnier.dk", phone: "+45 25 70 40 36", role: "Salgsansvarlig, Bonnier Publications", notes: "Native øvrige brands 35k/5000. 06-09." });
    console.log("Gør Det Selv: ← native øvrige-brand 35 000 + Michael");
  }
  console.log("idenyt: ← native 30/35/45k + Michael");
}

// 4) Media-Partners (DK) — Hanne. Tekstannonce/advertorial-priser fra mediekits.
async function mediaPartners() {
  const TAG = "Media-Partners tekstannonce 2026 (Hanne Kjærgaard)";
  const CONTACT = { name: "Hanne Kjærgaard", email: "hanne@media-partners.dk", phone: "+45 2967 1436", role: "Owner & Partner, Media-Partners (annoncesalg)", notes: "Tekstannonce/advertorial-priser. 06-09.", primary: true };
  // Bioanalytikeren (exists)
  const bio = await findT("Bioanalytikeren", "DK");
  if (bio && !(await done(bio.id, TAG))) {
    const NOTE = "INBOUND 2026-06-09: Hanne Kjærgaard (Media-Partners, hanne@media-partners.dk, +45 2967 1436), mediekit. Tekstannonce: 1/1 19 500, 1/1 til kant 16 800, 1/2 12 100, bagside 20 500 DKK. Online-annonce 4 450. Henvisning 3 200. Advertorial/bilag/indstik: indhent pris. Alle ekskl moms. " + TAG;
    await setExtra(bio.id, { source: "Media-Partners (Hanne Kjærgaard), mediekit 2026-06-09", currency: "DKK", tekstannonce: { "1_1": 19500, "1_1_til_kant": 16800, "1_2": 12100, bagside: 20500 }, onlineAnnonce: 4450, advertorial: "indhent pris", priceType: "ekskl_moms" }, true);
    await logQuotes(bio.id, [
      { type: "ADVERTORIAL", name: "Tekstannonce 1/1 side", price: 19500, cur: "DKK", desc: "Helside tekstannonce. Ekskl moms." },
      { type: "NATIVE_DISPLAY", name: "Online-annonce", price: 4450, cur: "DKK", desc: "Pr. annonce, max 2 hverdage. Ekskl moms." },
    ], NOTE, "DKK");
    await ensureContact(bio.publisherId, bio.id, CONTACT);
    console.log("Bioanalytikeren: ← tekstannonce 19 500 + Hanne");
  }
  // Sygeplejersken (exists)
  const syg = await findT("Sygeplejersken", "DK");
  if (syg && !(await done(syg.id, TAG))) {
    const NOTE = "INBOUND 2026-06-09: Hanne Kjærgaard (Media-Partners), mediekit. Tekstannonce: 1/1 til kant 34 600, 1/2 17 300, 1/4 10 300, bagside 38 500, omslagsside 2/3 36 900, opslag 51 900 DKK. Advertorial/bilag/indstik: indhent pris. Alle ekskl moms. " + TAG;
    await setExtra(syg.id, { source: "Media-Partners (Hanne Kjærgaard), mediekit 2026-06-09", currency: "DKK", tekstannonce: { "1_1_til_kant": 34600, "1_2": 17300, "1_4": 10300, bagside: 38500, omslag: 36900, opslag: 51900 }, advertorial: "indhent pris", priceType: "ekskl_moms" }, true);
    await logQuotes(syg.id, [
      { type: "ADVERTORIAL", name: "Tekstannonce 1/1 til kant", price: 34600, cur: "DKK", desc: "Helside. Ekskl moms." },
      { type: "ADVERTORIAL", name: "Tekstannonce opslag", price: 51900, cur: "DKK", desc: "Opslag (2x1/1). Ekskl moms." },
    ], NOTE, "DKK");
    await ensureContact(syg.publisherId, syg.id, CONTACT);
    console.log("Sygeplejersken: ← tekstannonce 34 600/opslag 51 900 + Hanne");
  }
  // Pharma (create)
  const pharma = await ensureTitle({ name: "Pharma", cc: "DK", slug: "pharma-dk", publisherName: "Media-Partners (DK)", category: "Sundhed/Farma", offersNative: true, keywords: ["pharma", "apotek", "sundhed"], description: "Dansk fagmedie for farma/apotekssektoren. Annoncesalg via Media-Partners. Banner 5 500/udgivelse, modtagere 6 700.", digitalReach: 6700 });
  if (!(await done(pharma.id, TAG))) {
    const NOTE = "INBOUND 2026-06-09: Hanne Kjærgaard (Media-Partners), mediekit (til inspiration). Banner 5 500 DKK pr. udgivelse (modtagere 6 700). Jobpakker fra 4 200. Ekskl moms. " + TAG;
    await setExtra(pharma.id, { source: "Media-Partners (Hanne Kjærgaard), mediekit 2026-06-09", currency: "DKK", banner: 5500, modtagere: 6700, priceType: "ekskl_moms" }, true);
    await logQuotes(pharma.id, [{ type: "NATIVE_DISPLAY", name: "Banner (pr. udgivelse)", price: 5500, cur: "DKK", desc: "Modtagere 6 700. Ekskl moms." }], NOTE, "DKK");
    await ensureContact(pharma.publisherId, pharma.id, CONTACT);
    console.log("Pharma: ← banner 5 500 + Hanne");
  }
  // Farmaci (create)
  const farmaci = await ensureTitle({ name: "Farmaci", cc: "DK", slug: "farmaci-dk", publisherName: "Media-Partners (DK)", category: "Sundhed/Farma", offersNative: true, keywords: ["farmaci", "apotek", "sundhed"], description: "Dansk fagmagasin for farmaci/apotekssektoren. Distribueret oplag ca. 1 100. Annoncesalg via Media-Partners.", digitalReach: 1100 });
  if (!(await done(farmaci.id, TAG))) {
    const NOTE = "INBOUND 2026-06-09: Hanne Kjærgaard (Media-Partners), mediekit (til inspiration). Tekstannonce: 1/1 særplacering 23 000, 1/1 til kant 17 500, 1/2 9 900, 1/3 7 400, 1/4 5 900, bagside 23 000 DKK. Advertorial: indhent pris. Oplag ca 1 100. Ekskl moms. " + TAG;
    await setExtra(farmaci.id, { source: "Media-Partners (Hanne Kjærgaard), mediekit 2026-06-09", currency: "DKK", tekstannonce: { "1_1_saerplacering": 23000, "1_1_til_kant": 17500, "1_2": 9900, "1_3": 7400, "1_4": 5900, bagside: 23000 }, advertorial: "indhent pris", oplag: 1100, priceType: "ekskl_moms" }, true);
    await logQuotes(farmaci.id, [{ type: "ADVERTORIAL", name: "Tekstannonce 1/1 til kant", price: 17500, cur: "DKK", desc: "Helside (særplacering 23 000). Ekskl moms." }], NOTE, "DKK");
    await ensureContact(farmaci.publisherId, farmaci.id, CONTACT);
    console.log("Farmaci: ← tekstannonce 17 500 + Hanne");
  }
  // Magasinet Lægeliv (create)
  const laege = await ensureTitle({ name: "Magasinet Lægeliv", cc: "DK", slug: "magasinet-laegeliv-dk", publisherName: "Media-Partners (DK)", category: "Sundhed/Læger", offersNative: true, aliases: ["Lægeliv"], keywords: ["læger", "sundhed", "livsstil"], description: "Dansk magasin for læger (livsstil/faglighed). Annoncesalg via Media-Partners." });
  if (!(await done(laege.id, TAG))) {
    const NOTE = "INBOUND 2026-06-09: Hanne Kjærgaard (Media-Partners), mediekit (til inspiration). Tekstannonce: opslag (2x1/1) 39 800, 1/1 til kant 19 800, 1/2 12 800, 1/3 9 800, 1/4 7 800, bagside/side 2 særplacering 24 000 DKK. Ekskl moms. " + TAG;
    await setExtra(laege.id, { source: "Media-Partners (Hanne Kjærgaard), mediekit 2026-06-09", currency: "DKK", tekstannonce: { opslag: 39800, "1_1_til_kant": 19800, "1_2": 12800, "1_3": 9800, "1_4": 7800, bagside_saerplacering: 24000 }, priceType: "ekskl_moms" }, true);
    await logQuotes(laege.id, [{ type: "ADVERTORIAL", name: "Tekstannonce 1/1 til kant", price: 19800, cur: "DKK", desc: "Helside (opslag 39 800). Ekskl moms." }], NOTE, "DKK");
    await ensureContact(laege.publisherId, laege.id, CONTACT);
    console.log("Magasinet Lægeliv: ← tekstannonce 19 800 + Hanne");
  }
}

// 5) Story House Egmont (SE) — Thomas Sedin. Native 30–40k portföljbrett + print helsida + nyhetsbrev.
async function egmont() {
  const TAG = "Story House Egmont native+print 2026 (Thomas Sedin)";
  const CONTACT = { name: "Thomas Sedin", email: "thomas.sedin@egmont.se", phone: "+46 70-545 15 29", role: "Nordic Key Account Manager, Story House Egmont", notes: "Native 30–40k portfölj; print helsida per titel. 06-09.", primary: true };
  const NATIVE_DESC = "Native 30 000–40 000 SEK/artikel (varierar per sajt): produktion utifrån brief, publicering på vald sajt, aktiv på startsida 2 v, kvar 6 mån, listas i nyhetsbrev, FB-push, garanterad läsning. Tillägg: advertorial helsida/uppslag i magasin, Instagram, FB-boost, flera sajter.";
  // per-title print helsida brutto + nyhetsbrev mottagare from xlsx
  const titles: { find: { name: string } | { slug: string }; printHelsida: number; nyhetsbrevMottagare?: number; createAs?: { name: string; slug: string }; native?: boolean }[] = [
    { find: { name: "Hus & Hem" }, printHelsida: 58900, nyhetsbrevMottagare: 15000 },
    { find: { slug: "min-ha-st-se" }, printHelsida: 20000 },
    { createAs: { name: "Icakuriren", slug: "icakuriren-se" }, find: { slug: "icakuriren-se" }, printHelsida: 71500, nyhetsbrevMottagare: 33000 },
    { createAs: { name: "Hemmets Journal", slug: "hemmets-journal-se" }, find: { slug: "hemmets-journal-se" }, printHelsida: 48400, nyhetsbrevMottagare: 45000 },
  ];
  for (const cfg of titles) {
    let t = "name" in cfg.find ? await findT(cfg.find.name, "SE") : await findBySlug(cfg.find.slug);
    if (!t && cfg.createAs) t = await ensureTitle({ name: cfg.createAs.name, cc: "SE", slug: cfg.createAs.slug, publisherName: "Egmont (SE)", category: "Magasin/Livsstil", offersNative: true, keywords: ["livsstil", "magasin"], description: `Story House Egmont-titel. Native 30–40k + print helsida ${cfg.printHelsida}.` });
    if (!t) { console.log(`! Egmont title not found: ${JSON.stringify(cfg.find)}`); continue; }
    if (await done(t.id, TAG)) { console.log(`Egmont ${t.name}: already`); continue; }
    const NOTE = `INBOUND 2026-06-09: Thomas Sedin (Nordic KAM, Story House Egmont, thomas.sedin@egmont.se, +46 70-545 15 29), prisfil (xlsx) + mediafakta. ${NATIVE_DESC} Print helsida brutto ${cfg.printHelsida} SEK.` + (cfg.nyhetsbrevMottagare ? ` Stand alone nyhetsbrev: 50 öre/mottagare (35 öre vid 3+ bokningar), ${cfg.nyhetsbrevMottagare} mottagare.` : "") + ` Display CPM via hemtrevligt.se m.fl. ` + TAG;
    await setExtra(t.id, { source: "Thomas Sedin / Story House Egmont, prisfil 2026-06-09", currency: "SEK", nativeMin: 30000, nativeMax: 40000, printHelsidaBrutto: cfg.printHelsida, nyhetsbrevPrMottagareOre: 50, nyhetsbrevRabatt3plus: 35, nyhetsbrevMottagare: cfg.nyhetsbrevMottagare, nativeIncludes: ["produktion", "startsida 2v", "kvar 6 mån", "nyhetsbrev", "FB-push", "garanterad läsning"] }, true);
    const qs: Q[] = [
      { type: "NATIVE_ARTICLE", name: "Native artikel (per sajt)", price: 30000, desc: "30 000–40 000 beroende på sajt. " + NATIVE_DESC.slice(0, 120) },
      { type: "ADVERTORIAL", name: "Print helsida (brutto)", price: cfg.printHelsida, desc: "Helsida i magasinet, bruttopris." },
    ];
    await logQuotes(t.id, qs, NOTE);
    await ensureContact(t.publisherId, t.id, CONTACT);
    console.log(`Egmont ${t.name}: ← native 30–40k + print ${cfg.printHelsida} + Thomas`);
  }
  // Café + King: add Egmont as secondary contact + print helsida 57 500 (native via SB Media already)
  for (const slug of ["cafe-se", "king-magazine-se"]) {
    const t = await findBySlug(slug); if (!t) continue;
    if (await done(t.id, TAG)) continue;
    await logQuotes(t.id, [{ type: "ADVERTORIAL", name: "Print helsida (Egmont, brutto)", price: 57500, desc: "Helsida i magasinet via Story House Egmont (Thomas Sedin). Bruttopris." }],
      `INBOUND 2026-06-09: Thomas Sedin (Story House Egmont) — ${t.name} ingår i Egmonts portfölj. Print helsida 57 500 SEK brutto. Native 30–40k via Egmont-portföljen (digital native även via SB Media/Erik Bergström). Dubbel säljkanal noteras. ` + TAG);
    await ensureContact(t.publisherId, t.id, { name: "Thomas Sedin", email: "thomas.sedin@egmont.se", phone: "+46 70-545 15 29", role: "Nordic KAM, Story House Egmont (print/portfölj)", notes: "Print helsida 57 500; portfölj-native 30–40k. Även SB Media (Erik) för digital native. 06-09." });
    console.log(`Egmont ${t.name}: ← print 57 500 (sekundär kanal) + Thomas`);
  }
}

// 6) Proffs (SE) — Pekka Tikkanen (Vägpress). Print 1/1 22 800; ingen prissatt native (webbfokus).
async function proffs() {
  const TAG = "Proffs annonspris 2026 (Pekka Tikkanen)";
  const t = await ensureTitle({ name: "Proffs", cc: "SE", slug: "proffs-se", publisherName: "Vägpress AB (SE)", websiteUrl: "https://www.tidningenproffs.se", category: "Fackpress/Transport", offersNative: true, aliases: ["Tidningen Proffs"], keywords: ["lastbil", "yrkesförare", "åkeri", "transport"], description: "Svensk fristående tidning för yrkesförare/åkeriägare (Vägpress AB, est. 1990). Branschens mest besökta hemsida tidningenproffs.se. Print + webb." });
  if (await done(t.id, TAG)) return console.log("Proffs: already");
  const NOTE = "INBOUND 2026-06-09: Pekka Tikkanen (Annonschef, Vägpress AB, annons@vagpress.se, +46 70-873 39 55), annonsprislista + webbstatistik. " +
    "Print: 1/1-sida 22 800, 1/2 13 400, 1/4 8 600, sida 1 21 500, 3:e/4:e omslag 35 300/36 800, A4 +20%. Specialprofilerat 'kryss' (korsord) 25 000. " +
    "tidningenproffs.se uppges vara branschens mest besökta. Native ej separat prissatt – 'Ring!' för upplägg. " + TAG;
  await setExtra(t.id, { source: "Pekka Tikkanen / Vägpress AB, prislista 2026-06-09", currency: "SEK", print: { "1_1": 22800, "1_2": 13400, "1_4": 8600, sida1: 21500, omslag3: 35300, omslag4: 36800 }, kryss: 25000, nativePrissatt: false, anm: "Native/content ej separat prissatt – kontakta Pekka" }, true);
  await logQuotes(t.id, [
    { type: "ADVERTORIAL", name: "Print 1/1-sida", price: 22800, desc: "Helsida print (eftertext). Native ej separat prissatt." },
  ], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "Pekka Tikkanen", email: "annons@vagpress.se", phone: "+46 70-873 39 55", role: "Annonschef, Vägpress AB (Proffs)", notes: "Print 1/1 22 800; native ej prissatt. 06-09.", primary: true });
  await prisma.title.update({ where: { id: t.id }, data: { outstandingInfo: { set: [...new Set([...(t.outstandingInfo ?? []), "Native/content-pris ej angivet – Pekka hänvisar till telefon"])] } } });
  console.log("Proffs: ← print 1/1 22 800 (native ej prissatt) + Pekka");
}

async function main() {
  await lakartidningen();
  await varldenIdag();
  await bonnierIdenyt();
  await mediaPartners();
  await egmont();
  await proffs();
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
