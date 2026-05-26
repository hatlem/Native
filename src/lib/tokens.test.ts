import { test } from "node:test";
import assert from "node:assert/strict";
import { generateToken, hashToken, tokenExpiry, AUTH_TOKEN_TTL_MIN } from "./tokens";

test("generateToken yields 43-char url-safe base64 (32 bytes → 43 chars without padding)", () => {
  const t = generateToken();
  assert.equal(t.length, 43);
  assert.match(t, /^[A-Za-z0-9_-]+$/);
});

test("generateToken collisions are statistically implausible", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i += 1) {
    const t = generateToken();
    assert.equal(seen.has(t), false);
    seen.add(t);
  }
});

test("hashToken is deterministic and yields 64-char hex", () => {
  const raw = "abc123";
  const h1 = hashToken(raw);
  const h2 = hashToken(raw);
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
  assert.match(h1, /^[0-9a-f]+$/);
});

test("hashToken distinguishes different inputs", () => {
  assert.notEqual(hashToken("a"), hashToken("b"));
});

test("tokenExpiry returns a date AUTH_TOKEN_TTL_MIN minutes in the future", () => {
  const before = Date.now();
  const exp = tokenExpiry().getTime();
  const after = Date.now();
  const expectedMs = AUTH_TOKEN_TTL_MIN * 60_000;
  assert.ok(exp - before >= expectedMs - 1000);
  assert.ok(exp - after <= expectedMs + 1000);
});
