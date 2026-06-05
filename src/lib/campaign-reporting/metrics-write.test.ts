import { test } from "node:test";
import assert from "node:assert/strict";
import { canOverwrite, buildFreezeSnapshot } from "./metrics-write";

test("canOverwrite: DESK always wins", () => {
  assert.equal(canOverwrite("DESK", "DESK"), true);
  assert.equal(canOverwrite("PUBLISHER_FORM", "DESK"), false); // form cannot overwrite a desk value
});
test("canOverwrite: FORM beats EMAIL, EMAIL cannot overwrite FORM", () => {
  assert.equal(canOverwrite("PUBLISHER_FORM", "PUBLISHER_EMAIL"), true);
  assert.equal(canOverwrite("PUBLISHER_EMAIL", "PUBLISHER_FORM"), false);
});
test("canOverwrite: same source overwrites (latest reading wins)", () => {
  assert.equal(canOverwrite("PUBLISHER_EMAIL", "PUBLISHER_EMAIL"), true);
});
test("canOverwrite: any source writes a fresh (null existing) row", () => {
  assert.equal(canOverwrite("PUBLISHER_EMAIL", null), true);
});

test("buildFreezeSnapshot copies current impressions + first-party clicks, stamps frozenAt", () => {
  const now = new Date("2026-06-12T00:00:00Z");
  assert.deepEqual(
    buildFreezeSnapshot({ impressions: 5000 }, 320, now),
    { frozenAt: now, impressionsAtClose: 5000, clicksFirstPartyAtClose: 320 },
  );
  assert.deepEqual(
    buildFreezeSnapshot({ impressions: null }, 0, now),
    { frozenAt: now, impressionsAtClose: null, clicksFirstPartyAtClose: 0 },
  );
});
