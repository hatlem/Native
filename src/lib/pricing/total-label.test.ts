import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateLabel, lineFigureLabel, totalFloor, totalLabel } from "./total-label";
import { formatMoney } from "../money";

const nok = (amount: number) => formatMoney(amount, "NOK", "en");

test("totalLabel: exact only", () => {
  assert.equal(
    totalLabel({ currency: "NOK", amount: 45000, hasExact: true, estimate: null }, "en"),
    nok(45000),
  );
});

test("totalLabel: band range only", () => {
  assert.equal(
    totalLabel({ currency: "NOK", amount: 0, hasExact: false, estimate: { low: 40000, high: 60000 } }, "en"),
    "≈ 40–60k NOK",
  );
});

test("totalLabel: exact part plus band range", () => {
  assert.equal(
    totalLabel({ currency: "NOK", amount: 45000, hasExact: true, estimate: { low: 40000, high: 60000 } }, "en"),
    `${nok(45000)} + ≈ 40–60k NOK`,
  );
});

test("totalLabel: an open top band reads as 'from'", () => {
  assert.equal(
    totalLabel({ currency: "NOK", amount: 45000, hasExact: true, estimate: { low: 90000, high: null } }, "en"),
    `${nok(45000)} + ≈ 90k+ NOK`,
  );
});

test("totalLabel: nothing priced → null (the caller says 'on request')", () => {
  assert.equal(totalLabel({ currency: "NOK", amount: 0, hasExact: false, estimate: null }, "en"), null);
});

test("estimateLabel: bottom-bucket-only ranges read as '< X'", () => {
  assert.equal(estimateLabel({ currency: "EUR", estimate: { low: 0, high: 3000 } }), "≈ < 3k EUR");
});

test("lineFigureLabel: one wording per display kind", () => {
  const onRequest = "Price on request";
  assert.equal(
    lineFigureLabel({ kind: "exact", placement: 38000, contentFee: 7000, total: 45000 }, "NOK", "en", onRequest),
    nok(45000),
  );
  assert.equal(
    lineFigureLabel(
      {
        kind: "band",
        band: { kind: "range", low: 25000, high: 40000 },
        range: { low: 25000, high: 40000 },
        withContent: true,
      },
      "NOK",
      "en",
      onRequest,
    ),
    "≈ 25–40k NOK",
  );
  assert.equal(lineFigureLabel({ kind: "rate", rate: 395, unit: "CPM" }, "NOK", "en", onRequest), "≈ 395 NOK CPM");
  assert.equal(lineFigureLabel({ kind: "onRequest" }, "NOK", "en", onRequest), onRequest);
});

test("totalFloor: exact part plus the bottom of the band range", () => {
  assert.equal(totalFloor({ currency: "NOK", amount: 45000, hasExact: true, estimate: { low: 40000, high: 60000 } }), 85000);
  assert.equal(totalFloor({ currency: "NOK", amount: 0, hasExact: false, estimate: { low: 0, high: 15000 } }), 0);
});
