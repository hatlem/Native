/** Ingest Eirik Andreassen's (NTFs Tidende) reply: media plan PDF → R2 + OCR,
 * sales contact, INBOUND + OUTBOUND (thank-you) contact logs, price quotes,
 * content policy + circulation. Canonical title only. */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { storeRateCardDocument, setRateCardOcr } from "@/lib/ratecard/store";
import { ocrPdfDetailed } from "@/lib/ratecard/ocr";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";
import type { ProductType, PriceUnit } from "@prisma/client";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const TITLE = "cmpmdiqa201we0hu07ls2kktr"; // Den norske tannlegeforenings Tidende
const PUBLISHER = "cmpmdiq5600cp0hu0eo5zts4u"; // Tannlegeforeningen (NO)
const PDF = "/tmp/campaign/tannlege/medieplan_2026_NO.pdf";
const SOURCE = "email:eirik.andreassen@tannlegeforeningen.no";

type Offer = { name: string; type: ProductType; price: number; unit: PriceUnit; included: string };
const OFFERS: Offer[] = [
  { name: "Annonsørinnhold / advertorial – helside (1/1) print", type: "ADVERTORIAL", price: 22000, unit: "FLAT",
    included: "Helside 1/1 print (210x270 + bleed). Må merkes «Annonse» øverst + logo/firmanavn. Eks. mva. Byråprovisjon 3,5%." },
  { name: "Print dobbeltside", type: "ADVERTORIAL", price: 41500, unit: "FLAT", included: "Dobbeltside print. Eks. mva." },
  { name: "Nettannonse – toppbanner (pr. mnd)", type: "NATIVE_DISPLAY", price: 9000, unit: "FLAT",
    included: "Toppbanner på tannlegetidende.no, pris per måned. Eks. mva. (Banner alle sider 8000, forside 7000, popup 9000.)" },
  { name: "Rubrikkannonse 1/1 (web + print)", type: "ADVERTORIAL", price: 20500, unit: "FLAT",
    included: "Rubrikk 1/1, samme pris web/print, legges også ut på web. Eks. mva." },
];

const COMMERCIAL_EXTRA = {
  source: `${SOURCE} (2026-06-04)`,
  rateCard: "Medieplan 2026 NO (tannlegetidende.no)",
  printDisplayNOK: { "1/1": 22000, "2/3": 18100, "1/2": 13900, "1/3": 12350, "1/4": 10600, "1/6": 7800, "1/8": 6600, dobbeltside: 41500 },
  specialPlacementNOK: { "2.omslag": 23400, vedLeder: 23400, vedPresidenten: 23400, "3.omslag": 22400, baksiden: 24400, stripeSisteNytt: 7700 },
  webPerMonthNOK: { toppbanner: 9000, bannerAlleSider: 8000, bannerForside: 7000, popup: 9000 },
  rubrikkNOK: { "1/16": 2000, "1/8": 3700, "1/4": 7100, "1/2": 13600, "1/1": 20500 },
  spesialistannonse: "4800 (4 innrykk + fast på nett)",
  bilagPerEks: { under30g: 8, over30g: 9 },
  byraaprovisjon: "3,5%",
  newsletterPrices: "på forespørsel (kontakt Eirik) — MANGLER",
  bannerFormats: "på forespørsel",
  opplag: { foreningsabonnement: 6111, betalt: 64, gratis: 200, distribuertTotalt: 6375, kilde: "Fagpressens Mediekontroll" },
  deadlines: "Bestillingsfrist august-utgave 18.8; materiell frem til 9. august. Eirik har ferie i juli.",
  allePriserEksMva: true,
  notes: "Eirik dekker NTFs Tidende. Tenner & Helse + Tannstikka ikke dekket av denne planen (egne kontakter/priser mangler).",
};

async function main() {
  // Sales contact (upsert on publisher+email).
  const sc = await prisma.salesContact.upsert({
    where: { publisherId_email: { publisherId: PUBLISHER, email: "eirik.andreassen@tannlegeforeningen.no" } },
    update: { name: "Eirik Andreassen", phone: "+47 977 585 27", role: "Markedsansvarlig, NTFs Tidende" },
    create: { publisherId: PUBLISHER, name: "Eirik Andreassen", email: "eirik.andreassen@tannlegeforeningen.no", phone: "+47 977 585 27", role: "Markedsansvarlig, NTFs Tidende" },
  });
  await prisma.salesContactTitle.upsert({
    where: { salesContactId_titleId: { salesContactId: sc.id, titleId: TITLE } },
    update: {}, create: { salesContactId: sc.id, titleId: TITLE, isPrimary: true },
  });
  console.log(`SalesContact ${sc.id} (Eirik) linked to title`);

  // INBOUND log carrying the reply.
  const inbound = await createContactLog({
    titleId: TITLE, salesContactId: sc.id, channel: "EMAIL", direction: "INBOUND",
    contactedAt: new Date("2026-06-04T08:54:00Z"),
    note: "Svar fra Eirik Andreassen: full medieplan 2026 (print + web) vedlagt PDF. Advertorials må merkes «Annonse» + logo/firmanavn. Bestillingsfrist august 18.8, materiell til 9.8, ferie i juli. Priser logget som tilbud.",
    actorId: ACTOR,
  });
  console.log(`INBOUND contactLog ${inbound.id}`);

  // OUTBOUND log for the thank-you already sent via Outlook.
  await createContactLog({
    titleId: TITLE, salesContactId: sc.id, channel: "EMAIL", direction: "OUTBOUND",
    note: "Sendt kort takkemelding (utgående): takket for medieplanen, bekreftet at vi noterer merkereglene, kommer tilbake før august-fristen. Ingen ny info etterspurt.",
    actorId: ACTOR,
  });
  console.log("OUTBOUND thank-you logged");

  // Store + OCR the media plan PDF.
  const buffer = readFileSync(PDF);
  const doc = await storeRateCardDocument({ buffer, fileName: "medieplan_2026_NO.pdf", titleId: TITLE, publisherId: PUBLISHER, contactLogId: inbound.id, source: SOURCE, actorId: ACTOR });
  console.log(`Stored PDF → RateCardDocument ${doc.id} (${doc.sizeBytes} bytes), OCR…`);
  try {
    const res = await ocrPdfDetailed(buffer);
    await setRateCardOcr({ id: doc.id, ocrText: res.text, ocrStatus: res.text ? "DONE" : "FAILED", actorId: ACTOR });
    console.log(`OCR: ${res.digitalChars} digital + ${res.ocrChars} image chars (${res.pagesOcred} pages)`);
  } catch (e) { console.error("OCR failed:", e); await setRateCardOcr({ id: doc.id, ocrText: "", ocrStatus: "FAILED", actorId: ACTOR }); }

  // Quotes.
  for (const o of OFFERS) {
    const q = await logQuote({ draftProductType: o.type, draftProductName: o.name, draftProductDesc: o.included, price: o.price, priceUnit: o.unit, currency: "NOK", includedText: o.included, contactLogId: inbound.id, rateCardDocumentId: doc.id, recordedById: ACTOR });
    console.log(`  quote ${o.name}: ${o.price} ${o.unit} → ${q.id}`);
  }

  // Commercial profile + circulation.
  await prisma.title.update({
    where: { id: TITLE },
    data: {
      ownContentAllowed: "WITH_APPROVAL",
      contentPolicy: "Advertorials/annonsørinnhold må merkes «Annonse» øverst, og logo/firmanavn må være med.",
      circulation: 6375,
      commercialExtra: COMMERCIAL_EXTRA,
      lastVerifiedAt: new Date(),
    },
  });
  console.log("Updated commercial profile + circulation on Tidende");
  console.log("\nDone.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
