import { test } from "node:test";
import assert from "node:assert/strict";
import { OrderStatus, ContentAssetStatus } from "@prisma/client";
import {
  canCancelOrder,
  cancelBlockReason,
  canRetractAsset,
  retractBlockReason,
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

test("cancelBlockReason surfaces the right next-step prompt per terminal status", () => {
  assert.match(cancelBlockReason(OrderStatus.LIVE), /credit note/i);
  assert.match(cancelBlockReason(OrderStatus.COMPLETED), /credit note/i);
  assert.match(cancelBlockReason(OrderStatus.INVOICED), /credit note/i);
  assert.match(cancelBlockReason(OrderStatus.CANCELLED), /already/i);
  // No reason when cancellation is allowed — empty string lets the UI
  // decide between "no block" and "explain block".
  assert.equal(cancelBlockReason(OrderStatus.CONFIRMED), "");
});

test("canRetractAsset allows every non-retracted draft state, including FINAL", () => {
  // Editorial veto fires *after* spec-check passes; FINAL must be
  // retractable or the firewall promise is empty in practice.
  assert.equal(canRetractAsset(ContentAssetStatus.DRAFT), true);
  assert.equal(canRetractAsset(ContentAssetStatus.IN_REVIEW), true);
  assert.equal(canRetractAsset(ContentAssetStatus.CHANGES_REQUESTED), true);
  assert.equal(canRetractAsset(ContentAssetStatus.APPROVED), true);
  assert.equal(canRetractAsset(ContentAssetStatus.FINAL), true);
});

test("canRetractAsset refuses an already-retracted asset (idempotent)", () => {
  assert.equal(canRetractAsset(ContentAssetStatus.RETRACTED), false);
  assert.match(retractBlockReason(ContentAssetStatus.RETRACTED), /already/i);
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
