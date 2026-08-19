import { test } from "node:test";
import assert from "node:assert/strict";
import { MarketCode } from "@prisma/client";
import { marketDefaultLocale, type BuyerLocale } from "./market-locale";

const VALID_LOCALES: readonly BuyerLocale[] = ["en", "no", "sv", "da", "fi", "de"];

// Same precedent as src/messages/market-labels.test.ts: iterate the real
// Prisma enum so adding a MarketCode (as NL/BE were) can never leave a
// market without a notification locale — new codes fall back to "en"
// rather than crashing, and this test documents that they're covered.
test("every MarketCode maps to a valid buyer locale", () => {
  for (const code of Object.values(MarketCode)) {
    const locale = marketDefaultLocale(code);
    assert.ok(
      VALID_LOCALES.includes(locale),
      `marketDefaultLocale(${code}) returned invalid locale "${locale}"`,
    );
  }
});

test("maps each market to its national language", () => {
  assert.equal(marketDefaultLocale(MarketCode.NO), "no");
  assert.equal(marketDefaultLocale(MarketCode.SE), "sv");
  assert.equal(marketDefaultLocale(MarketCode.DK), "da");
  assert.equal(marketDefaultLocale(MarketCode.FI), "fi");
  assert.equal(marketDefaultLocale(MarketCode.DE), "de");
  assert.equal(marketDefaultLocale(MarketCode.AT), "de");
  assert.equal(marketDefaultLocale(MarketCode.CH), "de");
  assert.equal(marketDefaultLocale(MarketCode.UK), "en");
  assert.equal(marketDefaultLocale(MarketCode.IE), "en");
});

test("unknown or unmapped codes fall back to en", () => {
  // NL/BE exist in the enum but have no dedicated UI locale yet.
  assert.equal(marketDefaultLocale(MarketCode.NL), "en");
  assert.equal(marketDefaultLocale(MarketCode.BE), "en");
  assert.equal(marketDefaultLocale("XX"), "en");
  assert.equal(marketDefaultLocale(""), "en");
});
