import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidBic,
  isValidIban,
  isValidNorwegianBankAccount,
  isValidNorwegianOrgNumber,
  loadSellerDetails,
  sellerAddressLines,
  sellerGaps,
} from "./seller";

// Public reference values (Brønnøysundregistrene's own org number, the
// standard Norwegian account / IBAN examples) — not NativeSpin's details.
const COMPLETE = {
  SELLER_ORG_NUMBER: "974 760 673",
  SELLER_VAT_NUMBER: "NO 974 760 673 MVA",
  SELLER_ADDRESS_LINE1: "Testveien 1",
  SELLER_POSTAL_CODE: "0150",
  SELLER_BANK_ACCOUNT: "1234.56.78903",
  SELLER_IBAN: "NO93 8601 1117 947",
  SELLER_BIC: "DNBANOKK",
};

test("only repo-stated facts have defaults; nothing else is guessed", () => {
  const s = loadSellerDetails({});
  assert.equal(s.legalName, "Getia AS");
  assert.equal(s.city, "Oslo");
  assert.equal(s.country, "Norway");
  assert.equal(s.registry, "Foretaksregisteret");
  assert.equal(s.orgNumber, null);
  assert.equal(s.vatNumber, null);
  assert.equal(s.addressLine1, null);
  assert.equal(s.bankAccount, null);
  assert.equal(s.iban, null);
});

test("env overrides every default and normalises IBAN/BIC", () => {
  const s = loadSellerDetails({ ...COMPLETE, SELLER_LEGAL_NAME: "Other AS", SELLER_CITY: "Bergen", SELLER_BIC: "dnba nokk" });
  assert.equal(s.legalName, "Other AS");
  assert.equal(s.city, "Bergen");
  assert.equal(s.iban, "NO9386011117947");
  assert.equal(s.bic, "DNBANOKK");
});

test("sellerGaps: an unconfigured seller lists every legally required variable", () => {
  const gaps = sellerGaps(loadSellerDetails({}), "NOK").map((g) => g.variable);
  assert.deepEqual(gaps, [
    "SELLER_ORG_NUMBER",
    "SELLER_VAT_NUMBER",
    "SELLER_ADDRESS_LINE1",
    "SELLER_POSTAL_CODE",
    "SELLER_BANK_ACCOUNT",
  ]);
});

test("sellerGaps: complete details render in every currency", () => {
  const s = loadSellerDetails(COMPLETE);
  assert.deepEqual(sellerGaps(s, "NOK"), []);
  assert.deepEqual(sellerGaps(s, "EUR"), []);
});

test("sellerGaps: a non-NOK invoice needs IBAN and BIC", () => {
  const s = loadSellerDetails({ ...COMPLETE, SELLER_IBAN: "", SELLER_BIC: "" });
  assert.deepEqual(sellerGaps(s, "NOK"), []);
  assert.deepEqual(
    sellerGaps(s, "SEK").map((g) => g.variable),
    ["SELLER_IBAN", "SELLER_BIC"],
  );
});

test("sellerGaps: checksummed details are validated, not just present", () => {
  const s = loadSellerDetails({
    ...COMPLETE,
    SELLER_ORG_NUMBER: "974760674",
    SELLER_BANK_ACCOUNT: "1234.56.78904",
    SELLER_IBAN: "NO9486011117947",
  });
  assert.deepEqual(sellerGaps(s, "NOK"), [
    { variable: "SELLER_ORG_NUMBER", problem: "invalid" },
    { variable: "SELLER_BANK_ACCOUNT", problem: "invalid" },
    { variable: "SELLER_IBAN", problem: "invalid" },
  ]);
});

test("checksum helpers", () => {
  assert.equal(isValidNorwegianOrgNumber("974760673"), true);
  assert.equal(isValidNorwegianOrgNumber("97476067"), false);
  assert.equal(isValidNorwegianBankAccount("12345678903"), true);
  assert.equal(isValidIban("DE89 3704 0044 0532 0130 00"), true);
  assert.equal(isValidIban("DE88370400440532013000"), false);
  assert.equal(isValidBic("DNBANOKKXXX"), true);
  assert.equal(isValidBic("DNB"), false);
});

test("sellerAddressLines prints the block in order", () => {
  assert.deepEqual(sellerAddressLines(loadSellerDetails(COMPLETE), "en"), ["Testveien 1", "0150 Oslo", "Norway"]);
});

test("sellerAddressLines prints the country in the document's language", () => {
  const seller = loadSellerDetails(COMPLETE);
  assert.equal(sellerAddressLines(seller, "no").at(-1), "Norge");
  assert.equal(sellerAddressLines(seller, "de").at(-1), "Norwegen");
  // A country we can't map stays exactly as the seller wrote it.
  const odd = loadSellerDetails({ ...COMPLETE, SELLER_COUNTRY: "Svalbard" });
  assert.equal(sellerAddressLines(odd, "no").at(-1), "Svalbard");
});
