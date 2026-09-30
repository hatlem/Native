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

test("a content-fee line is labelled with the title of the placement it writes for", () => {
  const out = buildQuoteNarrative(
    input({
      quote: {
        currency: "NOK",
        lines: [
          { id: "l1", productId: "p1", description: "Financial Daily — Native article", lineTotal: 18000, quantity: 1 },
          { id: "l2", productId: "p2", description: "Local Weekly — Advertorial", lineTotal: 5000, quantity: 1 },
          { id: "f1", kind: "CONTENT_FEE", productId: null, description: "Content production — Financial Daily — Native article", lineTotal: 12000, quantity: 1 },
          { id: "f2", kind: "CONTENT_FEE", productId: null, description: "Content production — Local Weekly — Advertorial", lineTotal: 8000, quantity: 1 },
          { id: "f3", kind: "CONTENT_FEE", productId: null, description: "Content production — Gone Title", lineTotal: 1, quantity: 1 },
        ],
      },
    }),
  );
  const fees = out.lines.filter((l) => l.kind === "CONTENT_FEE");
  assert.deepEqual(
    fees.map((l) => [l.titleName, l.productType, l.productId]),
    [
      ["Financial Daily", "CONTENT_FEE", null],
      ["Local Weekly", "CONTENT_FEE", null],
      // No matching placement: empty, never a raw id or description.
      ["", "CONTENT_FEE", null],
    ],
  );
  assert.equal(out.lines[0].productId, "p1");
  // Each fee names the format it writes for, so two fees on one title differ.
  assert.deepEqual(
    fees.map((l) => l.forProductType),
    ["NATIVE_ARTICLE", "ADVERTORIAL", null],
  );
  assert.equal(out.lines[0].forProductType, null);
  // ...and the placement product, so the page states that article's scope.
  assert.deepEqual(
    fees.map((l) => l.forProductId),
    ["p1", "p2", null],
  );
  assert.equal(out.lines[0].forProductId, null);
});

test("an extra-work line carries its description, hours and rate, never an anchor", () => {
  const out = buildQuoteNarrative(
    input({
      quote: {
        currency: "NOK",
        lines: [
          { id: "l1", kind: "INVENTORY", productId: "p1", description: "A", lineTotal: 18000, quantity: 1 },
          {
            id: "x1",
            kind: "EXTRA_WORK",
            productId: null,
            description: "Third revision round",
            lineTotal: 4125,
            quantity: 1,
            hours: "2.50",
            hourlyRate: "1650.00",
          },
        ],
      },
    }),
  );
  const extra = out.lines[1];
  assert.equal(extra.kind, "EXTRA_WORK");
  assert.equal(extra.titleName, "Third revision round");
  assert.equal(extra.productType, "EXTRA_WORK");
  assert.equal(extra.hours, 2.5);
  assert.equal(extra.hourlyRate, 1650);
  assert.equal(extra.lineTotal, 4125);
  assert.equal(extra.anchor, null);
  assert.equal(extra.forProductId, null);
  // Billed hours are not a placement.
  assert.equal(out.itemCount, 1);
  assert.equal(out.lines[0].hours, null);
});

// BUG-final-local-5: 2 placements with 2 article fees read "4 editorial-grade
// native placements" in the outcome line.
test("itemCount counts placements, not the article fees billed with them", () => {
  const out = buildQuoteNarrative(
    input({
      quote: {
        currency: "NOK",
        lines: [
          { id: "l1", kind: "INVENTORY", productId: "p1", description: "A", lineTotal: 18000, quantity: 1 },
          { id: "l2", kind: "INVENTORY", productId: "p2", description: "B", lineTotal: 5000, quantity: 1 },
          { id: "f1", kind: "CONTENT_FEE", productId: null, description: "Content production — A", lineTotal: 12000, quantity: 1 },
          { id: "f2", kind: "CONTENT_FEE", productId: null, description: "Content production — B", lineTotal: 8000, quantity: 1 },
        ],
      },
    }),
  );
  assert.equal(out.itemCount, 2);
  assert.equal(out.lines.length, 4);
});
