import { test } from "node:test";
import assert from "node:assert/strict";
import { servesArchivedPdf } from "./invoice-archive";

test("the archived PDF is served while the invoice stands as issued", () => {
  for (const status of ["ISSUED", "PAID", "OVERDUE"]) {
    assert.equal(servesArchivedPdf({ status, pdfObjectKey: "invoices/x.pdf" }), true, status);
  }
});

test("a credited, void or draft invoice — or one never archived — is rendered live", () => {
  for (const status of ["CREDITED", "VOID", "DRAFT"]) {
    assert.equal(servesArchivedPdf({ status, pdfObjectKey: "invoices/x.pdf" }), false, status);
  }
  assert.equal(servesArchivedPdf({ status: "ISSUED", pdfObjectKey: null }), false);
});
