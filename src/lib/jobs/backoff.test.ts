import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_BACKOFF_MS, backoffDelayMs, nextStepAfterFailure } from "./backoff";

test("backoffDelayMs doubles per failed attempt from the base", () => {
  assert.equal(backoffDelayMs(1, 30_000, 0), 30_000);
  assert.equal(backoffDelayMs(2, 30_000, 0), 60_000);
  assert.equal(backoffDelayMs(3, 30_000, 0), 120_000);
  assert.equal(backoffDelayMs(5, 30_000, 0), 480_000);
});

test("backoffDelayMs is capped at an hour, plus at most 20 % jitter", () => {
  assert.equal(backoffDelayMs(40, 30_000, 0), MAX_BACKOFF_MS);
  const jittered = backoffDelayMs(40, 30_000, 0.999);
  assert.ok(jittered > MAX_BACKOFF_MS && jittered <= MAX_BACKOFF_MS * 1.2);
  assert.ok(backoffDelayMs(1, 30_000, 0.5) > 30_000);
});

test("backoffDelayMs treats a nonsense attempt number as the first", () => {
  assert.equal(backoffDelayMs(0, 1000, 0), 1000);
  assert.equal(backoffDelayMs(-3, 1000, 0), 1000);
});

test("nextStepAfterFailure retries until the attempt budget is spent", () => {
  assert.equal(nextStepAfterFailure({ attempts: 1, maxAttempts: 3, nonRetryable: false }), "retry");
  assert.equal(nextStepAfterFailure({ attempts: 2, maxAttempts: 3, nonRetryable: false }), "retry");
  assert.equal(nextStepAfterFailure({ attempts: 3, maxAttempts: 3, nonRetryable: false }), "dead-letter");
});

test("nextStepAfterFailure dead-letters a non-retryable error at once", () => {
  assert.equal(nextStepAfterFailure({ attempts: 1, maxAttempts: 5, nonRetryable: true }), "dead-letter");
});
