import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateApiToken,
  hashApiToken,
  extractApiToken,
  looksLikeApiToken,
  parseScopes,
  hasScope,
} from "./api-key";

test("generateApiToken emits the atn_ prefix and url-safe chars", () => {
  const t = generateApiToken();
  assert.ok(t.startsWith("atn_"));
  // 48 url-safe chars after the prefix.
  assert.match(t, /^atn_[A-Za-z0-9_-]{47,49}$/);
});

test("generateApiToken collisions are statistically implausible", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i += 1) {
    const t = generateApiToken();
    assert.equal(seen.has(t), false);
    seen.add(t);
  }
});

test("hashApiToken is deterministic and 64 hex chars", () => {
  const t = "atn_static-test-token";
  const a = hashApiToken(t);
  const b = hashApiToken(t);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("hashApiToken: different inputs hash differently", () => {
  const a = hashApiToken("atn_token-one");
  const b = hashApiToken("atn_token-two");
  assert.notEqual(a, b);
});

test("extractApiToken strips a Bearer prefix and tolerates either form", () => {
  assert.equal(extractApiToken("Bearer atn_abc"), "atn_abc");
  assert.equal(extractApiToken("  Bearer   atn_abc  "), "atn_abc");
  // Bare token (some HTTP clients omit Bearer).
  assert.equal(extractApiToken("atn_abc"), "atn_abc");
});

test("extractApiToken returns null for empty / missing", () => {
  assert.equal(extractApiToken(null), null);
  assert.equal(extractApiToken(""), null);
  assert.equal(extractApiToken("Bearer "), null);
});

test("looksLikeApiToken catches the prefix + length", () => {
  assert.equal(looksLikeApiToken("atn_" + "x".repeat(48)), true);
  assert.equal(looksLikeApiToken("atn_short"), false); // too short
  assert.equal(looksLikeApiToken("bearer_atn_xxxxxx"), false); // wrong prefix
});

test("parseScopes splits and trims; ignores empties", () => {
  const s = parseScopes("catalog:read, , catalog:write");
  assert.equal(s.has("catalog:read"), true);
  assert.equal(s.has("catalog:write"), true);
  assert.equal(s.size, 2);
});

test("hasScope: exact + wildcard + global", () => {
  const ro = parseScopes("catalog:read");
  assert.equal(hasScope(ro, "catalog:read"), true);
  assert.equal(hasScope(ro, "catalog:write"), false);

  const cat = parseScopes("catalog:*");
  assert.equal(hasScope(cat, "catalog:read"), true);
  assert.equal(hasScope(cat, "catalog:write"), true);
  assert.equal(hasScope(cat, "orders:read"), false);

  const all = parseScopes("*");
  assert.equal(hasScope(all, "anything:goes"), true);
});
