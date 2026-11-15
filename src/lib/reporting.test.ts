import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tally,
  sumByGroup,
  averageOrderValue,
  conversionPct,
  revenueSplit,
  ctrPct,
  type RevenueLine,
} from "./reporting";

test("tally counts labels, highest first, ties broken by key", () => {
  assert.deepEqual(tally(["LIVE", "LIVE", "QUOTED", "LIVE", "QUOTED"]), [
    { key: "LIVE", count: 3 },
    { key: "QUOTED", count: 2 },
  ]);
  assert.deepEqual(tally(["b", "a"]), [
    { key: "a", count: 1 },
    { key: "b", count: 1 },
  ]);
  assert.deepEqual(tally([]), []);
});

test("sumByGroup totals per group, largest first", () => {
  const rows = [
    { group: "news", amount: 1000 },
    { group: "business", amount: 500 },
    { group: "news", amount: 250 },
  ];
  assert.deepEqual(sumByGroup(rows), [
    { group: "news", amount: 1250 },
    { group: "business", amount: 500 },
  ]);
  assert.deepEqual(sumByGroup([]), []);
});

test("averageOrderValue rounds and guards divide-by-zero", () => {
  assert.equal(averageOrderValue(3000, 2), 1500);
  assert.equal(averageOrderValue(1000, 3), 333);
  assert.equal(averageOrderValue(0, 0), 0);
});

test("conversionPct is a one-decimal percentage, zero-safe", () => {
  assert.equal(conversionPct(10, 5), 50);
  assert.equal(conversionPct(3, 1), 33.3);
  assert.equal(conversionPct(0, 0), 0);
  assert.equal(conversionPct(4, 4), 100);
});

test("revenueSplit separates inventory margin from content-fee revenue", () => {
  const lines: RevenueLine[] = [
    // inventory: sold for 1150, cost 1000 x1 -> 150 margin
    { kind: "INVENTORY", unitCost: 1000, quantity: 1, lineTotal: 1150 },
    // inventory: sold for 2400, cost 1000 x2 -> 400 margin
    { kind: "INVENTORY", unitCost: 1000, quantity: 2, lineTotal: 2400 },
    // content fee: whole 8000 is revenue
    { kind: "CONTENT_FEE", unitCost: 0, quantity: 1, lineTotal: 8000 },
  ];
  const split = revenueSplit(lines);
  assert.equal(split.marginRevenue, 550);
  assert.equal(split.contentFeeRevenue, 8000);
  assert.equal(split.totalRevenue, 8550);
  // 8000 / 8550 = 93.6%
  assert.equal(split.contentFeeRatioPct, 93.6);
});

test("revenueSplit is zero-safe with no lines", () => {
  const split = revenueSplit([]);
  assert.deepEqual(split, {
    marginRevenue: 0,
    contentFeeRevenue: 0,
    totalRevenue: 0,
    contentFeeRatioPct: 0,
  });
});

test("ctrPct: clicks/impressions to one decimal; guards zero/null denominator", () => {
  assert.equal(ctrPct(50, 1000), 5);
  assert.equal(ctrPct(1, 3), 33.3);
  assert.equal(ctrPct(10, 0), null);   // undefined CTR, not 0
  assert.equal(ctrPct(10, null), null);
  assert.equal(ctrPct(0, 1000), 0);
});

test("deskRevenueByCurrency: cancelled out, credits off, extra work in, unpriced lines ignored", async () => {
  const { deskRevenueByCurrency } = await import("./reporting");
  const inv = (lineTotal: number, unitCost: number, extra = {}) => ({
    kind: "INVENTORY" as const,
    unitCost,
    quantity: 1,
    lineTotal,
    ...extra,
  });
  const rows = deskRevenueByCurrency([
    // Live order: 10 000 net + 25% VAT, 2 000 margin; 1 000 net extra work.
    {
      status: "INVOICED",
      currency: "NOK",
      quoteTotal: 12500,
      vatPct: 25,
      lines: [
        inv(10000, 8000),
        // Never agreed: neither revenue nor a 5 000 negative margin.
        inv(0, 5000, { priceOnRequest: true }),
      ],
      extraWork: [1000],
      credited: [],
    },
    // Cancelled (e.g. fully credited): earns nothing.
    { status: "CANCELLED", currency: "NOK", quoteTotal: 50000, vatPct: 25, lines: [inv(40000, 30000)], extraWork: [], credited: [50000] },
    // Still live but partly credited.
    { status: "COMPLETED", currency: "SEK", quoteTotal: 2500, vatPct: 25, lines: [inv(2000, 1500)], extraWork: [], credited: [500] },
  ]);
  assert.deepEqual(rows.map((r) => r.currency), ["NOK", "SEK"]);
  const [nok, sek] = rows;
  assert.equal(nok.count, 1);
  assert.equal(nok.gmv, 12500 + 1250);
  assert.equal(nok.split.marginRevenue, 2000);
  assert.equal(nok.split.contentFeeRevenue, 1000);
  assert.equal(sek.gmv, 2000);
  assert.equal(sek.aov, 2000);
});
