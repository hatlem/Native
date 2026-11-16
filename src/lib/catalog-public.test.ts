import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { fromCacheJson, toCacheJson } from "./catalog-public";

// The title page is served from Next's data cache, which stores JSON. Prices
// (Decimal) and dates must come back as what Prisma returned, not strings.
test("cached title-page data round-trips Decimals and Dates through JSON", () => {
  const row = {
    id: "t1",
    publishedRateCard: new Prisma.Decimal("12345.67"),
    lastVerifiedAt: new Date("2026-11-01T10:00:00.000Z"),
    discontinuedAt: null,
    keywords: ["a", "b"],
    commercialExtra: { note: "x", nested: [1, 2] },
    products: [{ basePrice: new Prisma.Decimal("990"), priceRules: [{ marginPct: new Prisma.Decimal("15.5") }] }],
  };
  const back = fromCacheJson(JSON.parse(JSON.stringify(toCacheJson(row)))) as typeof row;
  assert.ok(Prisma.Decimal.isDecimal(back.publishedRateCard));
  assert.equal(back.publishedRateCard.toString(), "12345.67");
  assert.ok(back.lastVerifiedAt instanceof Date);
  assert.equal(back.lastVerifiedAt.toISOString(), "2026-11-01T10:00:00.000Z");
  assert.equal(back.discontinuedAt, null);
  assert.deepEqual(back.keywords, ["a", "b"]);
  assert.deepEqual(back.commercialExtra, { note: "x", nested: [1, 2] });
  assert.equal(back.products[0].basePrice.toString(), "990");
  assert.equal(back.products[0].priceRules[0].marginPct.toString(), "15.5");
  assert.equal(fromCacheJson(toCacheJson(null)), null);
});
