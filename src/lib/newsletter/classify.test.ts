import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySubscribe } from "./classify";

test("classifySubscribe sends a confirm email for a brand-new email", () => {
  assert.equal(classifySubscribe({ existingStatus: null, suppressed: false }), "SEND_CONFIRM");
});

test("classifySubscribe re-sends confirm for a still-PENDING email", () => {
  assert.equal(classifySubscribe({ existingStatus: "PENDING", suppressed: false }), "SEND_CONFIRM");
});

test("classifySubscribe re-opts a previously UNSUBSCRIBED email back into confirm", () => {
  assert.equal(classifySubscribe({ existingStatus: "UNSUBSCRIBED", suppressed: false }), "SEND_CONFIRM");
});

test("classifySubscribe stays silent for an already-CONFIRMED email", () => {
  assert.equal(classifySubscribe({ existingStatus: "CONFIRMED", suppressed: false }), "SILENT_OK");
});

test("classifySubscribe stays silent for a suppressed email", () => {
  assert.equal(classifySubscribe({ existingStatus: null, suppressed: true }), "SILENT_OK");
});
