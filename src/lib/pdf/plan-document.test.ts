import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFParse } from "pdf-parse";
import type { SharedList } from "@/lib/list-share";
import type { ContentFeeRuleSpec } from "@/lib/money";
import { formatMoney } from "@/lib/money";
import { estimateListTotals, lineDisplay, linePrice, type PlanPricing } from "@/lib/plan-total";
import { lineBreakdown } from "@/lib/plan-line-text";
import { lineFigureLabel, totalLabel } from "@/lib/pricing/total-label";
import { DEFAULT_EXTRA_WORK_RATES } from "@/lib/pricing/extra-work";
import enMessages from "@/messages/en.json";
import noMessages from "@/messages/no.json";
import { buildPlanDocument, planDocumentFilename, type PlanDocumentInput } from "./plan-document";
import { PlanDocumentPdf } from "./PlanDocument";
import { renderPlanDocx } from "./plan-docx";
import { zipEntry } from "./zip-entry";

// The downloaded plan must say what /plan and the share page say: the same
// display decision per line (lineDisplay), the same wording (lineFigureLabel,
// lineBreakdown), the same total (estimateListTotals + totalLabel). And a line
// the page shows as a band must not leak its estimate anywhere in the model,
// the Word file or the PDF.

const FEES: ContentFeeRuleSpec[] = [
  { marketCode: "NO", productType: null, currency: "NOK", greenfieldFee: 7000, adaptationFee: null, active: true },
];
const PRICING: PlanPricing = { feeRules: FEES, marginRules: [] };

type Item = SharedList["items"][number];

const publisher = { name: "A2 Media AS", pricesPublic: true };

function product(o: {
  basePrice: number;
  visibility?: "FIRM" | "INDICATIVE";
  confirmed?: boolean;
  pricingModel?: "FLAT" | "CPM";
  inclusions?: unknown;
  name: string;
  domain: string;
  reach?: number | null;
}) {
  return {
    type: "NATIVE_ARTICLE",
    bookingUnit: "MONTH",
    basePrice: o.basePrice,
    currency: "NOK",
    active: true,
    confirmedAt: o.confirmed === false ? null : new Date("2026-06-01"),
    visibility: o.visibility ?? "FIRM",
    pricingModel: o.pricingModel ?? "FLAT",
    productionFee: null,
    inclusions: o.inclusions ?? null,
    priceRules: [],
    title: {
      name: o.name,
      websiteUrl: `https://www.${o.domain}`,
      aliases: [],
      digitalReach: o.reach ?? null,
      monthlyReach: null,
      pricesPublic: true,
      productionFeeDefault: null,
      publisher,
      market: { code: "NO", vatRatePct: 25 },
    },
  };
}

let seq = 0;
// Loosely typed on purpose: fixtures set only what the line needs, and Prisma's
// enum types (MarketCode, BookingUnit) would otherwise need a cast per field.
function item(o: { product?: ReturnType<typeof product> | null; [field: string]: unknown }): Item {
  seq += 1;
  return {
    id: `item-${seq}`,
    productId: o.product ? `prod-${seq}` : null,
    titleId: o.product ? null : `title-${seq}`,
    quantity: 1,
    withContent: true,
    scheduleStart: null,
    scheduleUnits: null,
    notes: null,
    isAlternative: false,
    title: null,
    ...o,
  } as unknown as Item;
}

// A mixed plan: every kind of line the page can show.
const exact = item({
  product: product({ basePrice: 40000, name: "Anlegg & Transport", domain: "at.no", reach: 100000 }),
  quantity: 2,
  scheduleStart: new Date("2026-10-01T00:00:00Z"),
  scheduleUnits: 2,
  notes: "Run in the machinery issue",
});
const band = item({
  product: product({ basePrice: 29000, visibility: "INDICATIVE", name: "Anleggsmaskinen", domain: "anleggsmaskinen.no" }),
});
const onRequest = item({
  product: product({ basePrice: 18000, confirmed: false, name: "Bygg.no", domain: "bygg.no" }),
  withContent: false,
});
const publisherWrites = item({
  product: product({
    basePrice: 20000,
    inclusions: { production: "PUBLISHER" },
    name: "Byggmesteren",
    domain: "byggmesteren.as",
  }),
  withContent: false,
});
const rate = item({
  product: product({ basePrice: 300, pricingModel: "CPM", visibility: "INDICATIVE", name: "TU", domain: "tu.no" }),
});
const placeholder = item({
  product: null,
  title: { name: "Yrkestrafikk", websiteUrl: "https://ytf.no", aliases: [], publisher: { name: "A2 Media AS" } },
  notes: "Ask for the print edition too",
});
const alternative = item({
  product: product({ basePrice: 50000, visibility: "INDICATIVE", name: "Finansavisen", domain: "finansavisen.no" }),
  isAlternative: true,
});
const items = [exact, band, onRequest, publisherWrites, rate, placeholder, alternative];

const list = {
  id: "list-1",
  name: "ABAX trade press: Q4 / 2026",
  organizationId: "org-1",
  archivedAt: null,
  clientApprovedAt: null,
  clientApprovedVersion: null,
  waveNumber: null,
  articleId: null,
  article: null,
  items,
  programme: null,
  organization: { name: "ABAX Norge", marketCode: "NO" },
} as unknown as SharedList;

const input = (overrides: Partial<PlanDocumentInput> = {}): PlanDocumentInput => ({
  list,
  brief: {
    briefText: "Fleet tracking for contractors",
    briefTiming: "2026-Q4",
    budget: 180000,
    currency: "NOK",
    targetAudience: "construction-property-pros,b2b-decision-makers",
    targetGeo: "Norway",
    targetContext: null,
    targetVerticals: null,
  },
  pricing: PRICING,
  locale: "en",
  audience: "team",
  link: { kind: "plan", url: "https://www.nativespin.com/en/plan/list-1" },
  generatedAt: new Date("2026-09-30T10:00:00Z"),
  timeZone: "Europe/Oslo",
  extraWorkRates: DEFAULT_EXTRA_WORK_RATES,
  ...overrides,
});

const en = enMessages;

test("every line carries the page's own display decision and wording", () => {
  const doc = buildPlanDocument(input());
  const [planSection, altSection] = doc.sections;
  assert.equal(planSection.key, "plan");
  assert.equal(altSection.key, "alternatives");
  assert.equal(altSection.heading, en.shareList.alternativesHeading);
  assert.deepEqual(
    planSection.rows.map((r) => r.itemId),
    [exact, band, onRequest, publisherWrites, rate, placeholder].map((i) => i.id),
  );
  assert.deepEqual(altSection.rows.map((r) => r.itemId), [alternative.id]);

  for (const [i, row] of [...planSection.rows, ...altSection.rows].entries()) {
    const it = [...items.filter((x) => !x.isAlternative), alternative][i];
    if (!it.product) {
      assert.equal(row.display, null);
      assert.equal(row.price, en.planDocument.priceOnRequest);
      assert.equal(row.status, en.planDocument.statusPlaceholder);
      continue;
    }
    const display = lineDisplay(it, PRICING);
    assert.deepEqual(row.display, display);
    assert.equal(row.price, lineFigureLabel(display, "NOK", "en", en.planDocument.priceOnRequest));
  }

  const kinds = planSection.rows.map((r) => r.display?.kind ?? "placeholder");
  assert.deepEqual(kinds, ["exact", "band", "onRequest", "exact", "rate", "placeholder"]);
  assert.equal(altSection.rows[0].display?.kind, "band");
});

test("exact lines explain themselves like /plan; authorship reads like the share page", () => {
  const doc = buildPlanDocument(input());
  const [exactRow, bandRow, , publisherRow] = doc.sections[0].rows;
  const tPlan = (key: string, values?: Record<string, string | number>) => {
    let s = (en.plan as Record<string, unknown>)[key] as string;
    for (const [k, v] of Object.entries(values ?? {})) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
  const tv = (key: string) => (en.priceVisibility as Record<string, string>)[key];

  // 2 × placement + one article fee, split exactly as the line card splits it.
  assert.equal(
    exactRow.priceDetail,
    lineBreakdown(
      { display: exactRow.display!, quantity: 2, withContent: true, publisherCanWrite: false, currency: "NOK" },
      "en",
      tPlan,
      tv,
    ),
  );
  assert.match(exactRow.details ?? "", /2 placements · Article written by NativeSpin · .* · 2 months/);
  assert.equal(exactRow.note, "Run in the machinery issue");
  assert.equal(exactRow.status, en.planDocument.statusExact);
  assert.equal(exactRow.reach, "100,000 readers/month");
  assert.equal(exactRow.firm, true);

  assert.equal(bandRow.priceDetail, en.priceVisibility.productionIncluded);
  assert.equal(bandRow.status, en.priceVisibility.listIndicative);
  assert.equal(bandRow.firm, false);

  assert.equal(publisherRow.details, en.shareList.publisherWritesIt);
  assert.equal(publisherRow.status, en.planDocument.statusExact);
});

test("the total is the page's total, and the exact part's VAT only", () => {
  const doc = buildPlanDocument(input());
  const [total] = estimateListTotals(items, PRICING);
  assert.equal(doc.total.rows.length, 1);
  assert.equal(doc.total.rows[0].figure, `${totalLabel(total, "en")} ${en.plan.exVat}`);
  assert.ok(total.hasExact && total.estimate, "fixture mixes exact and banded lines");
  assert.deepEqual(doc.total.rows[0].notes, [
    en.plan.inclVatFirmPart.replace("{amount}", formatMoney(total.totalInclVat, "NOK", "en")),
  ]);
  assert.deepEqual(doc.total.notes, [en.priceVisibility.plusOnRequest, en.plan.estimateNote]);
});

test("article scope: listed once when NativeSpin writes a line, typical length without a spec", () => {
  const doc = buildPlanDocument(input());
  assert.equal(doc.articleScope?.heading, en.articleScope.heading);
  assert.deepEqual(doc.articleScope?.lines, [
    "An average native article (about 600–900 words)",
    "Your brief plus one revision round before approval",
    "Labelled following the publication's rules for advertiser content",
    `Interviews, images, extra revision rounds and other extra work are billed per hour: ${formatMoney(1650, "NOK", "en")}/hour`,
  ]);

  // No line we write (the buyer or the publisher writes every one): no block.
  const noneWritten = { ...list, items: [onRequest, publisherWrites] } as unknown as SharedList;
  assert.equal(buildPlanDocument(input({ list: noneWritten })).articleScope, null);
});

test("article scope: the format's spec sets the length and the marking; stated rounds win", async () => {
  const spec = { wordCountMin: 500, wordCountMax: 700, disclosureLabel: "Annonsørinnhold" };
  const written = item({
    product: {
      ...product({ basePrice: 40000, name: "Anlegg & Transport", domain: "at.no", inclusions: { revisionRounds: 2 } }),
      spec,
    } as unknown as ReturnType<typeof product>,
  });
  const withSpec = { ...list, items: [written] } as unknown as SharedList;
  const doc = buildPlanDocument(input({ list: withSpec, locale: "no" }));
  assert.deepEqual(doc.articleScope?.lines.slice(0, 3), [
    "En gjennomsnittlig native-artikkel (500–700 ord)",
    "Brief og 2 revisjonsrunder før godkjenning",
    "Merket «Annonsørinnhold» etter publikasjonens regler for annonsørinnhold",
  ]);

  // Both renderers print it.
  const docx = zipEntry(await renderPlanDocx(doc), "word/document.xml");
  assert.ok(docx.includes(noMessages.articleScope.heading));
  assert.ok(docx.includes("500–700 ord"));
  const parser = new PDFParse({ data: new Uint8Array(await renderToBuffer(PlanDocumentPdf({ doc }))) });
  const pdf = (await parser.getText()).text;
  await parser.destroy();
  assert.ok(pdf.includes(noMessages.articleScope.heading));
});

test("the brief is the team's; the client's copy is the share page, with the share link", () => {
  const team = buildPlanDocument(input());
  assert.deepEqual(team.brief?.entries, [
    { label: "Campaign", value: "Fleet tracking for contractors" },
    { label: "Timing", value: "Q4 2026" },
    { label: "Budget", value: formatMoney(180000, "NOK", "en") },
    { label: "Audience segments", value: "Construction & property pros, B2B decision-makers" },
    { label: "Geographic focus", value: "Norway" },
  ]);
  assert.equal(team.link.lead, en.planDocument.linkPlan);
  assert.equal(team.link.invite, en.planDocument.linkInvite);

  const client = buildPlanDocument(
    input({ audience: "client", link: { kind: "share", url: "https://www.nativespin.com/en/share/tok" } }),
  );
  assert.equal(client.brief, null);
  assert.equal(client.link.lead, en.planDocument.linkShare);
  assert.equal(client.link.invite, null);
  assert.equal(client.sections[1].intro, en.shareList.alternativesIntro);
  assert.doesNotMatch(JSON.stringify(client), /180[,. \u00a0]?000|Fleet tracking/);
});

test("localized: Norwegian labels, Norwegian number format, org-market date", () => {
  const doc = buildPlanDocument(input({ locale: "no" }));
  assert.equal(doc.columns.publication, noMessages.planDocument.colPublication);
  assert.equal(doc.sections[0].rows[0].reach, "100 000 lesere/mnd");
  assert.equal(doc.sections[0].rows[2].price, noMessages.planDocument.priceOnRequest);
  assert.match(doc.meta, /^Utarbeidet for ABAX Norge · 30\. september 2026$/);
  assert.ok(doc.prices.lines.some((l) => l.includes(noMessages.priceVisibility.listIndicative)));
});

test("filename: brand, plan name and date, with unsafe characters dropped", () => {
  const doc = buildPlanDocument(input());
  assert.equal(doc.filename, "NativeSpin – ABAX trade press Q4 2026 – 2026-09-30");
  // After 22:00 UTC it is already the next day in Oslo.
  assert.equal(
    planDocumentFilename('  a/b\\c:"d"  ', new Date("2026-09-30T22:30:00Z"), "Europe/Oslo"),
    "NativeSpin – a b c d – 2026-10-01",
  );
  assert.equal(planDocumentFilename("///", new Date("2026-09-30T10:00:00Z"), "Europe/Oslo"), "NativeSpin – 2026-09-30");
});

// Every way a hidden figure could be printed: the estimate a band stands in
// for, in each locale's grouping, and the raw digits.
function hiddenFigures(): string[] {
  const hidden = [band, alternative].flatMap((i) => {
    const p = linePrice(i, PRICING)!;
    return [p.total, p.placement, Number(i.product!.basePrice)];
  });
  return hidden.flatMap((n) => [
    String(n),
    formatMoney(n, "NOK", "en"),
    formatMoney(n, "NOK", "no"),
    new Intl.NumberFormat("en-GB").format(n),
    new Intl.NumberFormat("nb-NO").format(n),
  ]);
}

test("no hidden exact figure leaks into the model, the Word file or the PDF", async () => {
  const figures = hiddenFigures();
  // The fixture's hidden figures really are hidden: none is shown exactly.
  const shownExact = [exact, publisherWrites].map((i) => linePrice(i, PRICING)!.total);
  assert.ok(figures.every((f) => !shownExact.map(String).includes(f)));

  for (const locale of ["en", "no"]) {
    const doc = buildPlanDocument(input({ locale }));
    const model = JSON.stringify(doc);
    const docx = zipEntry(await renderPlanDocx(doc), "word/document.xml");
    const parser = new PDFParse({ data: new Uint8Array(await renderToBuffer(PlanDocumentPdf({ doc }))) });
    const pdf = (await parser.getText()).text;
    await parser.destroy();

    // The renderers really carry the plan (the leak check isn't vacuous).
    for (const text of [docx, pdf]) {
      assert.ok(text.includes("Anleggsmaskinen"), `${locale}: band line rendered`);
      assert.ok(text.includes("≈ 40–60k NOK"), `${locale}: band shown as its band`);
    }
    for (const f of figures) {
      assert.ok(!model.includes(f), `${locale}: model leaks ${f}`);
      assert.ok(!docx.includes(f), `${locale}: docx leaks ${f}`);
      assert.ok(!pdf.includes(f), `${locale}: pdf leaks ${f}`);
    }
  }
});
