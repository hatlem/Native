import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateLabel, totalFloor, totalLabel } from "./total-label";
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

test("totalFloor: exact part plus the bottom of the band range", () => {
  assert.equal(totalFloor({ currency: "NOK", amount: 45000, hasExact: true, estimate: { low: 40000, high: 60000 } }), 85000);
  assert.equal(totalFloor({ currency: "NOK", amount: 0, hasExact: false, estimate: { low: 0, high: 15000 } }), 0);
});
