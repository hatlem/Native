import { test } from "node:test";
import assert from "node:assert/strict";
import { onboardingNeeds, safeNext } from "./onboarding-gate";

test("org creator of a fresh org is asked for the market (first-time onboarding)", () => {
  assert.deepEqual(onboardingNeeds({ orgMarketCode: null, canSetMarket: true }), {
    askMarket: true,
    marketBlocked: false,
    complete: false,
  });
});

test("a member invited into an onboarded org skips onboarding entirely", () => {
  // No market question (it can't be overwritten from here) and no phone gate.
  assert.deepEqual(onboardingNeeds({ orgMarketCode: "NO", canSetMarket: false }), {
    askMarket: false,
    marketBlocked: false,
    complete: true,
  });
});

test("an onboarded org is never re-asked, even for an admin", () => {
  assert.equal(onboardingNeeds({ orgMarketCode: "SE", canSetMarket: true }).askMarket, false);
  assert.equal(onboardingNeeds({ orgMarketCode: "SE", canSetMarket: true }).complete, true);
});

test("a member of an org nobody has onboarded yet is blocked, not asked", () => {
  assert.deepEqual(onboardingNeeds({ orgMarketCode: null, canSetMarket: false }), {
    askMarket: false,
    marketBlocked: true,
    complete: false,
  });
});

test("safeNext only allows same-origin paths", () => {
  assert.equal(safeNext("/no/plan", "/fallback"), "/no/plan");
  assert.equal(safeNext("//evil.com", "/fallback"), "/fallback");
  assert.equal(safeNext("https://evil.com", "/fallback"), "/fallback");
  assert.equal(safeNext(undefined, "/fallback"), "/fallback");
});
