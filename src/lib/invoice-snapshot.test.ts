import { test } from "node:test";
import assert from "node:assert/strict";
import {
  customerSnapshotFrom,
  documentNumber,
  readCustomerSnapshot,
  sellerForInvoice,
  sellerSnapshotFrom,
} from "./invoice-snapshot";
import { loadSellerDetails } from "./seller";

test("documentNumber: sequence number when issued, short id otherwise", () => {
  assert.equal(documentNumber({ id: "cmabcdefgh12345678", number: 42 }), "42");
  assert.equal(documentNumber({ id: "cmabcdefgh12345678", number: null }), "12345678");
  assert.equal(documentNumber({ id: "cmabcdefgh1234abcd" }), "1234ABCD");
});

test("customerSnapshotFrom prefers the legal name and drops blank address lines", () => {
  const snap = customerSnapshotFrom({
    name: "Acme",
    legalName: "Acme AS",
    vatId: "NO123456789MVA",
    addressLine1: "Storgata 1",
    addressLine2: " ",
    postalCode: "0155",
    city: "Oslo",
  });
  assert.deepEqual(snap, {
    name: "Acme AS",
    vatId: "NO123456789MVA",
    addressLines: ["Storgata 1", "0155 Oslo"],
  });
  assert.deepEqual(readCustomerSnapshot(JSON.parse(JSON.stringify(snap))), snap);
});

test("readCustomerSnapshot rejects anything that is not a snapshot", () => {
  assert.equal(readCustomerSnapshot(null), null);
  assert.equal(readCustomerSnapshot([]), null);
  assert.equal(readCustomerSnapshot({ name: "" }), null);
});

test("sellerForInvoice keeps frozen values and fills gaps from today's config", () => {
  const atIssue = loadSellerDetails({ SELLER_LEGAL_NAME: "Old Name AS", SELLER_CITY: "Bergen" });
  const today = loadSellerDetails({
    SELLER_LEGAL_NAME: "New Name AS",
    SELLER_ORG_NUMBER: "974760673",
    SELLER_CITY: "Oslo",
  });
  const seller = sellerForInvoice(sellerSnapshotFrom(atIssue), today);
  assert.equal(seller.legalName, "Old Name AS");
  assert.equal(seller.city, "Bergen");
  // Not set when issued: today's value completes the document.
  assert.equal(seller.orgNumber, "974760673");
  assert.deepEqual(sellerForInvoice(null, today), today);
});
