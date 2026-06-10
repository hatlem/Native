/** 2026-06-09 SECOND reply wave (13:19–16:52) from the SE/DK outreach batch.
 * Body-price data only (attachment-only prices handled separately). Dup-guarded by
 * INBOUND note tag. Creates missing titles/publishers. Verified contact emails only. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { createSalesContact, attachContactToTitle } from "@/lib/pricing/contacts";
import { logQuote } from "@/lib/pricing/quotes";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const MARKET: Record<string, string> = {
  SE: "cmpmdiq3r00010hu0mbiqfmp0",
  DK: "cmpmdiq3s00020hu0fggjt0f4",
};

async function findT(name: string, cc: string) {
  return prisma.title.findFirst({ where: { name: { equals: name, mode: "insensitive" }, countryCode: cc }, select: { id: true, name: true, publisherId: true, outstandingInfo: true } });
}
async function ensurePublisher(name: string, cc: string) {
  let p = await prisma.publisher.findFirst({ where: { name } });
  if (!p) p = await prisma.publisher.create({ data: { name, countryCode: cc, marketId: MARKET[cc] } });
  return p;
}
async function ensureTitle(opts: { name: string; cc: string; slug: string; publisherName: string; websiteUrl?: string; category?: string; offersNative?: boolean; aliases?: string[]; keywords?: string[]; description?: string; digitalReach?: number }) {
  const existing = await prisma.title.findFirst({ where: { slug: opts.slug }, select: { id: true, name: true, publisherId: true, outstandingInfo: true } });
  if (existing) return existing;
  const pub = await ensurePublisher(opts.publisherName, opts.cc);
  const created = await prisma.title.create({ data: {
    name: opts.name, slug: opts.slug, publisherId: pub.id, marketId: MARKET[opts.cc], countryCode: opts.cc,
    category: opts.category, websiteUrl: opts.websiteUrl, offersNativeContent: opts.offersNative ?? true,
    aliases: opts.aliases ?? [], keywords: opts.keywords ?? [], description: opts.description,
    digitalReach: opts.digitalReach, active: true, lastVerifiedAt: new Date(),
  }, select: { id: true, name: true, publisherId: true, outstandingInfo: true } });
  console.log(`  + created title ${opts.name} [${opts.cc}] ${created.id}`);
  return created;
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

// 1) Chef (SE) — Patrik Mood (Chefakademin). Native digital 57 750/99 750/144 000 (1/2/3) + print 25 000/helsida.
async function chef() {
  const TAG = "Chef native 2026 (Patrik Mood)";
  const t = await findT("Chef", "SE"); if (!t) return console.log("! Chef missing");
  if (await done(t.id, TAG)) return console.log("Chef: already");
  const NOTE = "INBOUND 2026-06-09: Patrik Mood (Chefakademin i Stockholm AB, patrik.mood@chef.se, +46 76 223 85 80), prisförslag via GetAccept. " +
    "Native digital (webb+nyhetsbrev+LinkedIn+FB+IG, inkl textframtagning/fotograf/digital specialist): 1 art 57 750, 2 art 99 750 (49 875/st), 3 art 144 000 (48 000/st). " +
    "Tillägg printdistribution (Tidningen Chef helsida) 25 000/helsida (ord. 71 700). Alla exkl moms, inkl produktion+distribution. " +
    "Snitt 2 000–9 000 läsningar/artikel, rapport efter 6–7 v. Räckvidd: chef.se ~165 000 sidvisn/mån, Tidningen Chef 108 000 läsare, LinkedIn 148 000, nyhetsbrev ~26 000, FB 27 000, IG 9 400. " +
    "Erbjöd 32% testrabatt (1 art → 39 270). TLNT (tlnt.se) hanteras av samma säljare (förfrågan tolkades som Chef). " + TAG;
  await setExtra(t.id, { source: "Patrik Mood / Chefakademin, GetAccept 2026-06-09", currency: "SEK", priceType: "exkl_moms", nativeDigital: { 1: 57750, 2: 99750, 3: 144000 }, printHelsidaAddon: 25000, printHelsidaOrdinarie: 71700, includes: ["webb", "nyhetsbrev", "LinkedIn", "Facebook", "Instagram", "textframtagning", "fotograf", "digital specialist"], snittLasningar: "2000-9000", reach: { "chef.se_sidvisn_man": 165000, tidningLasare: 108000, linkedin: 148000, nyhetsbrev: 26000, facebook: 27000, instagram: 9400 }, testRabatt: "32% → 39 270 för 1 art", relatedSeller: "TLNT (tlnt.se) samma säljare" });
  await logQuotes(t.id, [
    { type: "NATIVE_ARTICLE", name: "Native digital (1 artikel)", price: 57750, desc: "Webb+nyhetsbrev+LinkedIn+FB+IG. Inkl produktion+distribution. Exkl moms." },
    { type: "NATIVE_ARTICLE", name: "Native digital (2 artiklar)", price: 99750, desc: "49 875/st. Exkl moms." },
    { type: "NATIVE_ARTICLE", name: "Native digital (3 artiklar)", price: 144000, desc: "48 000/st. Exkl moms." },
    { type: "ADVERTORIAL", name: "Print helsida (Tidningen Chef) tillägg", price: 25000, desc: "Tillägg printdistribution, ord. 71 700. Exkl moms." },
  ], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "Patrik Mood", email: "patrik.mood@chef.se", phone: "+46 76 223 85 80", role: "Chefakademin i Stockholm AB (Chef/TLNT)", notes: "Native digital 57 750/99 750/144 000 + print 25 000. 06-09.", primary: true });
  console.log("Chef: ← native 57 750/99 750/144 000 + Patrik");
}

// 2) Café (SE) — Erik Bergström (SB Media). Native 45 000 (deras text) / 30 000 (färdig text), 5 000 läsningar garanti / 2 v.
async function cafe() {
  const TAG = "Café native 2026 (Erik Bergström)";
  const t = await ensureTitle({ name: "Café", cc: "SE", slug: "cafe-se", publisherName: "SB Media (SE)", websiteUrl: "https://www.cafe.se", category: "Livsstil/Herr", offersNative: true, aliases: ["Cafe", "Café Magazine"], keywords: ["mode", "livsstil", "herr", "kultur"], description: "Svensk mode- och livsstilstidning för män (SB Media). Native-artikel med garanterad läsning." });
  if (await done(t.id, TAG)) return console.log("Café: already");
  const NOTE = "INBOUND 2026-06-09: Erik Bergström (Annonsansvarig, SB Media – King Magazine/Café, erik@sb-media.se, 0707-301262 / 08-545 160 75). " +
    "Native där redaktionen skriver artikeln: 45 000 SEK. Med färdig text: 30 000 SEK. Garanterat minst 5 000 artikelläsningar under 2 veckors kampanjperiod. " +
    "Andra redaktionella samarbeten möjliga beroende på kund. Samma säljare för King Magazine. " + TAG;
  await setExtra(t.id, { source: "Erik Bergström / SB Media, e-post 2026-06-09", currency: "SEK", nativeRedaktionText: 45000, nativeFardigText: 30000, garantiLasningar: 5000, kampanjperiodVeckor: 2, relatedSeller: "King Magazine samma säljare" });
  await logQuotes(t.id, [
    { type: "NATIVE_ARTICLE", name: "Native (redaktionen skriver)", price: 45000, desc: "Redaktionen skriver artikeln. Garanti 5 000 läsningar/2 v." },
    { type: "NATIVE_ARTICLE", name: "Native (färdig text)", price: 30000, desc: "Kund levererar text. Garanti 5 000 läsningar/2 v." },
  ], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "Erik Bergström", email: "erik@sb-media.se", phone: "0707-301262", role: "Annonsansvarig, SB Media (King Magazine/Café)", notes: "Native 45 000/30 000, garanti 5 000 läsn/2v. 06-09.", primary: true });
  console.log("Café: ← native 45 000/30 000 + Erik");
}

// 2b) King Magazine (SE) — same seller, no explicit price yet. Contact only.
async function kingMagazine() {
  const TAG = "King Magazine kontakt 2026 (Erik Bergström)";
  const t = await ensureTitle({ name: "King Magazine", cc: "SE", slug: "king-magazine-se", publisherName: "SB Media (SE)", websiteUrl: "https://www.kingmagazine.se", category: "Livsstil/Herr", offersNative: true, aliases: ["King"], keywords: ["mode", "livsstil", "herr"], description: "Svensk herr-/livsstilstidning (SB Media). Native via Erik Bergström." });
  if (await done(t.id, TAG)) return console.log("King Magazine: already");
  await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-09: King Magazine hanteras av samma säljare som Café – Erik Bergström (erik@sb-media.se). Native-prislista ej specificerad för King ännu; Café-priser (45 000/30 000) som riktmärke. " + TAG, actorId: ACTOR });
  await ensureContact(t.publisherId, t.id, { name: "Erik Bergström", email: "erik@sb-media.se", phone: "0707-301262", role: "Annonsansvarig, SB Media (King Magazine/Café)", notes: "Samma säljare som Café. 06-09.", primary: true });
  console.log("King Magazine: ← kontakt-logg + Erik");
}

// 3) Altinget (DK) — Mads Holten Bonke. Native: opsætning 3 000 + 15 DKK/læsning (ex. 2 000 = 33 000).
async function altinget() {
  const TAG = "Altinget native 2026 (Mads Holten Bonke)";
  const t = await findT("Altinget", "DK"); if (!t) return console.log("! Altinget missing");
  if (await done(t.id, TAG)) return console.log("Altinget: already");
  const NOTE = "INBOUND 2026-06-09: Mads Holten Bonke (Medierådgiver, Altinget, mhb@altinget.dk, +45 4888 6855). " +
    "Native-artikel uden artikelproduktion: opsætning 3 000 DKK + afregning pr. læsning 15 DKK/læsning. Priseksempel: 3 000 + 2 000 læsninger á 15 = 33 000 DKK ekskl moms. " +
    "Publiceres på Altinget-medier + eksponeres i nyhedsbreve. Kunde leverer færdig artikel + billeder/faktabokse. " +
    "Målgruppe: politiske beslutningstagere/embedsværk; læsere 30-60 år, 41% ledelsesansvar, 19% direktører. Nyhedsbreve 160 000+ abonnenter; 29 nichemedier. " +
    "Mandag Morgen hanteras af samma rådgiver. " + TAG;
  await setExtra(t.id, { source: "Mads Holten Bonke / Altinget, e-post 2026-06-09", currency: "DKK", priceType: "ekskl_moms", nativeOpsaetning: 3000, nativePrLaesning: 15, eksempel2000Laesninger: 33000, model: "betaling pr. læsning", reach: { nyhedsbrevAbonnenter: 160000, nichemedier: 29 }, maalgruppe: { alder: "30-60", ledelsesansvarPct: 41, direktorerPct: 19 }, relatedSeller: "Mandag Morgen samme rådgiver" }, true);
  await logQuotes(t.id, [
    { type: "NATIVE_ARTICLE", name: "Native opsætning", price: 3000, unit: "FLAT", cur: "DKK", desc: "Opsætning af native-artikel (uden artikelproduktion). Ekskl moms." },
    { type: "NATIVE_ARTICLE", name: "Native pr. læsning", price: 15, unit: "CPC", cur: "DKK", desc: "Afregnes pr. læsning. Ekskl moms." },
    { type: "PACKAGE", name: "Native eksempel (opsætning + 2 000 læsninger)", price: 33000, unit: "FLAT", cur: "DKK", desc: "3 000 opsætning + 2 000 læsninger á 15. Ekskl moms." },
  ], NOTE, "DKK");
  await ensureContact(t.publisherId, t.id, { name: "Mads Holten Bonke", email: "mhb@altinget.dk", phone: "+45 4888 6855", role: "Medierådgiver, Altinget", notes: "Native 3 000 opsætning + 15/læsning. Også Mandag Morgen. 06-09.", primary: true });
  console.log("Altinget: ← native 3 000 + 15/læsning + Mads");
}

// 3b) Mandag Morgen (DK) — same advisor, contact note.
async function mandagMorgen() {
  const TAG = "Mandag Morgen kontakt 2026 (Mads Holten Bonke)";
  const t = await findT("Mandag Morgen", "DK"); if (!t) return console.log("! Mandag Morgen missing");
  if (await done(t.id, TAG)) return console.log("Mandag Morgen: already");
  await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-09: Mandag Morgen hanteras av samma rådgiver som Altinget – Mads Holten Bonke (mhb@altinget.dk). Native-model som Altinget (opsætning + pr. læsning); ingen separat MM-prisliste angivet. " + TAG, actorId: ACTOR });
  await ensureContact(t.publisherId, t.id, { name: "Mads Holten Bonke", email: "mhb@altinget.dk", phone: "+45 4888 6855", role: "Medierådgiver, Altinget/Mandag Morgen", notes: "Samme rådgiver som Altinget. 06-09.", primary: true });
  console.log("Mandag Morgen: ← kontakt-logg + Mads");
}

// 4) Galago (SE) — Anders Annikas (Ordfront). DISPLAY ONLY, ingen native. Helsida 3 000 / baksida 5 000 + moms.
async function galago() {
  const TAG = "Galago annonspris 2026 (Anders Annikas)";
  const t = await findT("Galago", "SE"); if (!t) return console.log("! Galago missing");
  if (await done(t.id, TAG)) return console.log("Galago: already");
  const NOTE = "INBOUND 2026-06-09: Anders Annikas (chefredaktör, Galago/Ordfront, anders@ordfrontforlag.se). " +
    "ENDAST vanliga annonser, INTE redaktionellt/native material. Helsida 3 000 SEK + moms, baksida 5 000 SEK + moms (print). " +
    "Nästa nummer trycks 2026-06-10, numret efter ute i september. (Kontakt äv. Sofia Olsson sofiao@ordfrontforlag.se.) " + TAG;
  await setExtra(t.id, { source: "Anders Annikas / Galago (Ordfront), e-post 2026-06-09", currency: "SEK", momsTillkommer: true, nativeErbjuds: false, displayHelsida: 3000, displayBaksida: 5000, anm: "Endast vanliga annonser, ej native", utgivning: { nasta: "2026-06-10", darefter: "september" } }, false);
  await logQuotes(t.id, [
    { type: "OTHER", name: "Helsida (print display)", price: 3000, desc: "Vanlig helsidesannons (ej native). + moms." },
    { type: "OTHER", name: "Baksida (print display)", price: 5000, desc: "Baksidesannons (ej native). + moms." },
  ], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "Anders Annikas", email: "anders@ordfrontforlag.se", role: "Chefredaktör, Galago (Ordfront)", notes: "Endast display: helsida 3 000/baksida 5 000 + moms. Ej native. 06-09.", primary: true });
  await ensureContact(t.publisherId, t.id, { name: "Sofia Olsson", email: "sofiao@ordfrontforlag.se", role: "Ansvarig förläggare, Galago (Ordfront)" });
  console.log("Galago: ← display 3 000/5 000 (ej native) + Anders");
}

// 5) Sermitsiaq (DK/GL) — Hans P. Petersen. Sponsoreret artikel 28 260 (temaaviser) / 25 000 (online) DKK.
async function sermitsiaq() {
  const TAG = "Sermitsiaq sponsoreret artikel 2026 (Hans P. Petersen)";
  const t = await findT("Sermitsiaq", "DK"); if (!t) return console.log("! Sermitsiaq missing");
  if (await done(t.id, TAG)) return console.log("Sermitsiaq: already");
  const NOTE = "INBOUND 2026-06-09: Hans P. Petersen (Salgskonsulent, Sermitsiaq AG, hp@sermitsiaq.ag, +299 554206). " +
    "Sponsoreret artikel: 28 260 DKK i temaaviser / 25 000 DKK i ren online-version (afhænger af tilkøb og antal artikler). " +
    "Online publiceres på forsiden af sermitsiaq.gl + deles på Facebook; fast placering ved 'mest læste' i 1 uge, derefter blandt redaktionelle artikler. " +
    "Skrives som udgangspunkt af deres journalist, inkl. oversættelse til grønlandsk, opsætning, evt. links/YouTube. Typisk op til 5 000 tegn. " +
    "Tilkøb: bannere på forside/artikelsider + Facebook-annoncering. " + TAG;
  await setExtra(t.id, { source: "Hans P. Petersen / Sermitsiaq AG, e-post 2026-06-09", currency: "DKK", sponsoreretTemaaviser: 28260, sponsoreretOnline: 25000, placering: "1 uge ved 'mest læste'", produktion: "deres journalist inkl. grønlandsk oversættelse", maxTegn: 5000, tilkob: ["bannere forside/artikelsider", "Facebook-annoncering"], deltOgsaPaFacebook: true }, true);
  await logQuotes(t.id, [
    { type: "ADVERTORIAL", name: "Sponsoreret artikel (temaaviser)", price: 28260, cur: "DKK", desc: "I temaaviser (print). Inkl. journalist + grønlandsk oversættelse." },
    { type: "NATIVE_ARTICLE", name: "Sponsoreret artikel (online)", price: 25000, cur: "DKK", desc: "Ren online på sermitsiaq.gl forside + FB, 1 uge ved 'mest læste'. Afhænger af tilkøb/antal." },
  ], NOTE, "DKK");
  await ensureContact(t.publisherId, t.id, { name: "Hans P. Petersen", email: "hp@sermitsiaq.ag", phone: "+299 554206", role: "Salgskonsulent, Sermitsiaq AG", notes: "Sponsoreret artikel 28 260/25 000 DKK. 06-09.", primary: true });
  console.log("Sermitsiaq: ← sponsoreret 28 260/25 000 DKK + Hans");
}

// 6) Folkeskolen (DK) — Filip Wallfält. Advertorial folkeskolen.dk 25 000 DKK.
async function folkeskolen() {
  const TAG = "Folkeskolen advertorial 2026 (Filip Wallfält)";
  const t = await findT("Folkeskolen", "DK"); if (!t) return console.log("! Folkeskolen missing");
  if (await done(t.id, TAG)) return console.log("Folkeskolen: already");
  const NOTE = "INBOUND 2026-06-09: Filip Wallfält (Partnerchef, Fagbladet Folkeskolen, fiwa@folkeskolen.dk, +45 28 77 47 00). " +
    "Advertorial på folkeskolen.dk: 25 000 DKK ekskl moms. (Filip dækker Folkeskolen, Gymnasieskolen, Teknisk Landsforbund, Dansk Magisterforening.) " + TAG;
  await setExtra(t.id, { source: "Filip Wallfält / Fagbladet Folkeskolen, e-post 2026-06-09", currency: "DKK", advertorialOnline: 25000, priceType: "ekskl_moms" }, true);
  await logQuotes(t.id, [{ type: "ADVERTORIAL", name: "Advertorial (folkeskolen.dk)", price: 25000, cur: "DKK", desc: "Advertorial online. Ekskl moms." }], NOTE, "DKK");
  await ensureContact(t.publisherId, t.id, { name: "Filip Wallfält", email: "fiwa@folkeskolen.dk", phone: "+45 28 77 47 00", role: "Partnerchef, Fagbladet Folkeskolen", notes: "Advertorial folkeskolen.dk 25 000. 06-09.", primary: true });
  console.log("Folkeskolen: ← advertorial 25 000 DKK + Filip");
}

// 7) Gymnasieskolen (DK) — Filip Wallfält. Helside magasin 19 200 + online univers 10 000/mdr (delt ejerskab).
async function gymnasieskolen() {
  const TAG = "Gymnasieskolen pris 2026 (Filip Wallfält)";
  const t = await findT("Gymnasieskolen", "DK"); if (!t) return console.log("! Gymnasieskolen missing");
  if (await done(t.id, TAG)) return console.log("Gymnasieskolen: already");
  const NOTE = "INBOUND 2026-06-09: Filip Wallfält (Partnerchef, fiwa@folkeskolen.dk). Fagbladet Gymnasieskolen: 1/1 helside i magasinet 19 200 DKK ekskl moms; " +
    "online univers (beskeden volumen) delt ejerskab 10 000 DKK/mdr ekskl moms. " + TAG;
  await setExtra(t.id, { source: "Filip Wallfält / Gymnasieskolen, e-post 2026-06-09", currency: "DKK", helsideMagasin: 19200, onlineDeltEjerskabPrMdr: 10000, priceType: "ekskl_moms" }, true);
  await logQuotes(t.id, [
    { type: "ADVERTORIAL", name: "1/1 helside (magasin)", price: 19200, cur: "DKK", desc: "Helside i Gymnasieskolen-magasinet. Ekskl moms." },
    { type: "NATIVE_DISPLAY", name: "Online univers (delt ejerskab/mdr)", price: 10000, cur: "DKK", desc: "Online univers, beskeden volumen, delt ejerskab. Pr. mdr ekskl moms." },
  ], NOTE, "DKK");
  await ensureContact(t.publisherId, t.id, { name: "Filip Wallfält", email: "fiwa@folkeskolen.dk", phone: "+45 28 77 47 00", role: "Partnerchef (Folkeskolen/Gymnasieskolen)", notes: "Helside 19 200 + online 10 000/mdr. 06-09.", primary: true });
  console.log("Gymnasieskolen: ← 19 200 + 10 000/mdr + Filip");
}

// 8) Dansk Magisterforening (DK) — Filip Wallfält. Nyhedsbrev-banner 7 500 DKK (~70 000 modtagere).
async function danskMagisterforening() {
  const TAG = "Dansk Magisterforening nyhedsbrev 2026 (Filip Wallfält)";
  const t = await ensureTitle({ name: "Dansk Magisterforening", cc: "DK", slug: "dansk-magisterforening-dk", publisherName: "Dansk Magisterforening (DK)", websiteUrl: "https://www.dm.dk", category: "Fagforening/Akademikere", offersNative: true, aliases: ["DM", "Magisterbladet"], keywords: ["akademikere", "forskere", "fagforening"], description: "Dansk Magisterforening (DM) – fagforening for akademikere/forskere. Banner i ugentligt nyhedsbrev (~70 000 modtagere). Annoncesalg via Mediehuset/Filip Wallfält.", digitalReach: 70000 });
  if (await done(t.id, TAG)) return console.log("Dansk Magisterforening: already");
  const NOTE = "INBOUND 2026-06-09: Filip Wallfält (Partnerchef, fiwa@folkeskolen.dk, +45 28 77 47 00). DM Dansk Magisterforening: banner i ugentligt nyhedsbrev " +
    "(ca. 70 000 modtagere ugentligt) 7 500 DKK ekskl moms for ét banner pr. gang. " + TAG;
  await setExtra(t.id, { source: "Filip Wallfält, e-post 2026-06-09", currency: "DKK", nyhedsbrevBanner: 7500, modtagereUgentligt: 70000, priceType: "ekskl_moms" }, true);
  await logQuotes(t.id, [{ type: "NATIVE_DISPLAY", name: "Nyhedsbrev-banner (pr. gang)", price: 7500, cur: "DKK", desc: "Ét banner i ugentligt nyhedsbrev (~70 000 modtagere). Ekskl moms." }], NOTE, "DKK");
  await ensureContact(t.publisherId, t.id, { name: "Filip Wallfält", email: "fiwa@folkeskolen.dk", phone: "+45 28 77 47 00", role: "Partnerchef (annoncesalg DM)", notes: "Nyhedsbrev-banner 7 500. 06-09.", primary: true });
  console.log("Dansk Magisterforening: ← nyhedsbrev-banner 7 500 DKK + Filip");
}

// 9) Tipsbladet (DK) — Tobias Calvo Jensen (Better Collective). INGEN native, kun links i artikler.
async function tipsbladet() {
  const TAG = "Tipsbladet ingen native 2026 (Tobias Calvo Jensen)";
  const t = await findT("Tipsbladet", "DK"); if (!t) return console.log("! Tipsbladet missing");
  if (await done(t.id, TAG)) return console.log("Tipsbladet: already");
  await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-09: Tobias Calvo Jensen (Commercial Lead, Better Collective A/S, tcalvo@bettercollective.com, +45 28343346). Tipsbladet tilbyder pt. KUN links i artikler – ingen native/sponsoreret artikel. " + TAG, actorId: ACTOR });
  await setExtra(t.id, { source: "Tobias Calvo Jensen / Better Collective, e-post 2026-06-09", nativeErbjuds: false, anm: "Kun links i artikler, ingen native" }, false);
  await ensureContact(t.publisherId, t.id, { name: "Tobias Calvo Jensen", email: "tcalvo@bettercollective.com", phone: "+45 28343346", role: "Commercial Lead, Better Collective A/S", notes: "Kun links i artikler, ingen native. 06-09.", primary: true });
  await prisma.title.update({ where: { id: t.id }, data: { outstandingInfo: { set: [...new Set([...(t.outstandingInfo ?? []), "Tilbyder ikke native – kun affiliate-links i artikler (Better Collective)"])] } } });
  console.log("Tipsbladet: ← ingen native (kun links) + Tobias");
}

async function main() {
  await chef();
  await cafe();
  await kingMagazine();
  await altinget();
  await mandagMorgen();
  await galago();
  await sermitsiaq();
  await folkeskolen();
  await gymnasieskolen();
  await danskMagisterforening();
  await tipsbladet();
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
