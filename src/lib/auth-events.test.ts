import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldAlertOnNewSignin } from "./auth-events";

test("no alert when there's no previous IP (first sign-in)", () => {
  assert.equal(shouldAlertOnNewSignin(null, "203.0.113.1"), false);
});

test("no alert when IP matches the last sign-in", () => {
  assert.equal(shouldAlertOnNewSignin("203.0.113.1", "203.0.113.1"), false);
});

test("alert when IP differs", () => {
  assert.equal(shouldAlertOnNewSignin("203.0.113.1", "198.51.100.2"), true);
});

test("no alert when current IP is unknown/empty (don't email on noise)", () => {
  assert.equal(shouldAlertOnNewSignin("203.0.113.1", ""), false);
  assert.equal(shouldAlertOnNewSignin("203.0.113.1", "unknown"), false);
});
