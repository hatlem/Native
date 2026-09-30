import { test } from "node:test";
import assert from "node:assert/strict";
import {
  priceBand,
  bandLabel,
  bandRange,
  addRanges,
  rangeLabel,
  bandTier,
  tierBand,
  isBandTier,
  tierLabel,
  BAND_TIER_COUNT,
} from "./bands";

test("bandRange: under starts at 0, over is open-ended", () => {
  assert.deepEqual(bandRange({ kind: "under", high: 15_000 }), { low: 0, high: 15_000 });
  assert.deepEqual(bandRange({ kind: "range", low: 25_000, high: 40_000 }), { low: 25_000, high: 40_000 });
  assert.deepEqual(bandRange({ kind: "over", low: 90_000 }), { low: 90_000, high: null });
});

test("addRanges sums bounds; any open-ended range opens the sum", () => {
  assert.deepEqual(addRanges(null, { low: 15_000, high: 25_000 }), { low: 15_000, high: 25_000 });
  assert.deepEqual(addRanges({ low: 15_000, high: 25_000 }, { low: 0, high: 15_000 }), { low: 15_000, high: 40_000 });
  assert.deepEqual(addRanges({ low: 15_000, high: 25_000 }, { low: 90_000, high: null }), { low: 105_000, high: null });
});

test("rangeLabel mirrors bandLabel's shapes", () => {
  assert.equal(rangeLabel({ low: 15_000, high: 40_000 }, "NOK"), "15–40k NOK");
  assert.equal(rangeLabel({ low: 0, high: 30_000 }, "NOK"), "< 30k NOK");
  assert.equal(rangeLabel({ low: 105_000, high: null }, "NOK"), "105k+ NOK");
  assert.equal(rangeLabel({ low: 1_500, high: 4_000 }, "EUR"), "1.5–4k EUR");
});

test("bandTier / tierBand round-trip in every currency scale", () => {
  assert.equal(BAND_TIER_COUNT, 6);
  for (const currency of ["NOK", "EUR", "XYZ"]) {
    for (let tier = 0; tier < BAND_TIER_COUNT; tier++) {
      assert.equal(bandTier(tierBand(tier, currency), currency), tier);
    }
  }
  assert.equal(bandTier(priceBand(41_400, "NOK"), "NOK"), 3);
  assert.equal(bandTier(priceBand(4_140, "EUR"), "EUR"), 3);
  assert.equal(bandTier(priceBand(200_000, "SEK"), "SEK"), 5);
  assert.equal(bandTier(priceBand(100, "DKK"), "DKK"), 0);
});

test("tierLabel groups currencies on the same scale", () => {
  assert.equal(tierLabel(2, ["NOK"]), "25–40k NOK");
  assert.equal(tierLabel(2, ["NOK", "SEK", "EUR", "GBP"]), "25–40k NOK/SEK · 2.5–4k EUR/GBP");
  assert.equal(tierLabel(0, ["DKK"]), "< 15k DKK");
  assert.equal(tierLabel(5, ["EUR", "EUR"]), "9k+ EUR");
});

test("isBandTier accepts only the tier indexes", () => {
  assert.equal(isBandTier(0), true);
  assert.equal(isBandTier(5), true);
  assert.equal(isBandTier(6), false);
  assert.equal(isBandTier(-1), false);
  assert.equal(isBandTier(1.5), false);
});

test("mid-bucket NOK price lands in its range", () => {
  assert.deepEqual(priceBand(41_400, "NOK"), {
    kind: "range",
    low: 40_000,
    high: 60_000,
  });
});

test("boundary is inclusive-low, exclusive-high", () => {
  // exactly on a boundary belongs to the bucket it OPENS
  assert.deepEqual(priceBand(25_000, "SEK"), {
    kind: "range",
    low: 25_000,
    high: 40_000,
  });
  assert.deepEqual(priceBand(24_999, "SEK"), {
    kind: "range",
    low: 15_000,
    high: 25_000,
  });
});

test("below first boundary → under", () => {
  assert.deepEqual(priceBand(12_000, "DKK"), { kind: "under", high: 15_000 });
});

test("at/above last boundary → over", () => {
  assert.deepEqual(priceBand(90_000, "NOK"), { kind: "over", low: 90_000 });
  assert.deepEqual(priceBand(250_000, "NOK"), { kind: "over", low: 90_000 });
});

test("EUR uses the small-denomination scale", () => {
  assert.deepEqual(priceBand(3_000, "EUR"), {
    kind: "range",
    low: 2_500,
    high: 4_000,
  });
});

test("unknown currency falls back to EUR scale, never throws", () => {
  assert.deepEqual(priceBand(3_000, "USD"), {
    kind: "range",
    low: 2_500,
    high: 4_000,
  });
});

test("bandLabel formats range / over / under", () => {
  assert.equal(
    bandLabel({ kind: "range", low: 40_000, high: 60_000 }, "NOK"),
    "40–60k NOK",
  );
  assert.equal(bandLabel({ kind: "over", low: 90_000 }, "NOK"), "90k+ NOK");
  assert.equal(bandLabel({ kind: "under", high: 15_000 }, "DKK"), "< 15k DKK");
});

test("bandLabel keeps fractional k for EUR-scale buckets", () => {
  assert.equal(
    bandLabel({ kind: "range", low: 1_500, high: 2_500 }, "EUR"),
    "1.5–2.5k EUR",
  );
});

test("non-finite / negative amount → under sentinel", () => {
  assert.deepEqual(priceBand(NaN, "NOK"), { kind: "under", high: 15_000 });
  assert.deepEqual(priceBand(-500, "NOK"), { kind: "under", high: 15_000 });
});
