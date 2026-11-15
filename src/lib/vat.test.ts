import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VAT_NOTE_REVERSE_CHARGE_EU,
  VAT_NOTE_REVERSE_CHARGE_NON_EU,
  domesticVatRatePct,
  isEuCountry,
  normalizeCountry,
  resolveVat,
  vatAmounts,
  vatForBuyer,
} from "./vat";

test("a Norwegian buyer pays Norwegian VAT, whatever the publication's market", () => {
  assert.deepEqual(resolveVat({ buyerCountry: "NO", buyerVatId: "NO 987 654 321 MVA" }), {
    vatPct: 25,
    treatment: "DOMESTIC",
    note: null,
    warnings: [],
  });
  // No VAT id is not a problem for a domestic sale.
  assert.deepEqual(resolveVat({ buyerCountry: "NO" }).warnings, []);
});

test("an EU business buyer is reverse-charged at 0 % with the EU note", () => {
  for (const country of ["SE", "DK", "FI", "DE", "AT", "IE", "NL", "BE"]) {
    const d = resolveVat({ buyerCountry: country, buyerVatId: "X123" });
    assert.equal(d.vatPct, 0, country);
    assert.equal(d.treatment, "REVERSE_CHARGE", country);
    assert.equal(d.note, VAT_NOTE_REVERSE_CHARGE_EU, country);
    assert.deepEqual(d.warnings, [], country);
  }
  assert.match(VAT_NOTE_REVERSE_CHARGE_EU, /^Reverse charge — VAT to be accounted for by the recipient/);
});

test("a business buyer outside Norway and the EU is reverse-charged with the non-EU note", () => {
  for (const country of ["UK", "GB", "CH", "US"]) {
    const d = resolveVat({ buyerCountry: country, buyerVatId: "GB123456789" });
    assert.equal(d.vatPct, 0, country);
    assert.equal(d.treatment, "REVERSE_CHARGE", country);
    assert.equal(d.note, VAT_NOTE_REVERSE_CHARGE_NON_EU, country);
  }
});

test("reverse charge without a VAT id warns the desk", () => {
  assert.deepEqual(resolveVat({ buyerCountry: "SE" }).warnings, ["BUYER_VAT_ID_MISSING"]);
  assert.deepEqual(resolveVat({ buyerCountry: "SE", buyerVatId: "   " }).warnings, ["BUYER_VAT_ID_MISSING"]);
});

test("an unknown buyer country falls back to domestic VAT and warns", () => {
  for (const country of [null, undefined, "", "Sweden?", "123"]) {
    assert.deepEqual(resolveVat({ buyerCountry: country, buyerVatId: "SE5560000000" }), {
      vatPct: 25,
      treatment: "DOMESTIC",
      note: null,
      warnings: ["BUYER_COUNTRY_UNKNOWN"],
    });
  }
});

test("the seller country is read loosely and defaults to Norway", () => {
  assert.equal(resolveVat({ sellerCountry: "Norway", buyerCountry: "NO" }).treatment, "DOMESTIC");
  assert.equal(resolveVat({ sellerCountry: "Norge", buyerCountry: "NO" }).treatment, "DOMESTIC");
  assert.equal(resolveVat({ sellerCountry: null, buyerCountry: "NO" }).vatPct, 25);
  // A seller country with no configured rate still charges the default rate
  // on a sale it treats as domestic, rather than 0 %.
  assert.equal(domesticVatRatePct("SE"), 25);
});

test("vatForBuyer reads an Organization row", () => {
  assert.equal(vatForBuyer({ marketCode: "NO", vatId: null }).vatPct, 25);
  assert.equal(vatForBuyer({ marketCode: "UK", vatId: "GB1" }).treatment, "REVERSE_CHARGE");
  assert.deepEqual(vatForBuyer(null).warnings, ["BUYER_COUNTRY_UNKNOWN"]);
  assert.deepEqual(vatForBuyer({ marketCode: null }).warnings, ["BUYER_COUNTRY_UNKNOWN"]);
});

test("normalizeCountry and isEuCountry", () => {
  assert.equal(normalizeCountry("uk"), "GB");
  assert.equal(normalizeCountry(" no "), "NO");
  assert.equal(normalizeCountry("norway"), "NO");
  assert.equal(normalizeCountry("Deutschland"), null);
  assert.equal(isEuCountry("SE"), true);
  assert.equal(isEuCountry("NO"), false);
  assert.equal(isEuCountry("UK"), false);
  assert.equal(isEuCountry("CH"), false);
  assert.equal(isEuCountry(null), false);
});

test("vatAmounts: VAT is rounded once to two decimals and the total reconciles", () => {
  assert.deepEqual(vatAmounts(4690, 25), { subtotal: 4690, vat: 1172.5, total: 5862.5 });
  assert.deepEqual(vatAmounts(1001, 25), { subtotal: 1001, vat: 250.25, total: 1251.25 });
  assert.deepEqual(vatAmounts(1001.01, 25), { subtotal: 1001.01, vat: 250.25, total: 1251.26 });
  assert.deepEqual(vatAmounts(1000, 0), { subtotal: 1000, vat: 0, total: 1000 });
  // Half a minor unit rounds away from zero, with no float drift
  // (1.005 × 100 is 100.49999… in floating point).
  assert.equal(vatAmounts(0.02, 25).vat, 0.01);
  assert.equal(vatAmounts(0.06, 25).vat, 0.02);
  assert.equal(vatAmounts(-0.02, 25).vat, -0.01);
  // A fractional rate.
  assert.deepEqual(vatAmounts(999.99, 25.5), { subtotal: 999.99, vat: 255, total: 1254.99 });
  // Large amounts stay exact.
  const big = vatAmounts(98_765_432.1, 25);
  assert.equal(big.vat, 24_691_358.03); // 24 691 358.025 → .03
  assert.equal(big.total, 123_456_790.13);
  for (const [sub, pct] of [[1234.56, 25], [77.77, 12], [0.01, 25], [5000, 15]] as const) {
    const r = vatAmounts(sub, pct);
    assert.equal(Math.round((r.subtotal + r.vat) * 100), Math.round(r.total * 100));
  }
});
