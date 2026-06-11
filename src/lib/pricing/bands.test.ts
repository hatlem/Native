import { test } from "node:test";
import assert from "node:assert/strict";
import { priceBand, bandLabel } from "./bands";

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
