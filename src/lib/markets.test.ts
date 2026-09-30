import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_MARKETS, isSupportedMarket } from "./markets";
import { marketDefaultLocale } from "./market-locale";

test("NativeSpin sells in exactly the nine published markets", () => {
  assert.deepEqual(
    [...SUPPORTED_MARKETS].sort(),
    ["AT", "CH", "DE", "DK", "FI", "IE", "NO", "SE", "UK"],
  );
});

test("NL and BE are not offered anywhere a person picks a market", () => {
  assert.equal(isSupportedMarket("NL"), false);
  assert.equal(isSupportedMarket("BE"), false);
  assert.equal(isSupportedMarket("no"), false, "codes are upper-case");
  assert.equal(isSupportedMarket("NO"), true);
});

test("every supported market has a dedicated UI locale", () => {
  // Only UK/IE should read English — everything else has its own locale.
  for (const code of SUPPORTED_MARKETS) {
    const loc = marketDefaultLocale(code);
    if (code === "UK" || code === "IE") assert.equal(loc, "en");
    else assert.notEqual(loc, "en", `${code} fell back to English`);
  }
});
