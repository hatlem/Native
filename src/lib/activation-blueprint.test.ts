import { test } from "node:test";
import assert from "node:assert/strict";
import { MarketCode, ProductType, PriceVisibility } from "@prisma/client";
import {
  blueprintFor,
  basePriceFor,
  marketAdjustments,
} from "./activation-blueprint";

const NATIVE_ARTICLE = {
  type: ProductType.NATIVE_ARTICLE,
  perThousandReach: 25,
  leadTimeDays: 12,
  visibility: PriceVisibility.INDICATIVE,
  marginPct: 22,
  seasonalMultiplier: 1,
};

test("basePriceFor in NO applies factor 1.0 above the floor", () => {
  // 400,000 reach × 25 NOK/1000 × 1.0 (NO factor) = 10,000 NOK,
  // which is above the NO floor of 8,000.
  assert.equal(basePriceFor(400_000, NATIVE_ARTICLE, MarketCode.NO), 10_000);
});

test("basePriceFor lifts tiny B2B titles to the market floor (Ingrid's gap)", () => {
  // The canonical regression: Frankfurter Stilhaus's smallest titles
  // have ~4,800 IVW circulation. Pre-fix that produced ~EUR 120; the
  // floor now bumps to EUR 1,200.
  const price = basePriceFor(4_800, NATIVE_ARTICLE, MarketCode.DE);
  const { floor } = marketAdjustments(MarketCode.DE);
  assert.ok(
    price >= floor,
    `Expected ≥ ${floor} EUR floor for tiny DE B2B titles, got ${price}`,
  );
  // Sanity: the lift is the floor, not some giant overshoot.
  assert.equal(price, floor);
});

test("basePriceFor applies the per-thousand factor above the floor", () => {
  // DE factor = 1.4. 100,000 reach × 25 × 1.4 = 3,500 EUR.
  const price = basePriceFor(100_000, NATIVE_ARTICLE, MarketCode.DE);
  assert.equal(price, 3_500);
});

test("basePriceFor for CH applies a heavier multiplier", () => {
  // CH factor = 1.8. 80,000 reach × 25 × 1.8 = 3,600 CHF.
  const price = basePriceFor(80_000, NATIVE_ARTICLE, MarketCode.CH);
  assert.equal(price, 3_600);
});

test("blueprintFor always returns the three product types in order", () => {
  const rows = blueprintFor(MarketCode.NO);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].type, ProductType.NATIVE_ARTICLE);
  assert.equal(rows[1].type, ProductType.ADVERTORIAL);
  assert.equal(rows[2].type, ProductType.NATIVE_DISPLAY);
});

test("marketAdjustments returns baseline shape for unknown markets", () => {
  // Cast a clearly-fake market through any so the helper sees an
  // unconfigured key — the contract is "fall back to baseline", not
  // "throw on missing".
  const fake = "ZZ" as MarketCode;
  const adj = marketAdjustments(fake);
  assert.equal(adj.perThousandFactor, 1.0);
  assert.equal(adj.floor, 0);
});
