/** 2026-06-09 reply wave from the SE/DK outreach batch. Native prices + routing +
 * commercial terms. Dup-guarded via INBOUND note tag. Verified contact emails only. */
import { prisma } from "@/lib/prisma";
import { createContactLog } from "@/lib/pricing/contact-log";
import { createSalesContact, attachContactToTitle } from "@/lib/pricing/contacts";
import { logQuote } from "@/lib/pricing/quotes";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";

async function findT(name: string, cc: string) {
  return prisma.title.findFirst({ where: { name: { equals: name, mode: "insensitive" }, countryCode: cc }, select: { id: true, name: true, publisherId: true, outstandingInfo: true } });
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
async function logQuotes(titleId: string, qs: Q[], note: string) {
  const log = await createContactLog({ titleId, channel: "EMAIL", direction: "INBOUND", note, actorId: ACTOR });
  for (const q of qs) await logQuote({ draftProductType: q.type, draftProductName: q.name, draftProductDesc: q.desc, contactLogId: log.id, price: q.price, currency: q.cur ?? "SEK", priceUnit: q.unit ?? "FLAT", includedText: note.slice(0, 200), recordedById: ACTOR });
  return log;
}
async function addOutstanding(titleId: string, current: string[] | undefined, item: string) {
  const oi = new Set([...(current ?? []), item]);
  await prisma.title.update({ where: { id: titleId }, data: { outstandingInfo: { set: [...oi] } } });
}

// 1) Dagens Samhälle (SE) — Tobias Wendeler. Native digital 52 000; +print helsida 26 000 (78 000 total).
async function dagensSamhalle() {
  const TAG = "Dagens Samhälle native 2026 (Tobias Wendeler)";
  const t = await findT("Dagens Samhälle", "SE");
  if (!t) { console.log("! Dagens Samhälle not found"); return; }
  if (await done(t.id, TAG)) { console.log("Dagens Samhälle: already"); return; }
  const NOTE = "INBOUND 2026-06-09: Tobias Wendeler (Kundansvarig, Dagens Samhälle, 070-765 67 00). Digital nativeartikel 52 000 SEK exkl moms " +
    "(publicering dagenssamhalle.se sökbar 1 år, native-puff i nyhetsflödet 14 dagar, projektledning+produktion intervju/text/layout, äganderätt). " +
    "Print helsida i 1 utgåva som tillägg +26 000 SEK → digital+print 78 000 SEK. Offert/volymrabatt vid flera artiklar. Uppföljning i augusti. " + TAG;
  await prisma.title.update({ where: { id: t.id }, data: { offersNativeContent: true, commercialExtra: { source: "Tobias Wendeler / Dagens Samhälle, e-post 2026-06-09", currency: "SEK", priceType: "netto_exkl_moms", nativeDigital: 52000, printHelsidaAddon: 26000, digitalPlusPrint: 78000, includes: ["dagenssamhalle.se sökbar 1 år", "native-puff nyhetsflöde 14 dagar", "projektledning+produktion", "äganderätt"], volumeDiscount: true, followUp: "augusti" } } });
  await logQuotes(t.id, [
    { type: "NATIVE_ARTICLE", name: "Digital nativeartikel", price: 52000, desc: "dagenssamhalle.se sökbar 1 år + native-puff 14 dagar + produktion + äganderätt. Exkl moms." },
    { type: "PACKAGE", name: "Digital nativeartikel + helsida print (1 utgåva)", price: 78000, desc: "Digital (52 000) + samma artikel som helsida i 1 utgåva (+26 000). Exkl moms." },
  ], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "Tobias Wendeler", email: "tobias.wendeler@informa.se", phone: "070-765 67 00", role: "Kundansvarig, Dagens Samhälle (Bonnier News)", notes: "Native digital 52 000 / +print 26 000. Uppföljning augusti. 06-09.", primary: true });
  console.log("Dagens Samhälle: ← native 52 000 / 78 000 + Tobias");
}

// 2) Market (SE) — Johan Petersen. Native market.se 40 000/vecka inkl produktion.
async function market() {
  const TAG = "Market native 2026 (Johan Petersen)";
  const t = await findT("Market", "SE");
  if (!t) { console.log("! Market not found"); return; }
  if (await done(t.id, TAG)) { console.log("Market: already"); return; }
  const NOTE = "INBOUND 2026-06-09: Johan Petersen (Försäljningschef Annons, Bonnier News Business, +46705422368). " +
    "Native på market.se 40 000 SEK för en vecka, produktion ingår. " + TAG;
  await prisma.title.update({ where: { id: t.id }, data: { offersNativeContent: true, commercialExtra: { source: "Johan Petersen / Bonnier News Business, e-post 2026-06-09", currency: "SEK", nativePerVecka: 40000, productionIncluded: true } } });
  await logQuotes(t.id, [{ type: "NATIVE_ARTICLE", name: "Native (market.se, per vecka)", price: 40000, desc: "Native på market.se, 1 vecka, produktion ingår." }], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "Johan Petersen", email: "johan.petersen@bbm.bonnier.se", phone: "+46705422368", role: "Försäljningschef Annons, Bonnier News Business", notes: "Native market.se 40 000/vecka inkl produktion. 06-09.", primary: true });
  console.log("Market: ← native 40 000/vecka + Johan");
}

// 3) Byggvärlden (SE) — Jon Öst. Native digital 10 560/vecka (ord 17 600) + print 30% rabatt.
async function byggvarlden() {
  const TAG = "Byggvärlden native 2026 (Jon Öst)";
  const t = await findT("Byggvärlden", "SE");
  if (!t) { console.log("! Byggvärlden not found"); return; }
  if (await done(t.id, TAG)) { console.log("Byggvärlden: already"); return; }
  const NOTE = "INBOUND 2026-06-09: Jon Öst (SP Media, jon.ost@spmedia.se, 072-231 69 08). Native digitalt (redaktionell/annonsmärkt artikel på byggvarlden.se) " +
    "= 10 560 SEK/vecka (ordinarie 17 600). Dubbeltäckning: 7 dagar på site + puff i 4 nyhetsbrev de bokade veckorna. " +
    "Print: samtliga format går att köra som native, 30% rabatt på bifogad prislista (Mediaplan_Byggvarlden_2026). " +
    "Native-specs: bild liggande max 200 kB, rubrik max 50 tecken, ingress max 80, brödtext max 5 000. " + TAG;
  await prisma.title.update({ where: { id: t.id }, data: { offersNativeContent: true, commercialExtra: { source: "Jon Öst / SP Media, e-post 2026-06-09", currency: "SEK", nativeDigitalPerVecka: 10560, nativeDigitalOrdinarie: 17600, dubbeltackning: "7 dgr site + 4 nyhetsbrev", printNativeRabatt: "30%", specs: { bildMaxKb: 200, rubrikTecken: 50, ingressTecken: 80, brodtextTecken: 5000 }, rateCard: "Mediaplan_Byggvarlden_2026 3.0.pdf" } } });
  await logQuotes(t.id, [{ type: "NATIVE_ARTICLE", name: "Native digitalt (per vecka)", price: 10560, desc: "Annonsmärkt artikel byggvarlden.se, 7 dgr site + 4 nyhetsbrev. Ert pris (ord. 17 600)." }], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "Jon Öst", email: "jon.ost@spmedia.se", phone: "072-231 69 08", role: "SP Media (Byggvärlden)", notes: "Native digital 10 560/v (ord 17 600), print 30% rabatt. Rate card bifogad. 06-09.", primary: true });
  console.log("Byggvärlden: ← native 10 560/vecka + Jon");
}

// 4) Journalisten (SE) — Hans Simons. Native nyhetsbrev 26 000 + moms.
async function journalisten() {
  const TAG = "Journalisten nyhetsbrev-native 2026 (Hans Simons)";
  const t = await findT("Journalisten", "SE");
  if (!t) { console.log("! Journalisten not in catalog — noting only (Hans Simons / Annonssäljarna, native nyhetsbrev 26 000+moms, 14k pren 5x/v)"); return; }
  if (await done(t.id, TAG)) { console.log("Journalisten: already"); return; }
  const NOTE = "INBOUND 2026-06-09: Hans Simons (Annonssäljarna, Hans.Simons@annonssaljarna.se). Native-puff (rubrik/ingress/bild) i Journalistens nyhetsbrev " +
    "26 000 SEK + moms. Distribueras må-fre (5 ggr), 14 000 prenumeranter. (Universitetsläraren tillåter ej native.) " + TAG;
  await prisma.title.update({ where: { id: t.id }, data: { offersNativeContent: true, commercialExtra: { source: "Hans Simons / Annonssäljarna, e-post 2026-06-09", currency: "SEK", nativeNyhetsbrev: 26000, momsTillkommer: true, nyhetsbrev: { prenumeranter: 14000, frekvens: "5x/vecka" } } } });
  await logQuotes(t.id, [{ type: "NATIVE_DISPLAY", name: "Native-puff i nyhetsbrev", price: 26000, desc: "Rubrik/ingress/bild i Journalistens nyhetsbrev (14 000 pren, 5x/v). + moms." }], NOTE);
  await ensureContact(t.publisherId, t.id, { name: "Hans Simons", email: "hans.simons@annonssaljarna.se", role: "Annonssäljarna (Journalisten/Universitetsläraren)", notes: "Native nyhetsbrev Journalisten 26 000+moms. 06-09.", primary: true });
  console.log("Journalisten: ← native nyhetsbrev 26 000 + Hans");
}

// 5) Läkartidningen (SE) — Ulf Jansson routed to David Andreasson. Awaiting price.
async function lakartidningen() {
  const TAG = "Läkartidningen routing 2026 (Ulf→David)";
  const t = await findT("Läkartidningen", "SE");
  if (!t) { console.log("! Läkartidningen not found"); return; }
  if (await done(t.id, TAG)) { console.log("Läkartidningen: already"); return; }
  await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-09: Ulf Jansson (Läkartidningen) – hänvisar till kollega David Andreasson (david@informa.se) som återkommer med prisinfo inom kort. " + TAG, actorId: ACTOR });
  await ensureContact(t.publisherId, t.id, { name: "Ulf Jansson", email: "ulf.jansson@lakartidningen.se", role: "Läkartidningen", notes: "Hänvisar till David Andreasson (david@informa.se) för pris. 06-09." });
  await addOutstanding(t.id, t.outstandingInfo, "Avventer pris – David Andreasson (david@informa.se), Läkartidningen");
  console.log("Läkartidningen: ← routing-logg + avventer David");
}

// 6) Galago (SE) — Sofia Olsson, forwarded to chefredaktör Anders. Awaiting.
async function galago() {
  const TAG = "Galago annonsförfrågan 2026 (Sofia→Anders)";
  const t = await findT("Galago", "SE");
  if (!t) { console.log("! Galago not found"); return; }
  if (await done(t.id, TAG)) { console.log("Galago: already"); return; }
  await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-09: Sofia Olsson (Ansvarig förläggare, Galago) – förtydligade att vi vill köpa annonsplats (native/annonsörsinnehåll), inte använda redaktionellt innehåll. Skickar vidare till chefredaktör Anders. Avventer svar. " + TAG, actorId: ACTOR });
  await ensureContact(t.publisherId, t.id, { name: "Sofia Olsson", email: "sofiao@ordfrontforlag.se", role: "Ansvarig förläggare, Galago (Ordfront)", notes: "Vidarebefordrar till chefred. Anders. 06-09.", primary: true });
  await addOutstanding(t.id, t.outstandingInfo, "Avventer svar – chefredaktör Anders, Galago (annonspriser)");
  console.log("Galago: ← förfrågan-logg + avventer Anders");
}

// 7) Forskerforum (DK) — Filip Wallfält. folkeskolen.dk handles OTHER titles, not Forskerforum.
async function forskerforum() {
  const TAG = "Forskerforum/folkeskolen routing 2026 (Filip Wallfält)";
  const t = await findT("Forskerforum (DK)", "DK") ?? await findT("Forskerforum", "DK");
  if (!t) { console.log("! Forskerforum (DK) not found"); return; }
  if (await done(t.id, TAG)) { console.log("Forskerforum: already"); return; }
  await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-09: Filip Wallfält (Partnerchef, folkeskolen.dk, fiwa@folkeskolen.dk, +45 28 77 47 00) – annoncer@folkeskolen.dk dækker Fagbladet Folkeskolen, Gymnasieskolen, Teknisk Landsforbund og Dansk Magisterforening (IKKE Forskerforum – katalog-mapping er feil). Spurte hvilke titler; vi svarte Dansk Magisterforening (+ evt. Gymnasieskolen) for akademisk målgruppe. Produkter: annoncering.folkeskolen.dk/da/products. Avventer pris. " + TAG, actorId: ACTOR });
  await ensureContact(t.publisherId, t.id, { name: "Filip Wallfält", email: "fiwa@folkeskolen.dk", phone: "+45 28 77 47 00", role: "Partnerchef, Fagbladet Folkeskolen", notes: "Dækker Folkeskolen/Gymnasieskolen/Teknisk Landsforbund/Dansk Magisterforening, ikke Forskerforum. Avventer pris for Dansk Magisterforening. 06-09." });
  await addOutstanding(t.id, t.outstandingInfo, "Mapping-feil: annoncer@folkeskolen.dk = ikke Forskerforum; avventer pris Dansk Magisterforening/Gymnasieskolen (Filip Wallfält)");
  console.log("Forskerforum: ← routing-logg + mapping-flagg + avventer Filip");
}

// 8) Populär Astronomi (SE) — Rebecca Forsberg. Fully booked, return December.
async function popularAstronomi() {
  const TAG = "Populär Astronomi fullbokat 2026 (Rebecca)";
  const t = await findT("Populär Astronomi", "SE");
  if (!t) { console.log("! Populär Astronomi not found"); return; }
  if (await done(t.id, TAG)) { console.log("Populär Astronomi: already"); return; }
  await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-09: Rebecca Forsberg (Ställföreträdande redaktör, Populär Astronomi) – fullbokat med annonser i år; rekommenderar att återkomma kring december inför nästa års planering. Ingen pris nu. " + TAG, actorId: ACTOR });
  await ensureContact(t.publisherId, t.id, { name: "Rebecca Forsberg", email: "rebecca@popularastronomi.se", role: "Ställföreträdande redaktör, Populär Astronomi", notes: "Fullbokat 2026; återkom i december. 06-09.", primary: true });
  await addOutstanding(t.id, t.outstandingInfo, "Återkom i december – Populär Astronomi fullbokat i år (Rebecca Forsberg)");
  console.log("Populär Astronomi: ← fullbokat-logg + december-flagg");
}

// 9) Sonic (SE) — annons@sonicmagazine.com BOUNCED (invalid). Flag.
async function sonic() {
  const TAG = "Sonic e-post bounce 2026";
  const t = await findT("Sonic", "SE");
  if (!t) { console.log("! Sonic not found"); return; }
  if (await done(t.id, TAG)) { console.log("Sonic: already"); return; }
  await createContactLog({ titleId: t.id, channel: "EMAIL", direction: "INBOUND", note: "INBOUND 2026-06-09: NDR/bounce – annons@sonicmagazine.com finns inte (550 5.1.351 'No Such User Here', mx2.oderland.com). Outreach nådde ingen. Trenger korrekt annonskontakt for Sonic. " + TAG, actorId: ACTOR });
  await addOutstanding(t.id, t.outstandingInfo, "Trenger korrekt annonskontakt – annons@sonicmagazine.com bouncet (invalid)");
  console.log("Sonic: ← bounce-logg + trenger korrekt kontakt");
}

async function main() {
  await dagensSamhalle();
  await market();
  await byggvarlden();
  await journalisten();
  await lakartidningen();
  await galago();
  await forskerforum();
  await popularAstronomi();
  await sonic();
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
