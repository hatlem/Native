import { test } from "node:test";
import assert from "node:assert/strict";
import { statusTone, statusLabel } from "./status";

test("maps each enum value to its semantic tone", () => {
  assert.equal(statusTone("ACCEPTED"), "success");
  assert.equal(statusTone("PAID"), "success");
  assert.equal(statusTone("SUBMITTED"), "info");
  assert.equal(statusTone("IN_PRODUCTION"), "info");
  assert.equal(statusTone("PENDING"), "warning");
  assert.equal(statusTone("OVERDUE"), "warning");
  assert.equal(statusTone("CANCELLED"), "danger");
  assert.equal(statusTone("DRAFT"), "neutral");
});

test("is case-insensitive and falls back to neutral", () => {
  assert.equal(statusTone("accepted"), "success");
  assert.equal(statusTone("SOMETHING_NEW"), "neutral");
  assert.equal(statusTone(""), "neutral");
});

test("humanises the label", () => {
  assert.equal(statusLabel("IN_PRODUCTION"), "In production");
  assert.equal(statusLabel("PAID"), "Paid");
  assert.equal(statusLabel("CHANGES_REQUESTED"), "Changes requested");
});
