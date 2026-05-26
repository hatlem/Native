import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPriceRequestEmail, localeForMarketCode } from "./email";

test("localeForMarketCode maps Nordic + DACH + UK markets", () => {
  assert.equal(localeForMarketCode("NO"), "no");
  assert.equal(localeForMarketCode("SE"), "sv");
  assert.equal(localeForMarketCode("DK"), "da");
  assert.equal(localeForMarketCode("FI"), "fi");
  assert.equal(localeForMarketCode("DE"), "de");
  assert.equal(localeForMarketCode("AT"), "de");
  assert.equal(localeForMarketCode("CH"), "de");
  assert.equal(localeForMarketCode("UK"), "en");
  assert.equal(localeForMarketCode("IE"), "en");
});

test("buildPriceRequestEmail includes title name + link + contact name", () => {
  const m = buildPriceRequestEmail({
    locale: "en",
    contactName: "Jane Doe",
    titleName: "Aftenposten",
    publisherName: "Schibsted",
    link: "https://native.app/en/price-request/abc123",
    inviterName: "Andreas",
  });
  assert.match(m.subject, /Aftenposten/);
  assert.match(m.text, /Jane Doe/);
  assert.match(m.text, /Aftenposten/);
  assert.match(m.text, /Schibsted/);
  assert.match(m.text, /abc123/);
  assert.match(m.text, /Andreas/);
});

test("buildPriceRequestEmail produces a Norwegian variant", () => {
  const m = buildPriceRequestEmail({
    locale: "no",
    contactName: "Jane",
    titleName: "Aftenposten",
    publisherName: "Schibsted",
    link: "https://native.app/no/price-request/x",
    inviterName: "Andreas",
  });
  assert.match(m.subject, /Prisjekk/);
});

test("buildPriceRequestEmail produces a German variant", () => {
  const m = buildPriceRequestEmail({
    locale: "de",
    contactName: "Jane",
    titleName: "FAZ",
    publisherName: "Fazit-Stiftung",
    link: "https://native.app/de/price-request/x",
    inviterName: "Andreas",
  });
  assert.match(m.subject, /Preisabfrage/);
});
