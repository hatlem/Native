/** Ingest Pia Henriksen's (Norges Rytterforbund) reply.
 * - Discontinue Hestesport (nedlagt member magazine, per Pia).
 * - Create rytter.no + nryfstevne.no titles (their actual ad surfaces).
 * - Store media plan PDF (R2+OCR), sales contact, INBOUND log, DISPLAY
 *   banner quotes, reach. They offer DISPLAY ONLY — no native article. */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { storeRateCardDocument, setRateCardOcr } from "@/lib/ratecard/store";
import { ocrPdfDetailed } from "@/lib/ratecard/ocr";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";
import type { PriceUnit } from "@prisma/client";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const PUBLISHER = "cmpmdiq5500920hu0y9hjgeyg"; // Norges Rytterforbund (NO)
const MARKET = "cmpmdiq3o00000hu08iw009x9";
const HESTESPORT = "cmpmdiq9z01r20hu0xjpxxy0c";
const PDF = "/tmp/campaign/rytter/Rytter-Nryfstevne_Medieplan-2026.pdf";
const SOURCE = "email:pia@rytter.no";

async function ensureTitle(name: string, slug: string, url: string, reach: number, extra: any) {
  const existing = await prisma.title.findFirst({ where: { slug } });
  if (existing) {
    await prisma.title.update({ where: { id: existing.id }, data: { digitalReach: reach, websiteUrl: url, ownContentAllowed: "NO", contentPolicy: "Tilbyr kun display-bannere (jpg/png) – ingen native-artikkel / annonsørinnhold.", commercialExtra: extra, lastVerifiedAt: new Date() } });
    return existing.id;
  }
  const t = await prisma.title.create({ data: { name, slug, publisherId: PUBLISHER, marketId: MARKET, countryCode: "NO", category: "Dyr", websiteUrl: url, digitalReach: reach, ownContentAllowed: "NO", contentPolicy: "Tilbyr kun display-bannere (jpg/png) – ingen native-artikkel / annonsørinnhold.", commercialExtra: extra, active: true, lastVerifiedAt: new Date() } });
  return t.id;
}

async function main() {
  // 1) Discontinue Hestesport.
  await prisma.title.update({ where: { id: HESTESPORT }, data: { active: false, discontinuedAt: new Date(), discontinuedNote: "Nedlagt. Var Norges Rytterforbunds medlemsblad. Kilde: Pia Henriksen (NRyF), 2026-06-04." } });
  console.log("Discontinued Hestesport");

  // 2) Sales contact.
  const sc = await prisma.salesContact.upsert({
    where: { publisherId_email: { publisherId: PUBLISHER, email: "pia@rytter.no" } },
    update: { name: "Pia Henriksen", phone: "+47 466 21 995", role: "Administrasjonskoordinator" },
    create: { publisherId: PUBLISHER, name: "Pia Henriksen", email: "pia@rytter.no", phone: "+47 466 21 995", role: "Administrasjonskoordinator" },
  });
  console.log(`SalesContact ${sc.id} (Pia)`);

  // 3) Titles.
  const sharedExtra = { source: `${SOURCE} (2026-06-04)`, offersNativeArticle: false, note: "Kun display-bannere. Alle priser eks. mva, /mnd. Filer jpg/png." };
  const rytterId = await ensureTitle("Rytter.no", "rytter-no", "https://www.rytter.no", 200000, { ...sharedExtra, facebookFollowers: 23000, instagramFollowers: 18000, monthlyPageviews: 200000 });
  const nryfId = await ensureTitle("Nryfstevne.no", "nryfstevne-no", "https://www.nryfstevne.no", 720000, { ...sharedExtra, monthlyPageviews: 720000 });
  for (const id of [rytterId, nryfId]) {
    await prisma.salesContactTitle.upsert({ where: { salesContactId_titleId: { salesContactId: sc.id, titleId: id } }, update: {}, create: { salesContactId: sc.id, titleId: id, isPrimary: true } }).catch(async () => { /* title may already have a link */ });
  }
  console.log(`Titles: rytter.no=${rytterId}, nryfstevne.no=${nryfId}`);

  // 4) INBOUND logs.
  const inboundR = await createContactLog({ titleId: rytterId, salesContactId: sc.id, channel: "EMAIL", direction: "INBOUND", contactedAt: new Date("2026-06-04T08:53:00Z"), note: "Svar fra Pia Henriksen (NRyF): medieplan vedlagt. rytter.no + nryfstevne.no er deres annonseflater (kun display-bannere, ingen native-artikkel). Hestesport nedlagt; Hest og Høver + Norsk Ridesport er ikke deres.", actorId: ACTOR });
  await createContactLog({ titleId: nryfId, salesContactId: sc.id, channel: "EMAIL", direction: "INBOUND", contactedAt: new Date("2026-06-04T08:53:00Z"), note: "Samme svar/medieplan som rytter.no (Pia Henriksen, NRyF). Kun display.", actorId: ACTOR });
  console.log("INBOUND logs on both");

  // 5) Store media plan PDF on rytter.no + OCR.
  const buffer = readFileSync(PDF);
  const doc = await storeRateCardDocument({ buffer, fileName: "Rytter-Nryfstevne_Medieplan-2026.pdf", titleId: rytterId, publisherId: PUBLISHER, contactLogId: inboundR.id, source: SOURCE, actorId: ACTOR });
  try { const r = await ocrPdfDetailed(buffer); await setRateCardOcr({ id: doc.id, ocrText: r.text, ocrStatus: r.text ? "DONE" : "FAILED", actorId: ACTOR }); console.log(`PDF ${doc.id}: OCR ${r.digitalChars}+${r.ocrChars} chars`); }
  catch (e) { console.error("OCR failed", e); await setRateCardOcr({ id: doc.id, ocrText: "", ocrStatus: "FAILED", actorId: ACTOR }); }

  // 6) Quotes (display, FLAT, per month).
  const q = (titleId: string, name: string, price: number) => logQuote({ draftProductType: "NATIVE_DISPLAY", draftProductName: name, draftProductDesc: name, price, priceUnit: "FLAT" as PriceUnit, currency: "NOK", includedText: "Display-banner, pris per måned, eks. mva. Leveres jpg/png.", contactLogId: inboundR.id, rateCardDocumentId: doc.id, recordedById: ACTOR });
  await q(rytterId, "Toppbanner (pr. mnd) – rytter.no", 10000);
  await q(rytterId, "Bunnbanner (pr. mnd) – rytter.no", 3000);
  await q(rytterId, "Artikkelboard (pr. mnd) – rytter.no", 8500);
  await q(nryfId, "Toppbanner (pr. mnd) – nryfstevne.no", 10000);
  await q(nryfId, "Midtbanner (pr. mnd) – nryfstevne.no", 8500);
  console.log("Quotes logged (5)");

  console.log("\nDone. NB: 'Hest og Hover' + 'Norsk Ridesport' har feil rytter.no-URL og er per Pia ikke NRyF – flagget for manuell opprydding.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
