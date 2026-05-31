import { test } from "node:test";
import assert from "node:assert/strict";
import { isAudienceSegment, AUDIENCE_SEGMENTS } from "./segments";

test("isAudienceSegment accepts a known segment", () => {
  assert.equal(isAudienceSegment("b2b-decision-makers"), true);
});

test("isAudienceSegment rejects an unknown segment", () => {
  assert.equal(isAudienceSegment("crypto-whales"), false);
});

test("AUDIENCE_SEGMENTS has no duplicates", () => {
  assert.equal(new Set(AUDIENCE_SEGMENTS).size, AUDIENCE_SEGMENTS.length);
});
