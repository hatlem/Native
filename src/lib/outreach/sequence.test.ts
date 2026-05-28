import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stepKindForCount,
  nextStepDate,
  isSequenceTerminal,
  MAX_STEPS,
} from "./sequence";

test("stepKindForCount maps 0/1/2 to initial/bump1/bump2", () => {
  assert.equal(stepKindForCount(0), "initial");
  assert.equal(stepKindForCount(1), "bump1");
  assert.equal(stepKindForCount(2), "bump2");
});

test("stepKindForCount throws past max", () => {
  assert.throws(() => stepKindForCount(3), /max_steps_exceeded/);
});

test("nextStepDate(initial) is 5 days out", () => {
  const now = new Date("2026-05-01T00:00:00Z");
  const next = nextStepDate("initial", now);
  assert.equal(next?.toISOString(), "2026-05-06T00:00:00.000Z");
});

test("nextStepDate(bump1) is 7 days out", () => {
  const now = new Date("2026-05-06T00:00:00Z");
  const next = nextStepDate("bump1", now);
  assert.equal(next?.toISOString(), "2026-05-13T00:00:00.000Z");
});

test("nextStepDate(bump2) is null — sequence terminates", () => {
  assert.equal(nextStepDate("bump2"), null);
});

test("isSequenceTerminal is true at MAX_STEPS or beyond", () => {
  assert.equal(isSequenceTerminal(2), false);
  assert.equal(isSequenceTerminal(3), true);
  assert.equal(MAX_STEPS, 3);
});
