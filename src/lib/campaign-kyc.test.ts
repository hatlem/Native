import { test } from "node:test";
import assert from "node:assert/strict";
import { kycComplete, kycMissingFields, type KycFields } from "./campaign-kyc";

const full: KycFields = {
  businessType: "BRAND",
  legalName: "Admirate AS",
  billingEmail: "billing@admirate.no",
  addressLine1: "Storgata 1",
  postalCode: "0155",
  city: "Oslo",
};

test("kycComplete: full record is complete", () => {
  assert.equal(kycComplete(full), true);
  assert.deepEqual(kycMissingFields(full), []);
});

test("kycComplete: null/blank required field fails", () => {
  assert.equal(kycComplete({ ...full, city: null }), false);
  assert.equal(kycComplete({ ...full, legalName: "   " }), false);
});

test("kycMissingFields: lists every missing key", () => {
  const missing = kycMissingFields({
    businessType: null,
    legalName: null,
    billingEmail: "b@x.no",
    addressLine1: "A",
    postalCode: "1",
    city: "Oslo",
  });
  assert.deepEqual(missing, ["businessType", "legalName"]);
});

test("kycMissingFields: addressLine2 is not required", () => {
  // full record has no addressLine2 key at all → still complete
  assert.equal(kycComplete(full), true);
});
