import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePreviewInput, marketLanguage, marketLanguageName } from "./schema";

test("parsePreviewInput accepts valid input and trims", () => {
  const r = parsePreviewInput({ brand: "  Volvo ", product: "A new EV", market: "NO", tone: "warm" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.brand, "Volvo");
    assert.equal(r.value.market, "NO");
    assert.equal(r.value.tone, "warm");
  }
});

test("parsePreviewInput rejects bad market/tone and over-length", () => {
  assert.equal(parsePreviewInput({ brand: "X", product: "Y", market: "US", tone: "warm" }).ok, false);
  assert.equal(parsePreviewInput({ brand: "X", product: "Y", market: "NO", tone: "loud" }).ok, false);
  assert.equal(parsePreviewInput({ brand: "X".repeat(81), product: "Y", market: "NO", tone: "warm" }).ok, false);
  assert.equal(parsePreviewInput({ brand: "X", product: "Y".repeat(601), market: "NO", tone: "warm" }).ok, false);
  assert.equal(parsePreviewInput({ brand: "", product: "Y", market: "NO", tone: "warm" }).ok, false);
});

test("parsePreviewInput strips control characters", () => {
  const r = parsePreviewInput({ brand: "Vol\u0000vo\u0007", product: "A\u001bd", market: "SE", tone: "plain" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.brand, "Volvo");
    assert.equal(r.value.product, "Ad");
  }
});

test("marketLanguage maps all 9 markets to 6 languages", () => {
  assert.equal(marketLanguage("NO"), "no");
  assert.equal(marketLanguage("SE"), "sv");
  assert.equal(marketLanguage("DK"), "da");
  assert.equal(marketLanguage("FI"), "fi");
  assert.equal(marketLanguage("DE"), "de");
  assert.equal(marketLanguage("AT"), "de");
  assert.equal(marketLanguage("CH"), "de");
  assert.equal(marketLanguage("UK"), "en");
  assert.equal(marketLanguage("IE"), "en");
  assert.equal(marketLanguageName("SE"), "Swedish");
});
