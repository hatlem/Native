import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateApiToken,
  hashApiToken,
  extractApiToken,
  looksLikeApiToken,
  parseScopes,
  hasScope,
  parseKeyBinding,
  validateKeyGrant,
  type KeyBinding,
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

test("parseKeyBinding: platform, organization, publisher — nothing else", () => {
  assert.deepEqual(parseKeyBinding(""), { kind: "platform" });
  assert.deepEqual(parseKeyBinding("org:abc"), { kind: "organization", id: "abc" });
  assert.deepEqual(parseKeyBinding("pub:xyz"), { kind: "publisher", id: "xyz" });
  assert.equal(parseKeyBinding("org:"), null);
  assert.equal(parseKeyBinding("abc"), null);
  assert.equal(parseKeyBinding("usr:abc"), null);
});

const PLATFORM: KeyBinding = { kind: "platform" };
const ORG: KeyBinding = { kind: "organization", id: "o1" };
const PUB: KeyBinding = { kind: "publisher", id: "p1" };

// BUG-prod-api-20: catalog:write was refused and no key could be bound to a
// publisher, so the ingestion API was unusable.
test("validateKeyGrant: catalog:write is issuable, and only to a publisher", () => {
  assert.equal(validateKeyGrant(parseScopes("catalog:write"), PUB), null);
  assert.equal(validateKeyGrant(parseScopes("catalog:read,catalog:write"), PUB), null);
  assert.equal(validateKeyGrant(parseScopes("catalog:write"), PLATFORM), "publisher_required_scope");
  assert.equal(validateKeyGrant(parseScopes("catalog:write"), ORG), "publisher_required_scope");
});

test("validateKeyGrant: orders:write needs an organization, pricing:admin the platform", () => {
  assert.equal(validateKeyGrant(parseScopes("orders:write"), ORG), null);
  assert.equal(validateKeyGrant(parseScopes("orders:write"), PLATFORM), "org_required_scope");
  assert.equal(validateKeyGrant(parseScopes("orders:write"), PUB), "org_required_scope");
  assert.equal(validateKeyGrant(parseScopes("pricing:admin"), PLATFORM), null);
  assert.equal(validateKeyGrant(parseScopes("pricing:admin"), ORG), "internal_only_scope");
  assert.equal(validateKeyGrant(parseScopes("pricing:admin"), PUB), "internal_only_scope");
});

test("validateKeyGrant: unknown or empty scopes are refused", () => {
  assert.equal(validateKeyGrant(parseScopes(""), PLATFORM), "scopes");
  assert.equal(validateKeyGrant(parseScopes("admin:*"), PLATFORM), "scopes");
  assert.equal(validateKeyGrant(parseScopes("catalog:read,catlog:read"), PLATFORM), "scopes");
  // The legacy wildcard stays issuable (existing integrations use it).
  assert.equal(validateKeyGrant(parseScopes("catalog:*"), PLATFORM), null);
  assert.equal(validateKeyGrant(parseScopes("catalog:read"), ORG), null);
});
