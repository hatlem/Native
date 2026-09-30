import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PAYMENT_TERMS_DAYS,
  canSetPaymentTerms,
  invoiceDueAt,
  parsePaymentTermsDays,
  paymentTermsDaysFor,
} from "./payment-terms";
import { paymentTermsLine } from "./payment-terms-text";

test("default payment terms are net 14 days", () => {
  assert.equal(DEFAULT_PAYMENT_TERMS_DAYS, 14);
  assert.equal(paymentTermsDaysFor(null), 14);
  assert.equal(paymentTermsDaysFor({}), 14);
  assert.equal(paymentTermsDaysFor({ paymentTermsDays: null }), 14);
  assert.equal(paymentTermsDaysFor({ paymentTermsDays: 30 }), 30);
  // A corrupt stored value never reaches an invoice.
  assert.equal(paymentTermsDaysFor({ paymentTermsDays: 0 }), 14);
  assert.equal(paymentTermsDaysFor({ paymentTermsDays: 999 }), 14);
});

test("parsePaymentTermsDays accepts whole days 1–120 only", () => {
  assert.equal(parsePaymentTermsDays("14"), 14);
  assert.equal(parsePaymentTermsDays(" 30 "), 30);
  assert.equal(parsePaymentTermsDays("1"), 1);
  assert.equal(parsePaymentTermsDays("120"), 120);
  for (const bad of ["", "0", "121", "14.5", "-5", "abc", "1e2"]) {
    assert.equal(parsePaymentTermsDays(bad), null, bad);
  }
  assert.equal(parsePaymentTermsDays(null), null);
  assert.equal(parsePaymentTermsDays(14), null);
});

test("invoiceDueAt is net N days from the invoice date", () => {
  const issued = new Date("2026-09-30T10:00:00.000Z");
  assert.equal(invoiceDueAt(issued, 14).toISOString(), "2026-10-14T10:00:00.000Z");
  assert.equal(invoiceDueAt(issued, 30).toISOString(), "2026-10-30T10:00:00.000Z");
});

test("only SUPERADMIN may set a customer's payment terms", () => {
  assert.equal(canSetPaymentTerms("SUPERADMIN"), true);
  for (const role of ["DESK", "BUYER", "PUBLISHER", "WRITER", "", null, undefined]) {
    assert.equal(canSetPaymentTerms(role), false, String(role));
  }
});

test("paymentTermsLine states the customer's days, pluralised per locale", () => {
  assert.equal(paymentTermsLine("en", 14), "Payment terms: net 14 days from invoice date.");
  assert.equal(paymentTermsLine("en", 1), "Payment terms: net 1 day from invoice date.");
  assert.equal(paymentTermsLine("no", 30), "Betalingsbetingelser: netto 30 dager fra fakturadato.");
  assert.equal(paymentTermsLine("de", 1), "Zahlungsbedingungen: netto 1 Tag ab Rechnungsdatum.");
  for (const locale of ["sv", "da", "fi"]) {
    assert.match(paymentTermsLine(locale, 21), /21/);
  }
  // Unknown locale falls back to English rather than throwing.
  assert.equal(paymentTermsLine("xx", 14), "Payment terms: net 14 days from invoice date.");
});
