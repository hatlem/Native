import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateCompleteness,
  isAdvertiserContentType,
  type CompletenessInput,
} from "@/lib/ratecard/extract";

test("isAdvertiserContentType recognises native/advertiser content types", () => {
  assert.equal(isAdvertiserContentType("NATIVE_ARTICLE"), true);
  assert.equal(isAdvertiserContentType("ADVERTORIAL"), true);
  assert.equal(isAdvertiserContentType("NATIVE_PLUS"), true);
  assert.equal(isAdvertiserContentType("CONTENT_VIDEO"), true);
  assert.equal(isAdvertiserContentType("NATIVE_DISPLAY"), false);
  assert.equal(isAdvertiserContentType("CONTEXTUAL"), false);
  assert.equal(isAdvertiserContentType("OTHER"), false);
  assert.equal(isAdvertiserContentType(null), false);
  assert.equal(isAdvertiserContentType(undefined), false);
});

test("complete when priced advertiser-content quote + included text + own-content answered", () => {
  const input: CompletenessInput = {
    ownContentAllowed: "WITH_APPROVAL",
    quotes: [
      {
        draftProductType: "NATIVE_ARTICLE",
        price: 25000,
        includedText: "Produksjon + 30 dager på forsiden",
      },
    ],
  };
  const r = evaluateCompleteness(input);
  assert.equal(r.complete, true);
  assert.deepEqual(r.missing, []);
  assert.equal(r.hasAdvertiserContentPrice, true);
  assert.equal(r.hasIncludedText, true);
  assert.equal(r.hasOwnContentAnswer, true);
});

test("incomplete when own-content is UNKNOWN", () => {
  const r = evaluateCompleteness({
    ownContentAllowed: "UNKNOWN",
    quotes: [
      { draftProductType: "ADVERTORIAL", price: 10000, includedText: "alt inkludert" },
    ],
  });
  assert.equal(r.complete, false);
  assert.deepEqual(r.missing, ["own_content_allowed"]);
});

test("incomplete when the advertiser-content quote has no included text", () => {
  const r = evaluateCompleteness({
    ownContentAllowed: "YES",
    quotes: [{ draftProductType: "NATIVE_ARTICLE", price: 12000, includedText: null }],
  });
  assert.equal(r.complete, false);
  assert.deepEqual(r.missing, ["included_text"]);
});

test("a display-only quote does not satisfy advertiser-content requirement", () => {
  const r = evaluateCompleteness({
    ownContentAllowed: "YES",
    quotes: [
      { draftProductType: "NATIVE_DISPLAY", price: 5000, includedText: "1 uke banner" },
    ],
  });
  assert.equal(r.complete, false);
  assert.deepEqual(r.missing, ["advertiser_content_price", "included_text"]);
});

test("a zero/negative price is not a valid price", () => {
  const r = evaluateCompleteness({
    ownContentAllowed: "NO",
    quotes: [{ draftProductType: "NATIVE_ARTICLE", price: 0, includedText: "x" }],
  });
  assert.equal(r.hasAdvertiserContentPrice, false);
  assert.equal(r.complete, false);
});

test("linked product type (not just draft) counts as advertiser content", () => {
  const r = evaluateCompleteness({
    ownContentAllowed: "YES",
    quotes: [
      { productType: "CONTENT_VIDEO", price: 40000, includedText: "video + distribusjon" },
    ],
  });
  assert.equal(r.complete, true);
});

test("empty quotes → all gaps reported", () => {
  const r = evaluateCompleteness({ ownContentAllowed: "UNKNOWN", quotes: [] });
  assert.deepEqual(r.missing, [
    "advertiser_content_price",
    "included_text",
    "own_content_allowed",
  ]);
});
