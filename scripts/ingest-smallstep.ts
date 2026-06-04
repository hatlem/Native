/** Ingest Arnt Erik Isaksen's (Small Step Media) reply across their 4 trade
 * sites. annonsørinnhold = "partnerinnhold" (content marketing): 12 500/2 uker,
 * 20 000/4 uker per site (own finished article, video embed allowed). Plus
 * display + newsletter banner rates from the per-site PDFs. Enriches each
 * title with description + keywords + offersNativeContent. */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { storeRateCardDocument, setRateCardOcr } from "@/lib/ratecard/store";
import { ocrPdfDetailed } from "@/lib/ratecard/ocr";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";
import type { ProductType, PriceUnit } from "@prisma/client";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const SOURCE = "email:arnt.erik@smallstep.no";
const DIR = "/tmp/campaign/smallstep";
const CONTACT = { name: "Arnt Erik Isaksen", email: "arnt.erik@smallstep.no", phone: "+47 411 61 619", role: "Salgs- og markedssjef, Small Step Media" };
const POLICY = "Annonsørinnhold merkes «partnerinnhold». Ferdig levert artikkel (tekst+bilder); video kan embeddes (f.eks. YouTube). Ligger høyt på siden + deles i nyhetsbrev i perioden.";

// Display (per month) + newsletter (per week) rates — identical across the
// three sites that shipped a PDF.
const DISPLAY: [string, number][] = [["Toppbanner (pr. mnd)", 20000], ["Artikkelbanner (pr. mnd)", 15000], ["Megaboard 1 (pr. mnd)", 20000], ["Megaboard 2 (pr. mnd)", 10000], ["Boks 1 (pr. mnd)", 10000], ["Boks 2 (pr. mnd)", 5000]];
const NEWSLETTER: [string, number][] = [["Nyhetsbrev toppbanner (pr. uke)", 5000], ["Nyhetsbrev midtbanner (pr. uke)", 3500], ["Nyhetsbrev bunnbanner (pr. uke)", 2500]];

type Site = { id: string; pubId: string; pdf?: string; description: string; keywords: string[]; aliases: string[] };
const SITES: Site[] = [
  { id: "cmpmdiqa201v80hu00hq8n72n", pubId: "cmpmdiq5500bp0hu00wnp41r7", pdf: "Avfallsbransjen.no, annonseformater- og priser.pdf", description: "Nettavis for avfalls- og gjenvinningsbransjen i Norge. B2B-fagmedie fra Small Step Media; nyhetsbrev to ganger ukentlig.", keywords: ["avfall", "gjenvinning", "sirkulærøkonomi", "renovasjon", "B2B", "fagmedie", "partnerinnhold"], aliases: ["Avfallsbransjen"] },
  { id: "cmpmdiqa201vm0hu0vapf6l57", pubId: "cmpmdiq5600c00hu0qevihxes", pdf: "Biogassbransjen.no, annonseformater- og priser.pdf", description: "Nettavis for biogassbransjen i Norge. B2B-fagmedie fra Small Step Media; nyhetsbrev 1–2 ganger ukentlig.", keywords: ["biogass", "fornybar energi", "landbruk", "sirkulærøkonomi", "B2B", "fagmedie", "partnerinnhold"], aliases: ["Biogassbransjen"] },
  { id: "cmpmdiqa401y70hu0f5oxlgmq", pubId: "cmpmdiq5600e50hu0kgbjiybd", pdf: "Hydrogen24.no - Annonsepriser.pdf", description: "Nettavis om hydrogen og hydrogenteknologi i Norge. B2B-fagmedie fra Small Step Media; nyhetsbrev to ganger ukentlig.", keywords: ["hydrogen", "fornybar energi", "grønn omstilling", "energi", "B2B", "fagmedie", "partnerinnhold"], aliases: ["Hydrogen24", "Hydrogen 24"] },
  { id: "cmpmdiqa201w70hu0dm4ydxi7", pubId: "cmpmdiq5600ci0hu05bweh14q", description: "Nettavis fra Small Step Media (B2B-fagmedie). Tilbyr partnerinnhold på lik linje med søsteravisene.", keywords: ["B2B", "fagmedie", "partnerinnhold", "Small Step Media"], aliases: ["Cnytt", "C-nytt"] },
];

async function ingest(s: Site) {
  const tag = s.id.slice(-4);
  const sc = await prisma.salesContact.upsert({
    where: { publisherId_email: { publisherId: s.pubId, email: CONTACT.email } },
    update: { name: CONTACT.name, phone: CONTACT.phone, role: CONTACT.role },
    create: { publisherId: s.pubId, ...CONTACT },
  });
  const existingLink = await prisma.salesContactTitle.findFirst({ where: { titleId: s.id } });
  if (!existingLink) await prisma.salesContactTitle.create({ data: { salesContactId: sc.id, titleId: s.id, isPrimary: true } });

  const inbound = await createContactLog({ titleId: s.id, salesContactId: sc.id, channel: "EMAIL", direction: "INBOUND", contactedAt: new Date("2026-06-04T08:52:00Z"), note: "Svar fra Arnt Erik Isaksen (Small Step Media): annonsørinnhold/partnerinnhold 12 500/2 uker, 20 000/4 uker. Display + nyhetsbrev-rater i PDF. Ferdig artikkel, video embed mulig. Spør antall uker + hvilken annonsør.", actorId: ACTOR });

  let docId: string | undefined;
  if (s.pdf) {
    const buffer = readFileSync(`${DIR}/${s.pdf}`);
    const doc = await storeRateCardDocument({ buffer, fileName: s.pdf, titleId: s.id, publisherId: s.pubId, contactLogId: inbound.id, source: SOURCE, actorId: ACTOR });
    docId = doc.id;
    try { const r = await ocrPdfDetailed(buffer); await setRateCardOcr({ id: doc.id, ocrText: r.text, ocrStatus: r.text ? "DONE" : "FAILED", actorId: ACTOR }); } catch { await setRateCardOcr({ id: doc.id, ocrText: "", ocrStatus: "FAILED", actorId: ACTOR }); }
  }

  const q = (name: string, price: number, type: ProductType, inc: string) => logQuote({ draftProductType: type, draftProductName: name, draftProductDesc: inc, price, priceUnit: "FLAT" as PriceUnit, currency: "NOK", includedText: inc, contactLogId: inbound.id, rateCardDocumentId: docId, recordedById: ACTOR });
  await q("Partnerinnhold / content – 2 uker", 12500, "NATIVE_ARTICLE", "Annonsørinnhold merket «partnerinnhold», 2 uker høyt på siden + nyhetsbrev. Ferdig levert artikkel.");
  await q("Partnerinnhold / content – 4 uker", 20000, "NATIVE_ARTICLE", "Annonsørinnhold merket «partnerinnhold», 4 uker høyt på siden + nyhetsbrev. Ferdig levert artikkel.");
  if (s.pdf) {
    for (const [n, p] of DISPLAY) await q(n, p, "NATIVE_DISPLAY", "Display-banner, pris per måned. HTML5/JPEG/PNG/GIF max 90kB.");
    for (const [n, p] of NEWSLETTER) await q(n, p, "NATIVE_DISPLAY", "Nyhetsbrev-banner, pris per uke.");
  }

  await prisma.title.update({ where: { id: s.id }, data: {
    offersNativeContent: true, ownContentAllowed: "YES", contentPolicy: POLICY,
    description: s.description, keywords: s.keywords, aliases: s.aliases,
    commercialExtra: { source: `${SOURCE} (2026-06-04)`, stillingsannonse: "5000 pr stk (rabatt for flere), vises på alle Small Step-nettaviser + nyhetsbrev", produksjonsbistand: "tilgjengelig på forespørsel" },
    lastVerifiedAt: new Date(),
  } });
  console.log(`  ${tag}: inbound ${inbound.id}${docId ? ", pdf " + docId : ""}, quotes + enrichment done`);
}

async function main() {
  for (const s of SITES) await ingest(s);
  console.log("\nDone.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
