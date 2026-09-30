import { test } from "node:test";
import assert from "node:assert/strict";
import { OrderStatus } from "@prisma/client";
import {
  canCancelOrder,
  cancelBlockKey,
  normaliseReason,
} from "./cancellation";

test("canCancelOrder allows pre-live states", () => {
  assert.equal(canCancelOrder(OrderStatus.QUOTED), true);
  assert.equal(canCancelOrder(OrderStatus.CONFIRMED), true);
  assert.equal(canCancelOrder(OrderStatus.IN_PRODUCTION), true);
  assert.equal(canCancelOrder(OrderStatus.SCHEDULED), true);
});

test("canCancelOrder refuses post-publication states (credit-note territory)", () => {
  assert.equal(canCancelOrder(OrderStatus.LIVE), false);
  assert.equal(canCancelOrder(OrderStatus.COMPLETED), false);
  assert.equal(canCancelOrder(OrderStatus.INVOICED), false);
});

test("canCancelOrder is idempotent on already-cancelled orders", () => {
  assert.equal(canCancelOrder(OrderStatus.CANCELLED), false);
});

test("cancelBlockKey points each locked status at its reachable next step", () => {
  // A campaign that ran is invoiced first, then credited if needed.
  assert.equal(cancelBlockKey(OrderStatus.LIVE), "ran");
  assert.equal(cancelBlockKey(OrderStatus.COMPLETED), "ran");
  // An invoiced order is credited directly.
  assert.equal(cancelBlockKey(OrderStatus.INVOICED), "invoiced");
  assert.equal(cancelBlockKey(OrderStatus.CANCELLED), "cancelled");
  // No key when cancellation is allowed.
  assert.equal(cancelBlockKey(OrderStatus.CONFIRMED), null);
  assert.equal(cancelBlockKey(OrderStatus.SCHEDULED), null);
});

test("normaliseReason trims and drops empty input", () => {
  assert.equal(normaliseReason(""), null);
  assert.equal(normaliseReason("   "), null);
  assert.equal(normaliseReason(null), null);
  assert.equal(normaliseReason(undefined), null);
  assert.equal(normaliseReason("  proper reason  "), "proper reason");
});

test("normaliseReason caps absurdly long input at a defensible length", () => {
  const tooLong = "x".repeat(3000);
  const out = normaliseReason(tooLong);
  assert.ok(out);
  assert.equal(out.length, 2000);
});
