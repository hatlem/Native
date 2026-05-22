import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "./rate-limit";

test("first capacity calls pass; (capacity+1)th call is blocked", () => {
  const rl = new RateLimiter(3, 100); // 100/sec — refill won't matter in this tick
  rl._now = () => 0;
  assert.equal(rl.check("a").ok, true);
  assert.equal(rl.check("a").ok, true);
  assert.equal(rl.check("a").ok, true);
  assert.equal(rl.check("a").ok, false);
});

test("buckets are isolated per key", () => {
  const rl = new RateLimiter(1, 0);
  rl._now = () => 0;
  assert.equal(rl.check("user-1").ok, true);
  assert.equal(rl.check("user-1").ok, false);
  // user-2 unaffected:
  assert.equal(rl.check("user-2").ok, true);
});

test("tokens refill over time", () => {
  const rl = new RateLimiter(2, 2); // 2 per second
  let t = 0;
  rl._now = () => t;
  assert.equal(rl.check("x").ok, true);
  assert.equal(rl.check("x").ok, true);
  assert.equal(rl.check("x").ok, false);
  t = 1000; // one second later -> 2 tokens refilled
  assert.equal(rl.check("x").ok, true);
  assert.equal(rl.check("x").ok, true);
  assert.equal(rl.check("x").ok, false);
});

test("retryAfterMs reports time until next allowed call", () => {
  const rl = new RateLimiter(1, 1); // 1 per second
  let t = 0;
  rl._now = () => t;
  assert.equal(rl.check("y").ok, true);
  const blocked = rl.check("y");
  assert.equal(blocked.ok, false);
  // Need ~1s until the next token; allow rounding noise.
  assert.ok(blocked.retryAfterMs >= 900 && blocked.retryAfterMs <= 1100, String(blocked.retryAfterMs));
});
