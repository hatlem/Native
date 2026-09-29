import { test } from "node:test";
import assert from "node:assert/strict";
import { inviteLandingPath } from "./invite-landing";

test("an org with plans lands the new member on its saved lists", () => {
  assert.equal(inviteLandingPath("no", 8), "/no/lists?joined=1");
});

test("an org without plans lands the new member on the buyer home", () => {
  assert.equal(inviteLandingPath("en", 0), "/en/home?joined=1");
});

test("never lands on the account/team settings page", () => {
  for (const n of [0, 1, 50]) assert.ok(!inviteLandingPath("sv", n).includes("/account"));
});
