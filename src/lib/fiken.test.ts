import { test } from "node:test";
import assert from "node:assert/strict";
import { toFikenInvoicePayload, fikenVatType } from "./fiken";
import type { AccountingInvoice } from "./accounting";

const doc: AccountingInvoice = {
  invoiceId: "inv_1",
  number: "2026-0007",
  issuedAt: "2026-05-30T10:00:00.000Z",
  dueAt: "2026-06-29T10:00:00.000Z",
  currency: "NOK",
  customer: { organizationId: "org_1", name: "Acme AS", vatId: "NO999888777MVA" },
  lines: [
    { description: "Aftenposten native", quantity: 2, unitAmount: 14000, lineTotal: 28000 },
    { description: "Content production", quantity: 1, unitAmount: 12000, lineTotal: 12000 },
  ],
  subtotal: 40000,
  vatPct: 25,
  vatAmount: 10000,
  total: 50000,
};

test("fikenVatType maps known Norwegian rates and flags the rest", () => {
  assert.deepEqual(fikenVatType(25), { vatType: "HIGH", uncertain: false });
  assert.deepEqual(fikenVatType(15), { vatType: "MEDIUM", uncertain: false });
  assert.deepEqual(fikenVatType(12), { vatType: "LOW", uncertain: false });
  assert.deepEqual(fikenVatType(0), { vatType: "EXEMPT", uncertain: false });
  assert.equal(fikenVatType(19).uncertain, true); // e.g. DE — needs review
});

test("toFikenInvoicePayload converts to øre and per-unit gross", () => {
  const p = toFikenInvoicePayload(doc, 555, "1500:10001");
  assert.equal(p.customerId, 555);
  assert.equal(p.cash, false);
  assert.equal(p.currency, "NOK");
  assert.equal(p.issueDate, "2026-05-30");
  assert.equal(p.dueDate, "2026-06-29");
  assert.equal(p.bankAccountCode, "1500:10001");
  // line 1: 28000 / 2 = 14000 major -> 1_400_000 øre
  assert.equal(p.lines[0].unitPrice, 1_400_000);
  assert.equal(p.lines[0].quantity, 2);
  assert.equal(p.lines[0].vatType, "HIGH");
  // line 2: 12000 major, qty 1 -> 1_200_000 øre
  assert.equal(p.lines[1].unitPrice, 1_200_000);
});

test("toFikenInvoicePayload tolerates null dates and zero quantity", () => {
  const p = toFikenInvoicePayload(
    { ...doc, issuedAt: null, dueAt: null, lines: [{ description: "x", quantity: 0, unitAmount: 0, lineTotal: 500 }] },
    1,
    "1500:10001",
  );
  assert.equal(p.issueDate, "");
  assert.equal(p.lines[0].unitPrice, 50000); // falls back to lineTotal in øre
});
