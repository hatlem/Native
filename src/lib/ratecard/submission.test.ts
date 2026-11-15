import { test } from "node:test";
import assert from "node:assert/strict";
import { pinnedRateCardKey, normalizeMediaKitUrl } from "./submission";
import { safeExternalUrl } from "@/lib/security";

test("pinnedRateCardKey: only keys under this token's prefix survive", () => {
  assert.equal(pinnedRateCardKey("rate-cards/tok/abc-kit.pdf", "tok"), "rate-cards/tok/abc-kit.pdf");
  assert.equal(pinnedRateCardKey("rate-cards/other/abc-kit.pdf", "tok"), null);
  assert.equal(pinnedRateCardKey("articles/x/secret.pdf", "tok"), null);
  assert.equal(pinnedRateCardKey("rate-cards/tok/../other/x.pdf", "tok"), null);
  assert.equal(pinnedRateCardKey("rate-cards/tokx/a.pdf", "tok"), null);
  assert.equal(pinnedRateCardKey("", "tok"), null);
});

test("normalizeMediaKitUrl: http(s) only, scheme added to bare hosts", () => {
  assert.equal(normalizeMediaKitUrl("https://example.com/kit.pdf", safeExternalUrl), "https://example.com/kit.pdf");
  assert.equal(normalizeMediaKitUrl("example.com/kit.pdf", safeExternalUrl), "https://example.com/kit.pdf");
  assert.equal(normalizeMediaKitUrl("javascript:alert(1)", safeExternalUrl), null);
  assert.equal(normalizeMediaKitUrl("data:text/html,x", safeExternalUrl), null);
  assert.equal(normalizeMediaKitUrl("  ", safeExternalUrl), null);
});
