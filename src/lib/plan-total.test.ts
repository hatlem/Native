import { test } from "node:test";
import assert from "node:assert/strict";
import {
  barTotals,
  contentFeeFor,
  estimateListTotals,
  lineDisplay,
  linePrice,
  lineSortValue,
  placementLineTotal,
  planLineCount,
  planTitleIds,
  sumTotalFigures,
  type PlanPricing,
} from "./plan-total";
import {
  computeContentFeeLines,
  computeQuoteLines,
  quoteTotals,
  type ContentFeeRuleSpec,
} from "./money";
import type { UnsentList } from "./lists";
import { defaultContentIntent, placementContentIntent } from "./authorship";
import { customerPrice, productBand } from "./pricing/display-price";
import { contentFeeLinesFor } from "./pricing/production-fee";
import { priceBand } from "./pricing/bands";

type FakeItem = UnsentList["items"][number];

const NO_PRICING: PlanPricing = { feeRules: [], marginRules: [] };

// The rules the E2E run hit: a NO native-display article costs 8 000, any
// other NO product 12 000.
const NO_FEES: ContentFeeRuleSpec[] = [
  { marketCode: "NO", productType: null, currency: "NOK", greenfieldFee: 12000, adaptationFee: 6000, active: true },
  { marketCode: "NO", productType: "NATIVE_DISPLAY", currency: "NOK", greenfieldFee: 8000, adaptationFee: null, active: true },
];

function fakeItem(overrides: {
  productId?: string | null;
  currency?: string;
  basePrice?: number;
  quantity?: number;
  active?: boolean;
  confirmedAt?: Date | null;
  pricesPublic?: boolean | null;
  withContent?: boolean;
  type?: string;
  marketCode?: string;
  vatRatePct?: number;
  priceRules?: { marginPct: number; seasonalMultiplier: number; minVolume: number }[];
  visibility?: "FIRM" | "INDICATIVE";
  pricingModel?: "FLAT" | "CPM" | "CPC";
}): FakeItem {
  const {
    productId = "prod-1",
    currency = "NOK",
    basePrice = 1000,
    quantity = 1,
    active = true,
    confirmedAt = new Date("2026-01-01"),
    pricesPublic = true,
    withContent = false,
    type = "NATIVE_ARTICLE",
    marketCode = "NO",
    vatRatePct = 25,
    priceRules = [],
    // FIRM by default: the arithmetic tests below are about the exact figure,
    // which only an instant-orderable line shows. Banding has its own tests.
    visibility = "FIRM",
    pricingModel = "FLAT",
  } = overrides;
  return {
    productId,
    quantity,
    withContent,
    product: productId
      ? {
          type,
          currency,
          basePrice,
          active,
          confirmedAt,
          visibility,
          pricingModel,
          productionFee: null,
          priceRules,
          title: { pricesPublic, publisher: null, productionFeeDefault: null, market: { code: marketCode, vatRatePct } },
        }
      : null,
  } as unknown as FakeItem;
}

test("sums visible-price lines into a single currency total", () => {
  const items = [
    fakeItem({ basePrice: 1000, quantity: 2 }),
    fakeItem({ basePrice: 500, quantity: 1 }),
  ];
  const totals = estimateListTotals(items, NO_PRICING);
  assert.equal(totals.length, 1);
  assert.equal(totals[0].currency, "NOK");
  // Default 15 % margin, rounded per line like the order: 2 300 + 575.
  assert.equal(totals[0].amount, 2875);
  assert.equal(totals[0].hasOnRequest, false);
  assert.equal(totals[0].hasExact, true);
});

test("splits totals by currency", () => {
  const items = [
    fakeItem({ currency: "NOK", basePrice: 1000 }),
    fakeItem({ currency: "SEK", basePrice: 2000, marketCode: "SE" }),
  ];
  const totals = estimateListTotals(items, NO_PRICING);
  const currencies = totals.map((t) => t.currency).sort();
  assert.deepEqual(currencies, ["NOK", "SEK"]);
});

test("a hidden-price line registers its currency without adding to amount", () => {
  const items = [fakeItem({ currency: "DKK", pricesPublic: false })];
  const totals = estimateListTotals(items, NO_PRICING);
  assert.equal(totals.length, 1);
  assert.equal(totals[0].amount, 0);
  assert.equal(totals[0].hasOnRequest, true);
  assert.equal(totals[0].hasExact, false);
});

test("an unconfirmed product counts as hidden, not visible", () => {
  const items = [fakeItem({ confirmedAt: null })];
  const totals = estimateListTotals(items, NO_PRICING);
  assert.equal(totals[0].amount, 0);
  assert.equal(totals[0].hasOnRequest, true);
});

test("a title placeholder line (no product) is skipped entirely", () => {
  const items = [fakeItem({ productId: null })];
  const totals = estimateListTotals(items, NO_PRICING);
  assert.deepEqual(totals, []);
});

test("empty item list returns no totals", () => {
  assert.deepEqual(estimateListTotals([], NO_PRICING), []);
});

test("estimateListTotals skips recommended alternatives", () => {
  const plan = fakeItem({ productId: "p1", basePrice: 1000 });
  const alt = { ...fakeItem({ productId: "p2", basePrice: 5000 }), isAlternative: true } as FakeItem;
  const [total] = estimateListTotals([plan, alt], NO_PRICING);
  assert.equal(total.itemCount, 1);
  assert.deepEqual(estimateListTotals([alt], NO_PRICING), []);
});

// ── Content fees: the total is what the order charges ──────────────────────

test("a 'We write it' line adds its content fee to the total", () => {
  const items = [fakeItem({ basePrice: 10000, withContent: true, type: "NATIVE_DISPLAY" })];
  const [total] = estimateListTotals(items, { feeRules: NO_FEES, marginRules: [] });
  // 11 500 placement + 8 000 article (the type-specific rule beats the NO wildcard).
  assert.equal(total.contentFees, 8000);
  assert.equal(total.amount, 19500);
});

test("the content fee is one per line, not per insertion", () => {
  const items = [fakeItem({ basePrice: 1000, quantity: 3, withContent: true })];
  const [total] = estimateListTotals(items, { feeRules: NO_FEES, marginRules: [] });
  assert.equal(total.contentFees, 12000);
});

test("no fee without 'We write it', and none when no rule matches (as the order)", () => {
  const off = estimateListTotals([fakeItem({ withContent: false })], { feeRules: NO_FEES, marginRules: [] });
  assert.equal(off[0].contentFees, 0);
  const noRule = estimateListTotals([fakeItem({ withContent: true, marketCode: "SE", currency: "SEK" })], {
    feeRules: NO_FEES,
    marginRules: [],
  });
  assert.equal(noRule[0].contentFees, 0);
});

test("a hidden-price line adds no content fee either", () => {
  const [total] = estimateListTotals([fakeItem({ pricesPublic: false, withContent: true })], {
    feeRules: NO_FEES,
    marginRules: [],
  });
  assert.equal(total.amount, 0);
  assert.equal(total.contentFees, 0);
});

test("VAT is added per placement market and stated separately", () => {
  const items = [fakeItem({ basePrice: 10000, withContent: true, type: "NATIVE_DISPLAY" })];
  const [total] = estimateListTotals(items, { feeRules: NO_FEES, marginRules: [] });
  assert.equal(total.vat, 4875); // 25 % of 19 500
  assert.equal(total.totalInclVat, 24375);
});

test("two EUR markets keep their own VAT rates", () => {
  const items = [
    fakeItem({ currency: "EUR", basePrice: 1000, marketCode: "DE", vatRatePct: 19 }),
    fakeItem({ currency: "EUR", basePrice: 1000, marketCode: "IE", vatRatePct: 23 }),
  ];
  const [total] = estimateListTotals(items, NO_PRICING);
  assert.equal(total.amount, 2300);
  assert.equal(total.totalInclVat, Math.round(1150 * 1.19) + Math.round(1150 * 1.23));
});

test("the plan total equals what the firm order computes for the same lines", () => {
  // Mirror createFirmOrder: computeQuoteLines + contentFeeLinesForGroup +
  // quoteTotals for one market. A market margin rule (not the global default)
  // and a volume tier are both in play, so any drift would show.
  const pricing: PlanPricing = {
    feeRules: NO_FEES,
    marginRules: [{ marketCode: "NO", marginPct: 20, active: true }],
  };
  const tiered = [{ marginPct: 12, seasonalMultiplier: 1.1, minVolume: 2 }];
  const items = [
    fakeItem({ productId: "a", basePrice: 15427, withContent: true, type: "NATIVE_DISPLAY" }),
    fakeItem({ productId: "b", basePrice: 3333, quantity: 2, priceRules: tiered }),
  ];
  const [total] = estimateListTotals(items, pricing);

  const orderLines = [
    ...computeQuoteLines(
      [
        { productId: "a", name: "a", quantity: 1, basePrice: 15427, rules: [] },
        { productId: "b", name: "b", quantity: 2, basePrice: 3333, rules: tiered },
      ],
      20,
    ),
    ...computeContentFeeLines([{ name: "a", productType: "NATIVE_DISPLAY" }], NO_FEES, "NO"),
  ];
  const order = quoteTotals(orderLines, 25);
  assert.equal(total.amount, order.subtotal);
  assert.equal(total.totalInclVat, order.total);
});

test("placementLineTotal and contentFeeFor expose the per-line figures", () => {
  const product = { basePrice: 1000, priceRules: [], title: { market: { code: "NO" } } };
  assert.equal(placementLineTotal(product, 2, []), 2300);
  assert.equal(placementLineTotal(product, 2, [{ marketCode: "NO", marginPct: 10, active: true }]), 2200);
  assert.equal(contentFeeFor({ type: "NATIVE_DISPLAY", inclusions: null }, "NO", NO_FEES), 8000);
  assert.equal(contentFeeFor({ type: "NATIVE_DISPLAY", inclusions: null }, "SE", NO_FEES), 0);
});

test("contentFeeFor follows the cascade: offer fee, then publication fee, then the desk rule", () => {
  assert.equal(contentFeeFor({ type: "NATIVE_ARTICLE", inclusions: null, productionFee: 5000 }, "NO", NO_FEES), 5000);
  assert.equal(
    contentFeeFor(
      { type: "NATIVE_ARTICLE", inclusions: null, productionFee: null, title: { productionFeeDefault: 4000 } },
      "NO",
      NO_FEES,
    ),
    4000,
  );
  // Explicit 0 = the publisher includes production: no fee, not the rule's.
  assert.equal(contentFeeFor({ type: "NATIVE_ARTICLE", inclusions: null, productionFee: 0 }, "NO", NO_FEES), 0);
});

// Who writes it is the buyer's choice, and the fee follows that choice, not
// the product: on a placement the publisher's studio could write (Tungt.no's
// "Advertorial med tekstforfatter", inclusions.production = PUBLISHER), a line
// we write is billed our fee like any other — the desk rule, or the offer's
// own fee. "Let the publisher write it" is simply a line that asks for none.
test("contentFeeFor prices our article on a publisher-capable placement by the normal cascade", () => {
  const publisherCanWrite = { type: "NATIVE_DISPLAY", inclusions: { production: "PUBLISHER" } };
  assert.equal(contentFeeFor(publisherCanWrite, "NO", NO_FEES), 8000);
  assert.equal(contentFeeFor({ ...publisherCanWrite, productionFee: 5000 }, "NO", NO_FEES), 5000);
});

// BUG-buyer-plan-r2-2: the catalog showed Aftenposten's Native display as
// "≈ 25–40k NOK, article included" while the plan and the instant order
// charged 17 741 kr without an article. The band, the plan line (with the
// catalog-add "We write it" default) and the order must price the same thing
// with the same helpers — and the band must contain that price.
test("the catalog band contains the plan line and the order total for the same product + content choice", () => {
  const pricing: PlanPricing = {
    feeRules: NO_FEES,
    marginRules: [{ marketCode: "NO", marginPct: 20, active: true }],
  };
  const cases = [
    { type: "NATIVE_DISPLAY", basePrice: 14784, productionFee: null, productionFeeDefault: null },
    { type: "NATIVE_ARTICLE", basePrice: 30500, productionFee: null, productionFeeDefault: null },
    { type: "NATIVE_ARTICLE", basePrice: 30500, productionFee: 3000, productionFeeDefault: null },
    { type: "ADVERTORIAL", basePrice: 21240, productionFee: null, productionFeeDefault: 6500 },
    { type: "NATIVE_ARTICLE", basePrice: 30500, productionFee: 0, productionFeeDefault: null },
    { type: "NATIVE_ARTICLE", basePrice: 30500, productionFee: null, productionFeeDefault: null, publisherWrites: true },
  ];
  for (const c of cases) {
    const title = {
      pricesPublic: true,
      publisher: null,
      productionFeeDefault: c.productionFeeDefault,
      market: { code: "NO", vatRatePct: 25 },
    };
    const product = {
      id: "p",
      name: "p",
      type: c.type,
      currency: "NOK",
      basePrice: c.basePrice,
      active: true,
      confirmedAt: new Date("2026-01-01"),
      visibility: "FIRM",
      pricingModel: "FLAT",
      productionFee: c.productionFee,
      inclusions: c.publisherWrites ? { production: "PUBLISHER" } : null,
      priceRules: [],
      title,
    };
    // The line a catalog add creates: "We write it" per the add default —
    // on every product, publisher-capable ones included.
    const intent = defaultContentIntent();
    const item = { productId: "p", quantity: 1, withContent: intent.withContent, product } as unknown as FakeItem;

    const band = productBand(product, title, pricing);
    const plan = linePrice(item, pricing);
    assert.ok(band && plan, c.type);
    const order = [
      ...computeQuoteLines([{ productId: "p", name: "p", quantity: 1, basePrice: c.basePrice, rules: [] }], 20),
      ...contentFeeLinesFor(
        [{ productId: "p", withContent: intent.withContent, authorshipMode: intent.authorshipMode }],
        new Map([["p", product]]),
        "NO",
        NO_FEES,
      ),
    ].reduce((sum, l) => sum + l.lineTotal, 0);

    const label = JSON.stringify(c);
    assert.equal(plan.total, order, `plan = order for ${label}`);
    assert.equal(customerPrice(product, title, pricing), plan.total, `band basis = plan for ${label}`);
    assert.deepEqual(priceBand(plan.total, "NOK"), band, `band contains the plan price for ${label}`);

    // The buyer's other choice ("Let the publisher write it" / own copy):
    // the plan and the order still agree, and never exceed the band's basis.
    const off = placementContentIntent(false, product);
    const offPlan = linePrice({ ...item, withContent: off.withContent } as FakeItem, pricing);
    const offFees = contentFeeLinesFor(
      [{ productId: "p", withContent: off.withContent, authorshipMode: off.authorshipMode }],
      new Map([["p", product]]),
      "NO",
      NO_FEES,
    );
    assert.equal(offFees.length, 0, `no fee when we don't write it for ${label}`);
    assert.ok(offPlan && offPlan.contentFee === 0 && offPlan.total <= plan.total, `off ≤ default for ${label}`);
  }
});

// Acceptance criteria from the real ABAX offers (2026-09-30): on a
// publisher-capable placement a line WE write must reproduce the all-in figure
// the offer quoted — placement × 1.15 (default margin) + our fee from the
// market/format rule — on the band basis, the plan line and the order alike.
// Byggmesteren's advertorial carries an explicit productionFee of 0 ("no
// production charge on this offer"), so it stays at 35 075 with the line on.
// Fixtures mirror the prod products (no price rules, no publication fee).
test("ABAX offers: a NativeSpin-written line on a publisher-capable product matches the offer sent", () => {
  const feeRules: ContentFeeRuleSpec[] = [
    { marketCode: "SE", productType: "NATIVE_ARTICLE", currency: "SEK", greenfieldFee: 2000, adaptationFee: null, active: true },
    { marketCode: "NO", productType: "NATIVE_ARTICLE", currency: "NOK", greenfieldFee: 2000, adaptationFee: null, active: true },
    { marketCode: "NO", productType: "ADVERTORIAL", currency: "NOK", greenfieldFee: 1500, adaptationFee: null, active: true },
  ];
  const pricing: PlanPricing = { feeRules, marginRules: [] };
  const offers = [
    { name: "Svensk Åkeritidning — Native-artikel (webb, sponsrad, startsida)", market: "SE", currency: "SEK", type: "NATIVE_ARTICLE", basePrice: 22500, inclusions: { frontpage: true, production: "PUBLISHER" }, productionFee: null, expected: 27875 },
    { name: "Trailer — Native-artikel (trailer.se, 2 veckor)", market: "SE", currency: "SEK", type: "NATIVE_ARTICLE", basePrice: 20000, inclusions: { production: "PUBLISHER", durationWeeks: 2 }, productionFee: null, expected: 25000 },
    { name: "Anlegg & Transport — Native content (publisher-produsert)", market: "NO", currency: "NOK", type: "NATIVE_ARTICLE", basePrice: 49000, inclusions: { production: "PUBLISHER", frontpage: true, newsletter: true }, productionFee: null, expected: 58350 },
    { name: "AnleggsMagasinet — Advertorial med tekstforfatter", market: "NO", currency: "NOK", type: "NATIVE_ARTICLE", basePrice: 15000, inclusions: { production: "PUBLISHER" }, productionFee: null, expected: 19250 },
    { name: "Tungt.no — Advertorial med tekstforfatter", market: "NO", currency: "NOK", type: "NATIVE_ARTICLE", basePrice: 15000, inclusions: { production: "PUBLISHER" }, productionFee: null, expected: 19250 },
    { name: "TransportMagasinet — Advertorial med tekstforfatter", market: "NO", currency: "NOK", type: "NATIVE_ARTICLE", basePrice: 15000, inclusions: { production: "PUBLISHER" }, productionFee: null, expected: 19250 },
    { name: "Yrkestrafikk — Annonsørinnhold print, inkl. produksjon", market: "NO", currency: "NOK", type: "ADVERTORIAL", basePrice: 42300, inclusions: { print: true, production: "PUBLISHER" }, productionFee: null, expected: 50145 },
    { name: "Byggmesteren — Redaksjonell helside (advertorial)", market: "NO", currency: "NOK", type: "ADVERTORIAL", basePrice: 30500, inclusions: { print: true, production: "PUBLISHER" }, productionFee: 0, expected: 35075 },
  ];
  for (const o of offers) {
    const title = {
      pricesPublic: true,
      publisher: null,
      productionFeeDefault: null,
      market: { code: o.market, vatRatePct: 25 },
    };
    const product = {
      id: "p",
      name: o.name,
      type: o.type,
      currency: o.currency,
      basePrice: o.basePrice,
      active: true,
      confirmedAt: new Date("2026-09-29"),
      visibility: "FIRM",
      pricingModel: "FLAT",
      productionFee: o.productionFee,
      inclusions: o.inclusions,
      priceRules: [],
      title,
    };
    const intent = defaultContentIntent();
    assert.equal(intent.authorshipMode, "NATIVESPIN_PRODUCED");
    const item = { productId: "p", quantity: 1, withContent: intent.withContent, product } as unknown as FakeItem;

    const display = lineDisplay(item, pricing);
    assert.equal(display.kind, "exact", o.name);
    assert.equal(display.kind === "exact" && display.total, o.expected, `plan line for ${o.name}`);
    assert.equal(customerPrice(product, title, pricing), o.expected, `band basis for ${o.name}`);
    const order = [
      ...computeQuoteLines([{ productId: "p", name: o.name, quantity: 1, basePrice: o.basePrice, rules: [] }], 15),
      ...contentFeeLinesFor(
        [{ productId: "p", withContent: intent.withContent, authorshipMode: intent.authorshipMode }],
        new Map([["p", product]]),
        o.market,
        feeRules,
      ),
    ].reduce((sum, l) => sum + l.lineTotal, 0);
    assert.equal(order, o.expected, `order for ${o.name}`);
  }
});

// BUG-prod-api-10: "We write it" showed "17 250 placement + 2 000 article"
// under a line figure of 17 250. The line figure is placement + fee, and the
// plan total is exactly the sum of the line figures.
test("linePrice: a We-write-it line's total includes its content fee", () => {
  const pricing: PlanPricing = { feeRules: NO_FEES, marginRules: [] };
  assert.deepEqual(linePrice(fakeItem({ basePrice: 15000, withContent: true }), pricing), {
    placement: 17250,
    contentFee: 12000,
    total: 29250,
  });
  assert.deepEqual(linePrice(fakeItem({ basePrice: 15000 }), pricing), {
    placement: 17250,
    contentFee: 0,
    total: 17250,
  });
});

test("linePrice: one content fee per line whatever the quantity", () => {
  const pricing: PlanPricing = { feeRules: NO_FEES, marginRules: [] };
  assert.deepEqual(linePrice(fakeItem({ basePrice: 1000, quantity: 3, withContent: true }), pricing), {
    placement: 3450,
    contentFee: 12000,
    total: 15450,
  });
});

test("linePrice: null for hidden prices and placeholders, never a 0 figure", () => {
  const pricing: PlanPricing = { feeRules: NO_FEES, marginRules: [] };
  assert.equal(linePrice(fakeItem({ confirmedAt: null, withContent: true }), pricing), null);
  assert.equal(linePrice(fakeItem({ productId: null }), pricing), null);
});

// BUG-prod-api-7: the catalog bar said "3 titles" for a 6-line plan.
test("planLineCount counts placeholders, never alternatives", () => {
  const items = [
    fakeItem({}),
    fakeItem({ productId: null }),
    { ...fakeItem({}), isAlternative: true },
  ];
  assert.equal(planLineCount(items), 2);
});

// BUG-final-local-13: three formats of one title read "3 titles".
test("planTitleIds counts each title once, placeholders included, alternatives never", () => {
  const items = [
    { product: { titleId: "aftenposten" }, titleId: null },
    { product: { titleId: "aftenposten" }, titleId: null },
    { product: { titleId: "aftenposten" }, titleId: null },
    { product: null, titleId: "budstikka" },
    { product: { titleId: "vg" }, titleId: null, isAlternative: true },
  ];
  assert.deepEqual(planTitleIds(items).sort(), ["aftenposten", "budstikka"]);
  assert.equal(planLineCount(items), 4);
});

test("barTotals: server-priced totals, nothing for a currency with no priced line", () => {
  const pricing: PlanPricing = { feeRules: NO_FEES, marginRules: [] };
  const items = [
    fakeItem({ basePrice: 15000, withContent: true }),
    fakeItem({ currency: "SEK", confirmedAt: null }),
  ];
  assert.deepEqual(barTotals(items, pricing), [
    { currency: "NOK", amount: 29250, hasExact: true, estimate: null, itemCount: 1 },
  ]);
});

// ── Exact vs band: the price-display rule before a quote ───────────────────

test("lineDisplay: an instant-orderable (FIRM, shown) line is exact", () => {
  const pricing: PlanPricing = { feeRules: NO_FEES, marginRules: [] };
  assert.deepEqual(lineDisplay(fakeItem({ basePrice: 15000, withContent: true }), pricing), {
    kind: "exact",
    placement: 17250,
    contentFee: 12000,
    total: 29250,
  });
});

test("lineDisplay: a shown INDICATIVE line is its band, never the figure", () => {
  const pricing: PlanPricing = { feeRules: NO_FEES, marginRules: [] };
  // 17 250 + 12 000 article = 29 250 → the 25–40k NOK band, article included.
  const d = lineDisplay(fakeItem({ basePrice: 15000, withContent: true, visibility: "INDICATIVE" }), pricing);
  assert.deepEqual(d, {
    kind: "band",
    band: { kind: "range", low: 25000, high: 40000 },
    range: { low: 25000, high: 40000 },
    withContent: true,
  });
  // Switching "We write it" off drops the article from the band too.
  const off = lineDisplay(fakeItem({ basePrice: 15000, visibility: "INDICATIVE" }), pricing);
  assert.equal(off.kind, "band");
  assert.deepEqual(off.kind === "band" && off.band, { kind: "range", low: 15000, high: 25000 });
});

test("lineDisplay: a FIRM line whose price is hidden is on request, not exact", () => {
  assert.deepEqual(lineDisplay(fakeItem({ pricesPublic: false }), NO_PRICING), { kind: "onRequest" });
  assert.deepEqual(lineDisplay(fakeItem({ confirmedAt: null }), NO_PRICING), { kind: "onRequest" });
  assert.deepEqual(lineDisplay(fakeItem({ productId: null }), NO_PRICING), { kind: "onRequest" });
});

test("lineDisplay: an INDICATIVE CPM line shows its rate, never a band", () => {
  const d = lineDisplay(fakeItem({ basePrice: 300, pricingModel: "CPM", visibility: "INDICATIVE" }), NO_PRICING);
  // 300 × 1.15 = 345 → rounded to the nearest 5.
  assert.deepEqual(d, { kind: "rate", rate: 345, unit: "CPM" });
});

test("lineSortValue: exact figure for exact lines, the band's middle for banded ones", () => {
  assert.equal(lineSortValue({ kind: "exact", placement: 100, contentFee: 0, total: 100 }), 100);
  assert.equal(
    lineSortValue({
      kind: "band",
      band: { kind: "range", low: 25000, high: 40000 },
      range: { low: 25000, high: 40000 },
      withContent: false,
    }),
    32500,
  );
  assert.equal(lineSortValue({ kind: "onRequest" }), null);
});

test("a mixed plan totals the firm lines exactly and bands the rest", () => {
  const pricing: PlanPricing = { feeRules: NO_FEES, marginRules: [] };
  const firm = fakeItem({ productId: "firm", basePrice: 15000 }); // 17 250 exact
  const banded = fakeItem({ productId: "ind", basePrice: 30000, visibility: "INDICATIVE" }); // 34 500 → 25–40k
  const top = fakeItem({ productId: "top", basePrice: 90000, visibility: "INDICATIVE" }); // 103 500 → 90k+
  const hidden = fakeItem({ productId: "hid", confirmedAt: null });

  const [mixed] = estimateListTotals([firm, banded], pricing);
  assert.equal(mixed.amount, 17250);
  assert.equal(mixed.hasExact, true);
  assert.deepEqual(mixed.estimate, { low: 25000, high: 40000 });
  // VAT is exact arithmetic on the exact part only.
  assert.equal(mixed.totalInclVat, Math.round(17250 * 1.25));
  assert.equal(mixed.itemCount, 2);

  const [open] = estimateListTotals([banded, top, hidden], pricing);
  assert.equal(open.hasExact, false);
  assert.equal(open.amount, 0);
  assert.deepEqual(open.estimate, { low: 115000, high: null });
  assert.equal(open.hasOnRequest, true);
});

test("barTotals never carries a banded line's exact estimate", () => {
  const items = [fakeItem({ basePrice: 30000, visibility: "INDICATIVE" })];
  assert.deepEqual(barTotals(items, NO_PRICING), [
    { currency: "NOK", amount: 0, hasExact: false, estimate: { low: 25000, high: 40000 }, itemCount: 1 },
  ]);
});

test("sumTotalFigures adds exact parts and band ranges per currency", () => {
  const sum = sumTotalFigures([
    [{ currency: "NOK", amount: 1000, hasExact: true, estimate: { low: 15000, high: 25000 }, itemCount: 2 }],
    [
      { currency: "NOK", amount: 0, hasExact: false, estimate: { low: 0, high: 15000 }, itemCount: 1 },
      { currency: "SEK", amount: 500, hasExact: true, estimate: null, itemCount: 1 },
    ],
  ]);
  assert.deepEqual(sum, [
    { currency: "NOK", amount: 1000, hasExact: true, estimate: { low: 15000, high: 40000 }, itemCount: 3 },
    { currency: "SEK", amount: 500, hasExact: true, estimate: null, itemCount: 1 },
  ]);
});

test("estimateListTotals is exactly the sum of the linePrice totals", () => {
  const pricing: PlanPricing = { feeRules: NO_FEES, marginRules: [] };
  const items = [
    fakeItem({ basePrice: 15000, withContent: true }),
    fakeItem({ basePrice: 9000, quantity: 2, type: "NATIVE_DISPLAY", withContent: true }),
    fakeItem({ basePrice: 4000 }),
    fakeItem({ confirmedAt: null, withContent: true }),
  ];
  const lineSum = items.reduce((sum, i) => sum + (linePrice(i, pricing)?.total ?? 0), 0);
  const [total] = estimateListTotals(items, pricing);
  assert.equal(total.amount, lineSum);
  assert.equal(total.contentFees, 12000 + 8000);
});
