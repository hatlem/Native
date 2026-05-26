import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildQuoteNarrative,
  anchorDiscountPct,
  type BuildQuoteNarrativeInput,
} from "./quote-narrative";

function input(
  overrides: Partial<BuildQuoteNarrativeInput> = {},
): BuildQuoteNarrativeInput {
  const productsById = new Map([
    [
      "p1",
      {
        type: "NATIVE_ARTICLE",
        title: {
          name: "Financial Daily",
          publishedRateCard: "30000",
          publishedRateCurrency: "EUR",
        },
      },
    ],
    [
      "p2",
      {
        type: "ADVERTORIAL",
        title: {
          name: "Local Weekly",
          publishedRateCard: null,
          publishedRateCurrency: null,
        },
      },
    ],
  ]);
  return {
    quote: {
      currency: "EUR",
      lines: [
        { id: "l1", productId: "p1", lineTotal: 18000, quantity: 1 },
        { id: "l2", productId: "p2", lineTotal: 5000, quantity: 2 },
      ],
    },
    organization: { name: "Acme Corp" },
    productsById,
    ...overrides,
  };
}

test("buildQuoteNarrative maps lines to titles and product types", () => {
  const out = buildQuoteNarrative(input());
  assert.equal(out.orgName, "Acme Corp");
  assert.equal(out.itemCount, 2);
  assert.equal(out.lines[0].titleName, "Financial Daily");
  assert.equal(out.lines[0].productType, "NATIVE_ARTICLE");
  assert.equal(out.lines[1].titleName, "Local Weekly");
  assert.equal(out.lines[1].productType, "ADVERTORIAL");
});

test("anchor scales with line quantity", () => {
  const out = buildQuoteNarrative(
    input({
      quote: {
        currency: "EUR",
        lines: [{ id: "l1", productId: "p1", lineTotal: 50000, quantity: 3 }],
      },
    }),
  );
  // 30,000 rate card × 3 units = 90,000 anchor
  assert.equal(out.lines[0].anchor?.rateCard, 90000);
  assert.equal(out.lines[0].anchor?.currency, "EUR");
});

test("missing rate card omits the anchor entirely", () => {
  const out = buildQuoteNarrative(input());
  assert.equal(out.lines[1].anchor, null);
});

test("zero or negative rate card omits the anchor", () => {
  const productsById = new Map([
    [
      "p1",
      {
        type: "NATIVE_ARTICLE",
        title: {
          name: "Title",
          publishedRateCard: "0",
          publishedRateCurrency: "EUR",
        },
      },
    ],
  ]);
  const out = buildQuoteNarrative(
    input({
      productsById,
      quote: {
        currency: "EUR",
        lines: [{ id: "l1", productId: "p1", lineTotal: 1000, quantity: 1 }],
      },
    }),
  );
  assert.equal(out.lines[0].anchor, null);
});

test("anchor currency falls back to quote currency when title omits it", () => {
  const productsById = new Map([
    [
      "p1",
      {
        type: "NATIVE_ARTICLE",
        title: {
          name: "Title",
          publishedRateCard: "10000",
          publishedRateCurrency: null,
        },
      },
    ],
  ]);
  const out = buildQuoteNarrative(
    input({
      productsById,
      quote: {
        currency: "SEK",
        lines: [{ id: "l1", productId: "p1", lineTotal: 5000, quantity: 1 }],
      },
    }),
  );
  assert.equal(out.lines[0].anchor?.currency, "SEK");
});

test("unknown product id falls back to id as title and default type", () => {
  const out = buildQuoteNarrative(
    input({
      productsById: new Map(),
      quote: {
        currency: "EUR",
        lines: [{ id: "l1", productId: "p99", lineTotal: 1000, quantity: 1 }],
      },
    }),
  );
  assert.equal(out.lines[0].titleName, "p99");
  assert.equal(out.lines[0].productType, "NATIVE_ARTICLE");
  assert.equal(out.lines[0].anchor, null);
});

test("anchorDiscountPct rounds the saving against the anchor", () => {
  const out = buildQuoteNarrative(input());
  // 30,000 → 18,000 = 40% off
  assert.equal(anchorDiscountPct(out.lines[0]), 40);
});

test("anchorDiscountPct returns null when no anchor", () => {
  const out = buildQuoteNarrative(input());
  assert.equal(anchorDiscountPct(out.lines[1]), null);
});

test("anchorDiscountPct returns null when price is at or above anchor", () => {
  const productsById = new Map([
    [
      "p1",
      {
        type: "NATIVE_ARTICLE",
        title: {
          name: "Title",
          publishedRateCard: "1000",
          publishedRateCurrency: "EUR",
        },
      },
    ],
  ]);
  const out = buildQuoteNarrative(
    input({
      productsById,
      quote: {
        currency: "EUR",
        lines: [{ id: "l1", productId: "p1", lineTotal: 1500, quantity: 1 }],
      },
    }),
  );
  assert.equal(anchorDiscountPct(out.lines[0]), null);
});
