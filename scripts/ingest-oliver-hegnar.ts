/**
 * One-off ingest of Oliver Brenden's (Hegnar Media) reply to the Admirate
 * price campaign. Stores the two attached PDFs in R2 + OCR, logs an INBOUND
 * contact, records every offered price as a draft PriceQuote (with the right
 * unit), enriches the commercial profile, and marks the two defunct titles
 * (Finansavisen Bil, Kapital IT) as discontinued.
 *
 * Run via the Native service env with DATABASE_URL overridden to the public
 * proxy (so R2 creds are present and the DB is reachable):
 *   railway run --service Native sh -c "export DATABASE_URL='<public>'; pnpm tsx scripts/ingest-oliver-hegnar.ts"
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { storeRateCardDocument, setRateCardOcr } from "@/lib/ratecard/store";
import { ocrPdfDetailed } from "@/lib/ratecard/ocr";
import { createContactLog } from "@/lib/pricing/contact-log";
import { logQuote } from "@/lib/pricing/quotes";
import type { ProductType, PriceUnit } from "@prisma/client";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok"; // superadmin@nativespin.com
const T = {
  finansavisen: "cmpmdiq9t01ig0hu0f5lj7zs5",
  kapital: "cmpmdiq9z01rl0hu0z78xy6wr",
  finansavisenBil: "cmpmdiq9z01qn0hu0bsoxdusv", // discontinue
  kapitalIT: "cmpmdiqab027y0hu0lxensk2e", // discontinue
};
const SALES_OLIVER = "cmpsbkwaa00nq0hh0wlw78f4m";
const SOURCE = "email:oliver.brenden@hegnar.no";
const DIR = "/tmp/campaign/oliver";

type Offer = {
  name: string;
  type: ProductType;
  price: number;
  unit: PriceUnit;
  included: string;
};

const OFFERS: Offer[] = [
  {
    name: "Native (Readpeak)",
    type: "NATIVE_ARTICLE",
    price: 20,
    unit: "CPC",
    included: "Native via Readpeak. CMS, VeV og ekstern. Pris netto per klikk.",
  },
  {
    name: "Premium native — SOV (per uke)",
    type: "NATIVE_ARTICLE",
    price: 60000,
    unit: "FLAT",
    included: "Premium native, SOV-modell, 60 000 kr/uke (brutto). Kun CMS-artikler.",
  },
  {
    name: "Premium native — CPC",
    type: "NATIVE_ARTICLE",
    price: 20,
    unit: "CPC",
    included: "Premium native, CPC-modell, 20 kr/klikk. Kun CMS-artikler.",
  },
  {
    name: "Branded stories (premium video-native)",
    type: "CONTENT_VIDEO",
    price: 1125,
    unit: "CPM",
    included:
      "1125 kr CPM (brutto) + 20 000 kr oppsett. Min. kampanje 300 000 kr. Interaktiv superboard desktop/mobil, kjøres via Ad Manager (RAM + rapporter), kunde-CMS. 1080x1920, maks 60 sek.",
  },
  {
    name: "Studioproduksjon (videointervju + native-artikkel + distribusjon)",
    type: "CONTENT_VIDEO",
    price: 100000,
    unit: "FLAT",
    included:
      "Introtilbud. Videointervju 3–5 min i FA-studio på Smestad, native-artikkel på forsiden av FA.no, video på FA Direkte med kundelogo. Kunden eier alt innhold. Garantert 3000 artikkelvisninger.",
  },
  {
    name: "Event-pakke: Arendalsuka CEO/CFO 2026",
    type: "PACKAGE",
    price: 100000,
    unit: "FLAT",
    included:
      "Studiosending fra Sparebanken Sør, skyskraperannonse i sendingen, intervju i spilleliste på fa.no-front, helside i Finansavisen, lenkepost på LinkedIn/Finansavisen. Forventet videorekkevidde 10 000–15 000 visninger.",
  },
  {
    name: "Event-pakke: Norges mektigste kvinner 2026",
    type: "PACKAGE",
    price: 50000,
    unit: "FLAT",
    included:
      "Korte live/LOT-sendinger fra arrangementet, skyskraperannonse i sendingen, intervju i spilleliste på fa.no-front, lenkepost på LinkedIn/Finansavisen. Forventet videorekkevidde 10 000–15 000 visninger.",
  },
];

const COMMERCIAL_EXTRA = {
  source: `${SOURCE} (2026-06-04)`,
  rateCard: "FA Brand Studio 2026 + Medieinfo Finansavisen 2026",
  contentInDisplay:
    "CPM-modell, superboard-priser + produksjon (ingen fast pris oppgitt). Display varelager, CMS/VeV/ekstern.",
  videoHoydeformat:
    "Annonsørinnhold i høydespiller, standard preroll/OLV-priser. 1080x1920, maks 60 sek. Produsert av Brand Studio eller kunden.",
  tekstproduksjon: "Skreddersydde tekster produsert av FA Brand Studio.",
  catalogNotes:
    "Motor/Finansavisen Bil utgått (del av lørdagsavisen); bilpodkast 'Mil etter Mil' finnes fortsatt. Kapital IT utgått som egen utgave; Kapital har temautgaver AI/Tech (10.04 og 20.11.2026); Finansavisen har IT/Tech som temadag mandager.",
  needsBriefForExactQuote: "annonsør/bransje, budsjettramme, ønsket periode, mål (kjennskap/trafikk/leads)",
};

async function storeAndOcr(fileName: string, fullPath: string, titleId: string, publisherId: string, contactLogId?: string) {
  const buffer = readFileSync(fullPath);
  const doc = await storeRateCardDocument({
    buffer,
    fileName,
    titleId,
    publisherId,
    contactLogId,
    source: SOURCE,
    actorId: ACTOR,
  });
  console.log(`  stored ${fileName} → RateCardDocument ${doc.id} (${doc.sizeBytes} bytes), OCR…`);
  try {
    const res = await ocrPdfDetailed(buffer);
    await setRateCardOcr({ id: doc.id, ocrText: res.text, ocrStatus: res.text ? "DONE" : "FAILED", actorId: ACTOR });
    console.log(`  OCR ${fileName}: ${res.digitalChars} digital + ${res.ocrChars} image chars (${res.pagesOcred} pages)`);
  } catch (e) {
    console.error(`  OCR failed for ${fileName}:`, e);
    await setRateCardOcr({ id: doc.id, ocrText: "", ocrStatus: "FAILED", actorId: ACTOR });
  }
  return doc;
}

async function main() {
  const fin = await prisma.title.findUniqueOrThrow({ where: { id: T.finansavisen }, select: { publisherId: true, name: true } });
  const publisherId = fin.publisherId;
  console.log(`Finansavisen publisherId=${publisherId}`);

  // Locate the two PDFs (names have irregular spacing).
  const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".pdf"));
  const brandStudioFile = files.find((f) => /brandstudio|brand studio/i.test(f));
  const medieinfoFile = files.find((f) => /medieinfo/i.test(f));
  if (!brandStudioFile || !medieinfoFile) throw new Error(`Missing PDFs in ${DIR}: ${files.join(", ")}`);

  // 1) INBOUND contact log on Finansavisen (carries the quotes).
  const inbound = await createContactLog({
    titleId: T.finansavisen,
    salesContactId: SALES_OLIVER,
    channel: "EMAIL",
    direction: "INBOUND",
    contactedAt: new Date("2026-06-04T09:40:00Z"),
    note:
      "Svar fra Oliver Brenden (Hegnar): mediekit + FA Brand Studio 2026. Native/Content-priser (se PriceQuotes). Content i display = CPM (superboard + produksjon, ingen fast pris). Ber om brief (annonsør/budsjett/periode/mål) for presist tilbud. Katalog: Finansavisen Bil + Kapital IT utgått.",
    actorId: ACTOR,
  });
  console.log(`INBOUND contactLog ${inbound.id} on Finansavisen`);

  // 2) Store both PDFs in R2 + OCR (Brand Studio carries the quotes link).
  console.log("Storing PDFs:");
  const brandDoc = await storeAndOcr(brandStudioFile, path.join(DIR, brandStudioFile), T.finansavisen, publisherId, inbound.id);
  await storeAndOcr(medieinfoFile, path.join(DIR, medieinfoFile), T.finansavisen, publisherId, inbound.id);

  // 3) Quotes (draft products) on the inbound log, sourced from the Brand Studio doc.
  for (const o of OFFERS) {
    const q = await logQuote({
      draftProductType: o.type,
      draftProductName: o.name,
      draftProductDesc: o.included,
      price: o.price,
      priceUnit: o.unit,
      currency: "NOK",
      includedText: o.included,
      contactLogId: inbound.id,
      rateCardDocumentId: brandDoc.id,
      recordedById: ACTOR,
    });
    console.log(`  quote ${o.name}: ${o.price} ${o.unit} NOK → ${q.id}`);
  }

  // 4) INBOUND log on Kapital too (same rate card, quotes live on Finansavisen).
  await createContactLog({
    titleId: T.kapital,
    salesContactId: SALES_OLIVER,
    channel: "EMAIL",
    direction: "INBOUND",
    contactedAt: new Date("2026-06-04T09:40:00Z"),
    note: "Samme svar/rate card som Finansavisen (FA Brand Studio 2026) — se Finansavisen for pristilbud. Kapital tema AI/Tech 10.04 og 20.11.2026.",
    actorId: ACTOR,
  });
  console.log("INBOUND contactLog on Kapital");

  // 5) Enrich commercial profile on the two live titles.
  for (const titleId of [T.finansavisen, T.kapital]) {
    await prisma.title.update({
      where: { id: titleId },
      data: {
        ownContentAllowed: "WITH_APPROVAL",
        commercialExtra: COMMERCIAL_EXTRA,
        lastVerifiedAt: new Date(),
      },
    });
  }
  console.log("Updated commercial profile on Finansavisen + Kapital (ownContent=WITH_APPROVAL)");

  // 6) Discontinue the defunct titles.
  await prisma.title.update({
    where: { id: T.finansavisenBil },
    data: {
      active: false,
      discontinuedAt: new Date(),
      discontinuedNote: "Utgått som egen tittel — del av Finansavisens lørdagsavis. Bilpodkast 'Mil etter Mil' finnes fortsatt. Kilde: Oliver Brenden (Hegnar), 2026-06-04.",
    },
  });
  await prisma.title.update({
    where: { id: T.kapitalIT },
    data: {
      active: false,
      discontinuedAt: new Date(),
      discontinuedNote: "Finnes ikke som egen utgave. Kapital har temautgaver om AI/Tech (10.04 og 20.11.2026). Kilde: Oliver Brenden (Hegnar), 2026-06-04.",
    },
  });
  console.log("Discontinued: Finansavisen Bil + Kapital IT");

  console.log("\nDone.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
