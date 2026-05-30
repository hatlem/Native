import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAccountingInvoice,
  getAccountingProvider,
  noopProvider,
  fikenProvider,
} from "./accounting";

const invoice = {
  id: "inv_1",
  number: "2026-0007",
  issuedAt: new Date("2026-05-30T10:00:00.000Z"),
  dueAt: new Date("2026-06-29T10:00:00.000Z"),
  currency: "NOK",
  subtotal: "40000",
  vatPct: "25",
  total: "50000",
  lines: [
    { description: "Aftenposten native", quantity: 1, unitAmount: "28000", lineTotal: "28000" },
    { description: "Content production — Aftenposten native", quantity: 1, unitAmount: "12000", lineTotal: "12000" },
  ],
};
const org = { id: "org_1", name: "Acme AS", vatId: "NO999888777MVA" };

test("buildAccountingInvoice maps fields and derives VAT from the billed totals", () => {
  const doc = buildAccountingInvoice(invoice, org);
  assert.equal(doc.number, "2026-0007");
  assert.equal(doc.currency, "NOK");
  assert.equal(doc.subtotal, 40000);
  assert.equal(doc.total, 50000);
  assert.equal(doc.vatAmount, 10000); // total - subtotal, not recomputed
  assert.equal(doc.customer.vatId, "NO999888777MVA");
  assert.equal(doc.lines.length, 2);
  assert.equal(doc.issuedAt, "2026-05-30T10:00:00.000Z");
});

test("buildAccountingInvoice falls back to id and null dates", () => {
  const doc = buildAccountingInvoice(
    { ...invoice, number: null, issuedAt: null, dueAt: null },
    { id: "org_2", name: "NoVat Ltd" },
  );
  assert.equal(doc.number, "inv_1");
  assert.equal(doc.issuedAt, null);
  assert.equal(doc.dueAt, null);
  assert.equal(doc.customer.vatId, null);
});

test("getAccountingProvider defaults to noop and opts in to fiken", () => {
  assert.equal(getAccountingProvider({}).name, "noop");
  assert.equal(getAccountingProvider({ ACCOUNTING_PROVIDER: "nope" }).name, "noop");
  assert.equal(getAccountingProvider({ ACCOUNTING_PROVIDER: "fiken" }).name, "fiken");
});

test("noopProvider succeeds with a null ref", async () => {
  const doc = buildAccountingInvoice(invoice, org);
  const r = await noopProvider.pushInvoice(doc);
  assert.deepEqual(r, { ok: true, provider: "noop", externalRef: null });
});

test("fikenProvider reports not-configured rather than failing silently", async () => {
  // No FIKEN_API_TOKEN in the test env.
  const r = await fikenProvider().pushInvoice(buildAccountingInvoice(invoice, org));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /not configured/i);
});
