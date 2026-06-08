/** Capture the 2026-06-08 afternoon reply wave into prod. Dup-guarded per title via
 * an INBOUND note tag. Quotes use logQuote (draft fields). Currency per market
 * (NOK/SEK/EUR). Never fabricates a contact email — only uses verified ones from the threads. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { createSalesContact, attachContactToTitle } from "@/lib/pricing/contacts";
import { logQuote } from "@/lib/pricing/quotes";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";

async function findT(name: string, cc?: string) {
  return prisma.title.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(cc ? { countryCode: cc } : {}) },
    select: { id: true, name: true, publisherId: true, outstandingInfo: true },
  });
}
async function done(titleId: string, tag: string) {
  return (await prisma.contactLog.count({ where: { titleId, direction: "INBOUND", note: { contains: tag } } })) > 0;
}
async function ensureContact(publisherId: string, titleId: string, c: { name: string; email: string; phone?: string; role?: string; notes?: string; primary?: boolean }) {
  let sc = await prisma.salesContact.findFirst({ where: { publisherId, email: c.email.toLowerCase() } });
  if (!sc) sc = await createSalesContact({ publisherId, name: c.name, email: c.email, phone: c.phone, role: c.role, notes: c.notes, actorId: ACTOR });
  await attachContactToTitle({ salesContactId: sc.id, titleId, isPrimary: c.primary ?? false, actorId: ACTOR });
}
type Q = { type: string; name: string; price: number; unit: "FLAT" | "CPC" | "CPM"; cur: string; desc: string };
async function logQuotes(titleId: string, qs: Q[], included: string) {
  const log = await createContactLog({ titleId, channel: "EMAIL", direction: "INBOUND", note: included, actorId: ACTOR });
  for (const q of qs) await logQuote({ draftProductType: q.type, draftProductName: q.name, draftProductDesc: q.desc, contactLogId: log.id, price: q.price, currency: q.cur, priceUnit: q.unit, includedText: included.slice(0, 200), recordedById: ACTOR });
  return log;
}

// 1) Amedia native (Fanaposten + Åsane Tidende) — Miriam Olaussen. Amedia-wide CPM, no per-pub rate cards.
async function amedia() {
  const TAG = "Amedia native CPM 2026 (Miriam Olaussen)";
  const NOTE = "INBOUND 2026-06-08: Miriam Olaussen (KAM, Amedia Annonse Vest, 91 88 96 85) ga Amedia native-priser. " +
    "Veiledende brutto CPM (NOK): Native 1-sak/Native Video 300, Native 2-saker(±video) 350, Native 3-saker(±video) 400. " +
    "INGEN ulike rate cards per publikasjon – målretting via tittelvalg, ingen ekstra kost for 2 aviser samme artikkel. " +
    "Produksjon: tilpasning ferdig materiell 4 500, full artikkelproduksjon 18 000. Gjelder Amedia-titler generelt. " + TAG;
  const QS: Q[] = [
    { type: "NATIVE_ARTICLE", name: "Native 1-sak / Native Video", price: 300, unit: "CPM", cur: "NOK", desc: "Veiledende brutto CPM. Amedia-standard, ingen per-pub rate card." },
    { type: "NATIVE_ARTICLE", name: "Native 2-saker (±video)", price: 350, unit: "CPM", cur: "NOK", desc: "Veiledende brutto CPM." },
    { type: "NATIVE_ARTICLE", name: "Native 3-saker (±video)", price: 400, unit: "CPM", cur: "NOK", desc: "Veiledende brutto CPM." },
    { type: "OTHER", name: "Produksjon – tilpasning ferdig materiell", price: 4500, unit: "FLAT", cur: "NOK", desc: "Kunden leverer materiell, settes inn i malverk." },
    { type: "OTHER", name: "Produksjon – full artikkelproduksjon", price: 18000, unit: "FLAT", cur: "NOK", desc: "Amedias innholdsprodusenter produserer." },
  ];
  for (const name of ["Fanaposten", "Åsane Tidende"]) {
    const t = await findT(name, "NO");
    if (!t) { console.log(`! ${name} not found`); continue; }
    if (await done(t.id, TAG)) { console.log(`${name}: already ingested`); continue; }
    await prisma.title.update({ where: { id: t.id }, data: { offersNativeContent: true, commercialExtra: { source: "Miriam Olaussen / Amedia Annonse Vest, e-post 2026-06-08", currency: "NOK", nativeCpm: { en: 300, to: 350, tre: 400 }, produksjon: { tilpasning: 4500, full: 18000 }, note: "Amedia-standard, ingen per-pub rate card; målretting via tittelvalg." } } });
    await logQuotes(t.id, QS, NOTE);
    await ensureContact(t.publisherId, t.id, { name: "Miriam Olaussen", email: "miriam.olaussen@amedia.no", phone: "91 88 96 85", role: "Key Account Manager, Amedia Annonse Vest", notes: "Ga Amedia native-CPM 06-08; ber om budsjett/periode for skreddersydd tilbud.", primary: false });
    console.log(`${name}: ← 5 quotes + Amedia native + Miriam-kontakt`);
  }
}

// 2) Ságat — Siw Michalsen. Native artikkel/video-native + display banners.
async function sagat() {
  const TAG = "Ságat priser 2026 (Siw Michalsen)";
  const t = await findT("Ságat", "NO");
  if (!t) { console.log("! Ságat not found"); return; }
  if (await done(t.id, TAG)) { console.log("Ságat: already ingested"); return; }
  const NOTE = "INBOUND 2026-06-08: Siw Michalsen (Deskleder/Mediegrafiker, Ságat – Samisk avis AS, 417 54 457) ga priser. " +
    "Native: video-native/native artikkel 2 500/døgn (12 250/uke), leveres ferdig. " +
    "Display: midtbanner 480x300 700/døgn (3 500/uke), fullbanner 980x300 1 000/døgn (4 900/uke); annonsbilde/dyn.kode/HTML5. " + TAG;
  await prisma.title.update({ where: { id: t.id }, data: { offersNativeContent: true, commercialExtra: { source: "Siw Michalsen / Ságat, e-post 2026-06-08", currency: "NOK", native: { perDogn: 2500, perUke: 12250, note: "video-native/native artikkel, leveres ferdig" }, display: { midtbanner: "700/døgn, 3500/uke (480x300)", fullbanner: "1000/døgn, 4900/uke (980x300)" } } } });
  await logQuotes(t.id, [
    { type: "NATIVE_ARTICLE", name: "Native artikkel / video-native (per uke)", price: 12250, unit: "FLAT", cur: "NOK", desc: "2 500/døgn. Artikkel/video leveres ferdig til Ságat." },
    { type: "NATIVE_DISPLAY", name: "Fullbanner 980x300 (per uke)", price: 4900, unit: "FLAT", cur: "NOK", desc: "1 000/døgn. Annonsbilde/dyn.kode/HTML5." },
    { type: "NATIVE_DISPLAY", name: "Midtbanner 480x300 (per uke)", price: 3500, unit: "FLAT", cur: "NOK", desc: "700/døgn." },
  ], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "Siw Michalsen", email: "siw@sagat.no", phone: "417 54 457", role: "Deskleder / Mediegrafiker, Ságat – Samisk avis AS", notes: "Ga native+banner-priser 06-08.", primary: true });
  console.log("Ságat: ← 3 quotes + native + Siw-kontakt");
}

// 3) Allt om Jakt & Vapen — Sofie's explicit native price (helsida).
async function jaktNative() {
  const TAG = "Jakt native helsida 2026 (Sofie)";
  const t = await findT("Allt om Jakt & Vapen", "SE");
  if (!t) { console.log("! Allt om Jakt & Vapen not found"); return; }
  if (await done(t.id, TAG)) { console.log("Jakt native: already ingested"); return; }
  const NOTE = "INBOUND 2026-06-08 13:14: Sofie Oskarsson (JO Förlaget) ga eksplisitt native-pris (helsida): 1 nativeannons 16 000 SEK, 2+ nativeannonser 13 000 SEK/st. " +
    "I tillegg digitale koncept (serier Jaktresan/Hundskola/Vapenverkstan, livesändning, podd) + banner (pris etter strl/tid). Eks. moms. " + TAG;
  await logQuotes(t.id, [
    { type: "NATIVE_ARTICLE", name: "Nativeannons helsida (1 st)", price: 16000, unit: "FLAT", cur: "SEK", desc: "Helsida native i tidningen. Eks. moms." },
    { type: "NATIVE_ARTICLE", name: "Nativeannons helsida (2+ st, per st)", price: 13000, unit: "FLAT", cur: "SEK", desc: "Helsida native, 2 eller fler, pris per st. Eks. moms." },
  ], NOTE);
  console.log("Allt om Jakt & Vapen: ← 2 native-quotes (16 000 / 13 000)");
}

// 4) Cykling — Tatjana. Native på hemsida + nyhetsmail-puff.
async function cykling() {
  const TAG = "Cykling native 2026 (Tatjana)";
  const t = await findT("Cykling", "SE");
  if (!t) { console.log("! Cykling not found"); return; }
  if (await done(t.id, TAG)) { console.log("Cykling: already ingested"); return; }
  const NOTE = "INBOUND 2026-06-08: Tatjana Boric-Persson (Chefredaktör Cykling/företagssamarbeten, Cykelfrämjandet, 0739 29 77 83) ga native-pris. " +
    "Native på hemsida + puff i nyhetsmail = 11 000 SEK per native. Tidningen → drygt 6 700 medlemmar + politiker/opinionsbildare/myndighet + e-tidning. " +
    "Eksempel-natives: Lease a bike, Ecoride, Tänndalen. Spurte hvilken kunde. " + TAG;
  await prisma.title.update({ where: { id: t.id }, data: { offersNativeContent: true, monthlyReach: 6700, audienceNote: "Drygt 6 700 cykelintresserade medlemmar + politiker, opinionsbildare, myndighetspersoner; e-tidning på hemsidan.", commercialExtra: { source: "Tatjana Boric-Persson / Cykelfrämjandet, e-post 2026-06-08", currency: "SEK", nativeHemsidaPlusNyhetsmail: 11000, medlemmar: 6700 } } });
  await logQuotes(t.id, [{ type: "NATIVE_ARTICLE", name: "Native på hemsida + puff i nyhetsmail", price: 11000, unit: "FLAT", cur: "SEK", desc: "Native publiseras på cykelframjandet.se + puff i nyhetsmail til medlemmar (~6 700)." }], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "Tatjana Boric-Persson", email: "tatjana.boric.persson@cykelframjandet.se", phone: "0739 29 77 83", role: "Chefredaktör Cykling och företagssamarbeten, Cykelfrämjandet", notes: "Ga native-pris 11 000 SEK 06-08; ba om kunde.", primary: true });
  console.log("Cykling: ← native 11 000 + reach + Tatjana-kontakt");
}

// 5) Bonnier News FI — HBL + Vasabladet native. Elin Karppinen.
async function bonnierFi() {
  const TAG = "BNF native 2026 (Elin Karppinen)";
  const NOTE = "INBOUND 2026-06-08: Elin Karppinen (Concept Manager, Bonnier News B2B FI, +358407430889) ga native-priser for Svenskfinland-porteføljen " +
    "(HBL, Västra Nyland, Borgåbladet, Syd-Österbotten, Vasabladet, Österbottens Tidning). " +
    "NATIVE/vecka: HBL 1 800 EUR, Vasabladet 790 EUR. Produksjon hos dem +1 000 EUR (valgfritt). Video +500 EUR. " +
    "Pakke HBL+VBL = 3 590 EUR + moms (garantert min 10 000 läsningar). Mediebyrårabatt -15% ved faktura til oss. " +
    "100% share of voice, puff 24/7 desktop+mobil, >100 000 visningar; ~5 000 läsningar/vecka per tittel. " + TAG;
  const data: { name: string; price: number; reach: string }[] = [
    { name: "Hufvudstadsbladet", price: 1800, reach: "HBL ~5 000 läsningar/vecka per native, >100k visningar (100% SOV)" },
    { name: "Vasabladet", price: 790, reach: "VBL ~5 000 läsningar/vecka per native, >100k visningar (100% SOV)" },
  ];
  for (const d of data) {
    const t = await findT(d.name, "FI");
    if (!t) { console.log(`! ${d.name} (FI) not found`); continue; }
    if (await done(t.id, TAG)) { console.log(`${d.name}: already ingested`); continue; }
    await prisma.title.update({ where: { id: t.id }, data: { offersNativeContent: true, audienceNote: d.reach, commercialExtra: { source: "Elin Karppinen / Bonnier News B2B FI, e-post 2026-06-08", currency: "EUR", nativePerVecka: d.price, produksjonTillegg: 1000, videoTillegg: 500, paketHblVbl: 3590, mediebyraRabatt: "-15% ved faktura til oss", shareOfVoice: "100% SOV, >100k visningar, ~5000 läsningar/vecka" } } });
    await logQuotes(t.id, [
      { type: "NATIVE_ARTICLE", name: `Native (${d.name}, per vecka)`, price: d.price, unit: "FLAT", cur: "EUR", desc: "100% SOV, puff 24/7 desktop+mobil, >100k visningar, ~5000 läsningar/vecka. Produksjon +1000, video +500. Pakke HBL+VBL 3590." },
    ], NOTE);
    await ensureContact(t.publisherId, t.id, { name: "Elin Karppinen", email: "elin.karppinen@bonniernews.fi", phone: "+358407430889", role: "Concept Manager, Bonnier News B2B (Finland)", notes: "Ga native-priser Svenskfinland 06-08; pakke HBL+VBL 3590 EUR.", primary: false });
    console.log(`${d.name}: ← native ${d.price} EUR/vecka + Elin-kontakt`);
  }
}

// 6) Edda Presse — Folkemusikk (native 11500) + Fotografi (contentPolicy) + Museum (note). Sissel Bjerkeset.
async function eddaPresse() {
  const POLICY = "Content/native må merkes tydelig 'Betalt annonseinnhold' og godkjennes på forhånd av redaktør.";
  // Folkemusikk
  const fm = await findT("Folkemusikk", "NO");
  if (fm && !(await done(fm.id, "Folkemusikk content 2026"))) {
    await prisma.title.update({ where: { id: fm.id }, data: { offersNativeContent: true, contentPolicy: POLICY } });
    await logQuotes(fm.id, [{ type: "ADVERTORIAL", name: "Content/native helside", price: 11500, unit: "FLAT", cur: "NOK", desc: "Helside, ferdig materiell ≥300 DPI. Eks. mva. Annonsefrister 3. aug / 28. sep / 23. nov." }],
      "INBOUND 2026-06-08: Sissel Bjerkeset (Edda Presse) – Folkemusikk content OK (merket 'Betalt annonseinnhold' + redaktørgodkjent). Helside 11 500 eks mva. Folkemusikk content 2026");
    await ensureContact(fm.publisherId, fm.id, { name: "Sissel Bjerkeset", email: "sissel@eddapresse.no", phone: "+47 922 10 891", role: "Annonsesalg Edda Presse (Folkemusikk, Fotografi m.fl.)", notes: "Ga Folkemusikk 11 500 / Fotografi 12 900 eks mva 06-08. Museum tar IKKE content.", primary: true });
    console.log("Folkemusikk: ← content helside 11 500 + policy + Sissel-kontakt");
  } else console.log("Folkemusikk: skip (mangler/allerede)");
  // Fotografi — pris 12 900 allerede logget 06-05; legg til contentPolicy + bekreftelse (ingen ny quote)
  const fo = await findT("Fotografi", "NO");
  if (fo && !(await done(fo.id, "Fotografi content-policy 2026"))) {
    await prisma.title.update({ where: { id: fo.id }, data: { contentPolicy: POLICY } });
    await createContactLog({ titleId: fo.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-08: Sissel Bjerkeset bekreftet Fotografi helside 12 900 eks mva (allerede logget) + content må merkes 'Betalt annonseinnhold' + redaktørgodkjent. Annonsefrist 1. sep. Fotografi content-policy 2026", actorId: ACTOR });
    console.log("Fotografi: ← contentPolicy + bekreftelse (12 900 allerede logget)");
  } else console.log("Fotografi: skip (mangler/allerede)");
  // Museum (tidsskriftetmuseum.no) – tar IKKE content. Ikke entydig i katalogen → logg note hvis vi finner en match, ellers skip.
  console.log("Museum (tidsskriftetmuseum.no): tar IKKE content – ingen entydig katalog-match (Museumsnytt/Norsk Museumstidsskrift er andre titler), hopper over.");
}

// 7) Forskning.no — Kristin Jobraaten (vil ha Teams-møte, ingen pris ennå).
async function forskning() {
  const t = await findT("Forskning.no", "NO");
  if (!t) { console.log("! Forskning.no not found"); return; }
  if (await done(t.id, "Forskning.no kontakt 2026")) { console.log("Forskning.no: already"); return; }
  await prisma.title.update({ where: { id: t.id }, data: { offersNativeContent: true } });
  await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-08: Kristin Jobraaten (Forretningsutvikler salg/arrangement, +47 918 06 038) positiv, tilbyr 10-min Teams-gjennomgang. Ingen pris ennå. Forskning.no kontakt 2026", actorId: ACTOR });
  await ensureContact(t.publisherId, t.id, { name: "Kristin Jobraaten", email: "kristin.j@forskning.no", phone: "+47 918 06 038", role: "Forretningsutvikler – salg og arrangement, Forskning.no", notes: "Vil ta 10-min Teams-møte 06-08. Avventer pris.", primary: true });
  const oi = new Set([...(t.outstandingInfo ?? []), "Avventer native-pris – Kristin tilbyr Teams-møte"]);
  await prisma.title.update({ where: { id: t.id }, data: { outstandingInfo: { set: [...oi] } } });
  console.log("Forskning.no: ← Kristin-kontakt + møte-flag");
}

// 8) Universitetsläraren (SE) – tar IKKE native. Hans Simons. Journalisten (SE) ikke i katalog → note.
async function universitetslararen() {
  const t = await findT("Universitetsläraren", "SE");
  if (!t) { console.log("! Universitetsläraren not found"); return; }
  if (await done(t.id, "Universitetsläraren native-policy 2026")) { console.log("Universitetsläraren: already"); return; }
  await prisma.title.update({ where: { id: t.id }, data: { offersNativeContent: false } });
  await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-08: Hans Simons (Annonssäljarna, 070-928 58 41) – Universitetsläraren tillåter INTE native. Journalisten (SE, journalisten.se) gjør native i nyhetsbrev (14 000 prenumeranter, 5×/uke) – ikke i katalogen vår, ingen pris oppgitt. Universitetsläraren native-policy 2026", actorId: ACTOR });
  await ensureContact(t.publisherId, t.id, { name: "Hans Simons", email: "hans.simons@annonssaljarna.se", phone: "070-928 58 41", role: "Annonssäljarna (Universitetsläraren m.fl.)", notes: "Universitetsläraren tar ikke native; Journalisten SE native i nyhetsbrev (14k pren).", primary: false });
  console.log("Universitetsläraren: ← native=false + Hans-kontakt + Journalisten-note");
}

// 9) Søvesten – KATALOG-FIX: Heim kommune, Trøndelag (ikke Båtsfjord/Øst-Finnmark).
async function sovesten() {
  const t = await findT("Søvesten", "NO");
  if (!t) { console.log("! Søvesten not found"); return; }
  if (await done(t.id, "Søvesten geografi-korreksjon")) { console.log("Søvesten: already"); return; }
  await prisma.title.update({ where: { id: t.id }, data: { city: "Heim", region: "Trøndelag", description: "Lokalavis for Heim kommune i Trøndelag." } });
  await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-08: May (Søvesten, annonser@sovesten.no) oppklarte: Søvesten er lokalavis for HEIM kommune i Trøndelag – IKKE Båtsfjord/Øst-Finnmark som vår forespørsel antok. Katalog-geografi rettet. Søvesten geografi-korreksjon", actorId: ACTOR });
  const oi = new Set([...(t.outstandingInfo ?? []), "Geografi rettet 06-08: Heim/Trøndelag (ikke Finnmark)"]);
  await prisma.title.update({ where: { id: t.id }, data: { outstandingInfo: { set: [...oi] } } });
  console.log("Søvesten: ← geografi rettet (Heim/Trøndelag) + note");
}

// 10) Aller – mediekit via WeTransfer-lenke + møteønske. Flag, ingen auto-nedlasting.
async function aller() {
  const t = await prisma.title.findFirst({ where: { countryCode: "SE", publisher: { name: { contains: "Aller", mode: "insensitive" } } }, select: { id: true, name: true, outstandingInfo: true } });
  if (!t) { console.log("! Aller-tittel ikke funnet"); return; }
  if (await done(t.id, "Aller mediekit WeTransfer 2026")) { console.log("Aller: already"); return; }
  await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-08 13:48: Camilla Hedström (Aller) sendte mediekit for alle varumärken + native-produktblad via WeTransfer-lenke (we.tl/t-BAVR3bQ7…). Mange slides. Ønsker kort møte for å presentere øvrige produkter. Nedlasting avventer brukerbeslutning. Aller mediekit WeTransfer 2026", actorId: ACTOR });
  const oi = new Set([...(t.outstandingInfo ?? []), "Aller mediekit ligger på WeTransfer-lenke (last ned ved behov); Camilla ønsker møte"]);
  await prisma.title.update({ where: { id: t.id }, data: { outstandingInfo: { set: [...oi] } } });
  console.log(`Aller (${t.name}): ← WeTransfer/møte-flag`);
}

async function main() {
  await amedia();
  await sagat();
  await jaktNative();
  await cykling();
  await bonnierFi();
  await eddaPresse();
  await forskning();
  await universitetslararen();
  await sovesten();
  await aller();
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
