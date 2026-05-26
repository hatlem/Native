import { test } from "node:test";
import assert from "node:assert/strict";
import { hasScope, parseScopes } from "./auth";

test("parseScopes splits comma list and trims", () => {
  assert.deepEqual(parseScopes("catalog:read, pricing:admin "), [
    "catalog:read",
    "pricing:admin",
  ]);
});

test("hasScope is exact-match", () => {
  assert.equal(hasScope("catalog:read,pricing:admin", "pricing:admin"), true);
  assert.equal(hasScope("catalog:read", "pricing:admin"), false);
  assert.equal(hasScope("", "pricing:admin"), false);
});

test("parseScopes drops empties", () => {
  assert.deepEqual(parseScopes(""), []);
  assert.deepEqual(parseScopes(" , catalog:read , "), ["catalog:read"]);
});

test("hasScope rejects unknown scopes", () => {
  // @ts-expect-error — runtime test of a known-invalid scope
  assert.equal(hasScope("catalog:read", "not:a:scope"), false);
});
