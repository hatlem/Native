import { test } from "node:test";
import assert from "node:assert/strict";
import { languageForCountry, topicForCategory } from "./criteria";

test("languageForCountry maps shared-language markets", () => {
  assert.equal(languageForCountry("NO"), "NO");
  assert.equal(languageForCountry("SE"), "SV");
  assert.equal(languageForCountry("DK"), "DA");
  assert.equal(languageForCountry("FI"), "FI");
  assert.equal(languageForCountry("DE"), "DE");
  assert.equal(languageForCountry("AT"), "DE");
  assert.equal(languageForCountry("CH"), "DE");
  assert.equal(languageForCountry("UK"), "EN");
  assert.equal(languageForCountry("IE"), "EN");
});

test("languageForCountry returns null for unknown codes", () => {
  assert.equal(languageForCountry("XX"), null);
  assert.equal(languageForCountry(""), null);
});

test("topicForCategory maps known categories and falls back to OTHER", () => {
  assert.equal(topicForCategory("business"), "FINANCE");
  assert.equal(topicForCategory("lifestyle"), "LIFESTYLE");
  assert.equal(topicForCategory("general-news"), "OTHER");
  assert.equal(topicForCategory("totally-unknown"), "OTHER");
});
