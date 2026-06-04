/** Ingest Jan-Øyvind Kristiansen's (TU Media) reply for TU.no + DIGI.no:
 * demografi PDFs → R2 + OCR, sales contact, INBOUND log, native/brand-story
 * quotes, reach + commercial profile. No reply sent yet (he asked which
 * client — that draft is handled separately). */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { storeRateCardDocument, setRateCardOcr } from "@/lib/ratecard/store";
import { ocrPdfDetailed } from "@/lib/ratecard/ocr";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";
import type { ProductType, PriceUnit } from "@prisma/client";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const SOURCE = "email:jok@tumedia.no";
const DIR = "/tmp/campaign/tumedia";

type Site = {
  key: string; titleId: string; publisherId: string; pdf: string; reach: number;
  premium: number; basic: number;
};
const SITES: Site[] = [
  { key: "TU.no", titleId: "cmpmdiqaa02740hu0wmaem2bd", publisherId: "cmpmdiq5700js0hu0fuiku6bw", pdf: "TU - demografi 2026.pdf", reach: 700000, premium: 55000, basic: 35000 },
  { key: "Digi.no", titleId: "cmpmdiq9y01qa0hu0r405b45z", publisherId: "cmpmdiq55008i0hu0s148hrt6", pdf: "DIGI - demografi 2026.pdf", reach: 300000, premium: 50000, basic: 30000 },
];

const SHARED_EXTRA = {
  source: `${SOURCE} (2026-06-04)`,
  brandStory: "Always-on årsavtale, ubegrenset artikler, 20% SOV + bedriftsprofil/arkiv. 180 000/år eller 15 000 netto/mnd pr nettsted. Samlet begge nettsteder 300 000/år. Basert på kundeleverte artikler.",
  display: "Fullskjerm desktop/mobil + standard formater, visningsbaserte (CPM) priser. Segmentering på TU-seksjoner mulig. Ref: tumedia.no/annonsering/display. MANGLER konkrete CPM-tall.",
  newsletter: "Annonsering i nyhetsbrev til faste ukespriser. MANGLER konkrete tall.",
  production: "TUM Studio kan produsere innhold, eller kunden leverer ferdig. Produksjonskostnad tilkommer hvis ikke ferdig innhold leveres (beløp ikke oppgitt).",
  contact: "Jan-Øyvind Kristiansen, Strategisk KAM, jok@tumedia.no, +47 40 21 37 11",
  wantsMeeting: true,
};

async function ingestSite(s: Site) {
  console.log(`\n=== ${s.key} ===`);
  const sc = await prisma.salesContact.upsert({
    where: { publisherId_email: { publisherId: s.publisherId, email: "jok@tumedia.no" } },
    update: { name: "Jan-Øyvind Kristiansen", phone: "+47 40 21 37 11", role: "Strategisk KAM, TU Media" },
    create: { publisherId: s.publisherId, name: "Jan-Øyvind Kristiansen", email: "jok@tumedia.no", phone: "+47 40 21 37 11", role: "Strategisk KAM, TU Media" },
  });
  // One sales-contact link per title is enforced by the DB. Only link if
  // the title has none yet; otherwise the INBOUND log still attributes to
  // Jan-Øyvind via salesContactId.
  const existingLink = await prisma.salesContactTitle.findFirst({ where: { titleId: s.titleId } });
  if (!existingLink) await prisma.salesContactTitle.create({ data: { salesContactId: sc.id, titleId: s.titleId, isPrimary: true } });
  else console.log(`  (title already has a sales-contact link — keeping it)`);

  const inbound = await createContactLog({
    titleId: s.titleId, salesContactId: sc.id, channel: "EMAIL", direction: "INBOUND",
    contactedAt: new Date("2026-06-04T09:25:00Z"),
    note: `Svar fra Jan-Øyvind Kristiansen (TU Media) for ${s.key}: premium native ${s.premium}/uke (forside 1 uke + artikler + nyhetsbrev), basic ${s.basic} (2 uker forside), Brand Story 180k/år (15k/mnd). Egen eller TUM Studio-produksjon (prod ekstra). Display CPM + nyhetsbrev faste priser (tall mangler). Spør hvilken kunde det gjelder; ønsker møte.`,
    actorId: ACTOR,
  });
  console.log(`  INBOUND ${inbound.id}, salesContact ${sc.id}`);

  const buffer = readFileSync(`${DIR}/${s.pdf}`);
  const doc = await storeRateCardDocument({ buffer, fileName: s.pdf, titleId: s.titleId, publisherId: s.publisherId, contactLogId: inbound.id, source: SOURCE, actorId: ACTOR });
  try { const r = await ocrPdfDetailed(buffer); await setRateCardOcr({ id: doc.id, ocrText: r.text, ocrStatus: r.text ? "DONE" : "FAILED", actorId: ACTOR }); console.log(`  PDF ${doc.id}: OCR ${r.digitalChars}+${r.ocrChars} chars`); }
  catch (e) { console.error("  OCR failed", e); await setRateCardOcr({ id: doc.id, ocrText: "", ocrStatus: "FAILED", actorId: ACTOR }); }

  const offers: { name: string; type: ProductType; price: number; unit: PriceUnit; inc: string }[] = [
    { name: `Premium native (pr. uke) – ${s.key}`, type: "NATIVE_ARTICLE", price: s.premium, unit: "FLAT", inc: "Forside 1 uke + artikler + nyhetsbrev. Egen eller TUM Studio-produksjon (prod. ekstra hvis ikke ferdig innhold)." },
    { name: `Basic native (2 uker forside) – ${s.key}`, type: "NATIVE_ARTICLE", price: s.basic, unit: "FLAT", inc: "Distribueres kun på forsiden i 2 uker." },
    { name: `Brand Story (årsavtale) – ${s.key}`, type: "PACKAGE", price: 180000, unit: "FLAT", inc: "Always-on, ubegrenset artikler, 20% SOV + bedriftsprofil. 180 000/år eller 15 000 netto/mnd pr nettsted. Kundeleverte artikler." },
  ];
  for (const o of offers) {
    const q = await logQuote({ draftProductType: o.type, draftProductName: o.name, draftProductDesc: o.inc, price: o.price, priceUnit: o.unit, currency: "NOK", includedText: o.inc, contactLogId: inbound.id, rateCardDocumentId: doc.id, recordedById: ACTOR });
    console.log(`  quote ${o.name}: ${o.price} ${o.unit} → ${q.id}`);
  }

  await prisma.title.update({ where: { id: s.titleId }, data: { ownContentAllowed: "YES", digitalReach: s.reach, commercialExtra: { ...SHARED_EXTRA, site: s.key, premiumNativePerWeek: s.premium, basicNative2weeks: s.basic, monthlyReaders: s.reach }, lastVerifiedAt: new Date() } });
  console.log(`  Updated reach=${s.reach}, ownContent=YES`);
}

async function main() {
  for (const s of SITES) await ingestSite(s);
  console.log("\nDone.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
