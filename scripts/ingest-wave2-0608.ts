/** 2026-06-08 second reply wave (afternoon, 14:00–15:35). Dup-guarded via INBOUND
 * note tag. New native prices + commercial terms. Verified contact emails only. */
import { prisma } from "@/lib/prisma";
import type { ProductType } from "@prisma/client";
import { createContactLog } from "@/lib/pricing/contact-log";
import { createSalesContact, attachContactToTitle } from "@/lib/pricing/contacts";
import { logQuote } from "@/lib/pricing/quotes";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";

async function findT(name: string, cc?: string) {
  return prisma.title.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(cc ? { countryCode: cc } : {}) }, select: { id: true, name: true, publisherId: true, outstandingInfo: true } });
}
async function done(titleId: string, tag: string) {
  return (await prisma.contactLog.count({ where: { titleId, direction: "INBOUND", note: { contains: tag } } })) > 0;
}
async function ensureContact(publisherId: string, titleId: string, c: { name: string; email: string; phone?: string; role?: string; notes?: string; primary?: boolean }) {
  let sc = await prisma.salesContact.findFirst({ where: { publisherId, email: c.email.toLowerCase() } });
  if (!sc) sc = await createSalesContact({ publisherId, name: c.name, email: c.email, phone: c.phone, role: c.role, notes: c.notes, actorId: ACTOR });
  await attachContactToTitle({ salesContactId: sc.id, titleId, isPrimary: c.primary ?? false, actorId: ACTOR });
}
type Q = { type: ProductType; name: string; price: number; unit: "FLAT" | "CPC" | "CPM"; cur: string; desc: string };
async function logQuotes(titleId: string, qs: Q[], note: string) {
  const log = await createContactLog({ titleId, channel: "EMAIL", direction: "INBOUND", note, actorId: ACTOR });
  for (const q of qs) await logQuote({ draftProductType: q.type, draftProductName: q.name, draftProductDesc: q.desc, contactLogId: log.id, price: q.price, currency: q.cur, priceUnit: q.unit, includedText: note.slice(0, 200), recordedById: ACTOR });
  return log;
}

// 1) RES / Res Travel Magazine (SE) — Miriam Andersson. Native €1000/week + banners.
async function res() {
  const TAG = "RES native 2026 (Miriam Andersson)";
  const t = await findT("RES", "SE");
  if (!t) { console.log("! RES not found"); return; }
  if (await done(t.id, TAG)) { console.log("RES: already"); return; }
  const NOTE = "INBOUND 2026-06-08: Miriam Andersson (KAM, RES Travel Magazine, +46735354393) ga digital prismall RES.se: " +
    "Native €1000/vecka; Top banner €1000/v, Wide central €500/v, Side banner €250/v. Riktpriser, flexibel pakke ved lengre periode. " + TAG;
  await prisma.title.update({ where: { id: t.id }, data: { offersNativeContent: true, commercialExtra: { source: "Miriam Andersson / RES Travel Magazine, e-post 2026-06-08", currency: "EUR", nativePerVecka: 1000, banners: { top: 1000, wideCentral: 500, side: 250 } } } });
  await logQuotes(t.id, [
    { type: "NATIVE_ARTICLE", name: "Native (RES.se, per vecka)", price: 1000, unit: "FLAT", cur: "EUR", desc: "Digital native på RES.se. Riktpris, fleksibelt ved lengre periode." },
    { type: "NATIVE_DISPLAY", name: "Top banner (per vecka)", price: 1000, unit: "FLAT", cur: "EUR", desc: "RES.se digital." },
  ], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "Miriam Andersson", email: "miriam.andersson@travelnews.se", phone: "+46735354393", role: "Key Account Manager, RES Travel Magazine", notes: "Ga native €1000/v + banner-priser 06-08.", primary: true });
  console.log("RES: ← native €1000/v + banner + Miriam-kontakt");
}

// 2) Storfjordnytt (NO) — Britt Ingunn Maurstad. Native flat 750/uke.
async function storfjordnytt() {
  const TAG = "Storfjordnytt native 2026 (Britt Ingunn)";
  const t = await findT("Storfjordnytt", "NO");
  if (!t) { console.log("! Storfjordnytt not found"); return; }
  if (await done(t.id, TAG)) { console.log("Storfjordnytt: already"); return; }
  const NOTE = "INBOUND 2026-06-08: Britt Ingunn Maurstad (Storfjordnytt, annonse@storfjordnytt.no) – ingen fast prisliste for native, men får til ønsket format. " +
    "Sist gang: fast pris kr 750 eks mva per uke (avhengig av liggetid). " + TAG;
  await prisma.title.update({ where: { id: t.id }, data: { offersNativeContent: true, commercialExtra: { source: "Britt Ingunn Maurstad / Storfjordnytt, e-post 2026-06-08", currency: "NOK", nativePerUke: 750, note: "Ingen fast prisliste; pris per uke avhengig av liggetid." } } });
  await logQuotes(t.id, [{ type: "NATIVE_ARTICLE", name: "Native / annonsørinnhold (per uke)", price: 750, unit: "FLAT", cur: "NOK", desc: "Fleksibelt format, pris per uke avhengig av liggetid (sist brukt sats)." }], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "Britt Ingunn Maurstad", email: "annonse@storfjordnytt.no", role: "Annonse, Storfjordnytt", notes: "Native 750/uke eks mva 06-08; lager format på bestilling.", primary: true });
  console.log("Storfjordnytt: ← native 750/uke + kontakt");
}

// 3) Veronica / Rabalder (Kommunalarbetaren + Arbetet) — ADD uppslag + digital native (helsida already logged 06-05).
async function rabalderExtra() {
  const TAG = "Rabalder native uppslag+digital 2026";
  const data = [
    { name: "Kommunalarbetaren", uppslag: 32000, digital: 20000 },
    { name: "Arbetet", uppslag: 29000, digital: 20000 },
  ];
  for (const d of data) {
    const t = await findT(d.name, "SE");
    if (!t) { console.log(`! ${d.name} not found`); continue; }
    if (await done(t.id, TAG)) { console.log(`${d.name}: extra already`); continue; }
    const NOTE = `INBOUND 2026-06-05/08: Veronica Bengtsson (Rabalder Media) komplett native-tilbud ${d.name}: ` +
      `helsida native (logget tidligere), uppslag native ${d.uppslag} SEK, digital native ${d.digital} SEK/mån. ` + TAG;
    await logQuotes(t.id, [
      { type: "NATIVE_ARTICLE", name: `Uppslag native (${d.name})`, price: d.uppslag, unit: "FLAT", cur: "SEK", desc: "Print uppslag native (alt. format). Eks. moms." },
      { type: "NATIVE_ARTICLE", name: `Digital native (${d.name}, per mån)`, price: d.digital, unit: "FLAT", cur: "SEK", desc: "Digital native, per måned. Eks. moms." },
    ], NOTE);
    console.log(`${d.name}: ← uppslag ${d.uppslag} + digital ${d.digital}/mån`);
  }
}

// 4) Akersposten/Ullern (Henriette) — 50% rabatt-tilbud (kommersielt vilkår, ingen konkret native-pris).
async function akersposten50() {
  const TAG = "Akersposten 50% rabatt-tilbud 2026";
  const ts = await prisma.title.findMany({ where: { countryCode: "NO", name: { contains: "Akersposten", mode: "insensitive" } }, select: { id: true, name: true, outstandingInfo: true } });
  for (const t of ts) {
    if (await done(t.id, TAG)) { console.log(`${t.name}: 50%-note already`); continue; }
    await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-08: Henriette Kjærnes Halvåg (Amedia Annonse) tilbyr 50% rabatt som utgangspunkt på varelageret i Akersposten/Ullern Avis; setter opp estimat med 50% rabatt i morgen dersom ønsket. Trenger konkret kunde for vurdering utover dette. " + TAG, actorId: ACTOR });
    const oi = new Set([...(t.outstandingInfo ?? []), "Henriette/Amedia tilbyr 50% rabatt-estimat (avventer vårt OK + kunde)"]);
    await prisma.title.update({ where: { id: t.id }, data: { outstandingInfo: { set: [...oi] } } });
    console.log(`${t.name}: ← 50% rabatt-tilbud logget`);
  }
}

// 5) Ruijan Kaiku (Yngve) — kun topboard, INGEN native. Display 3500/uke.
async function ruijanKaiku() {
  const TAG = "Ruijan Kaiku banner-pris 2026";
  const t = await findT("Ruijan Kaiku", "NO");
  if (!t) { console.log("! Ruijan Kaiku not found"); return; }
  if (await done(t.id, TAG)) { console.log("Ruijan Kaiku: already"); return; }
  const NOTE = "INBOUND 2026-06-08: Yngve Reginiussen (Markedssjef, Polaris Marked Nord / Mediehuset Altaposten, 45 22 32 32) – Ruijan Kaiku har KUN én annonseplass: " +
    "topboard 980x300, kr 3 500/uke eks mva. INGEN native-produkt. " + TAG;
  await prisma.title.update({ where: { id: t.id }, data: { offersNativeContent: false, commercialExtra: { source: "Yngve Reginiussen / Polaris Marked Nord, e-post 2026-06-08", currency: "NOK", topboard980x300PerUke: 3500, note: "Kun én annonseplass, ingen native." } } });
  await logQuotes(t.id, [{ type: "NATIVE_DISPLAY", name: "Topboard 980x300 (per uke)", price: 3500, unit: "FLAT", cur: "NOK", desc: "Eneste annonseplass på Ruijan Kaiku. Ingen native." }], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "Yngve Reginiussen", email: "yngve@altaposten.no", phone: "45 22 32 32", role: "Markedssjef, Polaris Marked Nord (Mediehuset Altaposten)", notes: "Ruijan Kaiku kun topboard 3500/uke, ingen native. OOO-redirect marked@altaposten.no.", primary: true });
  console.log("Ruijan Kaiku: ← topboard 3500/uke, native=false");
}

// 6) Schibsted E24/VG Helg/Godt.no (Askheim) — content min-spend 100 000 NOK (kommersielt vilkår).
async function schibstedMinSpend() {
  const TAG = "Schibsted content min-spend 2026";
  const ts = await prisma.title.findMany({ where: { countryCode: "NO", name: { in: ["E24", "VG Helg", "Godt.no"], mode: "insensitive" } }, select: { id: true, name: true, outstandingInfo: true } });
  for (const t of ts) {
    if (await done(t.id, TAG)) { console.log(`${t.name}: min-spend already`); continue; }
    await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-08: Andreas Askheim (Schibsted) – content minimum-spend 100 000 NOK. Ønsker felles møte for å optimalisere mot kundens KPI; har erfaring med performance-aktører. Konkret native-pris/estimat i vedlagt skjermbilde (ikke ekstrahert som tekst). " + TAG, actorId: ACTOR });
    const oi = new Set([...(t.outstandingInfo ?? []), "Schibsted content min-spend 100 000 NOK; estimat i skjermbilde (Askheim)"]);
    await prisma.title.update({ where: { id: t.id }, data: { outstandingInfo: { set: [...oi] } } });
    console.log(`${t.name}: ← Schibsted min-spend 100 000 logget`);
  }
}

// 7) Husvagn & Camping (SE) — Anders Jeppsson. Native 40000/30000, 5000 läsningar garantert.
async function husvagn() {
  const TAG = "Husvagn & Camping native 2026 (Anders Jeppsson)";
  const t = await findT("Husvagn & Camping", "SE");
  if (!t) { console.log("! Husvagn & Camping not found"); return; }
  if (await done(t.id, TAG)) { console.log("Husvagn & Camping: already"); return; }
  const NOTE = "INBOUND 2026-06-08: Anders Jeppsson (Allt om Husvagn & Camping, Swartling & Bergström Media, 08-545 160 76) – Native artikel: " +
    "40 000 SEK (de skriver) / 30 000 SEK (vi leverer ferdig). Garanterer 5 000 läsningar. " + TAG;
  await prisma.title.update({ where: { id: t.id }, data: { offersNativeContent: true, commercialExtra: { source: "Anders Jeppsson / Swartling & Bergström Media, e-post 2026-06-08", currency: "SEK", nativeDeSkriver: 40000, nativeViLeverer: 30000, garantiLasningar: 5000 } } });
  await logQuotes(t.id, [
    { type: "NATIVE_ARTICLE", name: "Native artikel (redaksjonen skriver)", price: 40000, unit: "FLAT", cur: "SEK", desc: "Garanterer 5 000 läsningar." },
    { type: "NATIVE_ARTICLE", name: "Native artikel (ferdig levert)", price: 30000, unit: "FLAT", cur: "SEK", desc: "Annonsør leverer ferdig artikkel. Garanterer 5 000 läsningar." },
  ], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "Anders Jeppsson", email: "anders@sb-media.se", phone: "08-545 160 76", role: "Allt om Husvagn & Camping (Swartling & Bergström Media)", notes: "Native 40000/30000 SEK, 5000 läsningar 06-08.", primary: true });
  console.log("Husvagn & Camping: ← native 40000/30000 + kontakt");
}

// 8) Totens Blad (+ Gjøviks Blad) — Hans Erik Linnerud. Native CPM-style 2500/10000 visn.
async function totensBlad() {
  const TAG = "Totens Blad native 2026 (Hans Erik Linnerud)";
  const t = await findT("Totens Blad", "NO");
  if (!t) { console.log("! Totens Blad not found"); return; }
  if (await done(t.id, TAG)) { console.log("Totens Blad: already"); return; }
  const NOTE = "INBOUND 2026-06-08: Hans Erik Linnerud (Markedssjef Gjøviks Blad og Totens Blad, 41 47 68 99, hanserik@totens-blad.no) – " +
    "Native kr 2 500 + mva per 10 000 visninger (≈250 CPM). Rene nettannonser kr 1 000 + mva per 10 000 visninger. " +
    "Sammen med søsteravis Gjøviks Blad: papir, opplag 15 000. " + TAG;
  await prisma.title.update({ where: { id: t.id }, data: { offersNativeContent: true, commercialExtra: { source: "Hans Erik Linnerud / Totens Blad, e-post 2026-06-08", currency: "NOK", nativePer10kVisninger: 2500, nettPer10kVisninger: 1000, sosteravis: "Gjøviks Blad (papir, opplag 15 000)" } } });
  await logQuotes(t.id, [
    { type: "NATIVE_ARTICLE", name: "Native (CPM, per 10 000 visninger)", price: 2500, unit: "FLAT", cur: "NOK", desc: "Kr 2 500 + mva per 10 000 visninger (≈250 CPM)." },
    { type: "NATIVE_DISPLAY", name: "Nettannonse (per 10 000 visninger)", price: 1000, unit: "FLAT", cur: "NOK", desc: "Kr 1 000 + mva per 10 000 visninger." },
  ], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "Hans Erik Linnerud", email: "hanserik@totens-blad.no", phone: "41 47 68 99", role: "Markedssjef Gjøviks Blad og Totens Blad", notes: "Native 2500/10k visn + nett 1000/10k; Gjøviks Blad papir opplag 15000. 06-08.", primary: true });
  console.log("Totens Blad: ← native 2500/10k + nett + kontakt");
}

// 9) Bonnier Healthcare (Dagens Medisin + Helserevyen) — Arvid Ervik. No price; needs B2C/B2B + client.
async function bonnierHealthcare() {
  const TAG = "Bonnier Healthcare kontakt 2026 (Arvid Ervik)";
  for (const name of ["Dagens Medisin", "Helserevyen"]) {
    const t = await findT(name, "NO");
    if (!t) { console.log(`! ${name} not found`); continue; }
    if (await done(t.id, TAG)) { console.log(`${name}: already`); continue; }
    await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-08: Arvid Ervik (KAM, Bonnier Healthcare, 911 43 560) – før pris trenger han målgruppe (B2C/B2B) + kundenavn (særlig om legemiddelselskap, for å unngå ulik pris til samme kunde). Sendte mediekit (Copy of BHN Media Kit 2026 NO.pdf). Avventer prissvar. " + TAG, actorId: ACTOR });
    await ensureContact(t.publisherId, t.id, { name: "Arvid Ervik", email: "arvid.ervik@bonniernews.no", phone: "911 43 560", role: "Key Account Manager, Bonnier Healthcare", notes: "Ber om målgruppe+kunde før pris (legemiddel = avtalte betingelser). Mediekit BHN 2026. 06-08.", primary: true });
    const oi = new Set([...(t.outstandingInfo ?? []), "Avventer pris – Arvid/Bonnier Healthcare ber om målgruppe (B2C/B2B) + kunde"]);
    await prisma.title.update({ where: { id: t.id }, data: { outstandingInfo: { set: [...oi] } } });
    console.log(`${name}: ← Arvid-kontakt + avventer pris`);
  }
}

async function main() {
  await res();
  await storfjordnytt();
  await rabalderExtra();
  await akersposten50();
  await ruijanKaiku();
  await schibstedMinSpend();
  await husvagn();
  await totensBlad();
  await bonnierHealthcare();
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
