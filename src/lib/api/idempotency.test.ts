import { test } from "node:test";
import assert from "node:assert/strict";
import { hashRequestBody, isValidIdempotencyKey } from "./idempotency";

// ---- isValidIdempotencyKey ----

test("isValidIdempotencyKey accepts typical client-minted keys", () => {
  assert.equal(isValidIdempotencyKey("a"), true); // 1 char minimum
  assert.equal(isValidIdempotencyKey("550e8400-e29b-41d4-a716-446655440000"), true); // UUID
  assert.equal(isValidIdempotencyKey("order-2026-08-19_retry#1"), true); // punctuation
  assert.equal(isValidIdempotencyKey("x".repeat(255)), true); // max length
});

test("isValidIdempotencyKey rejects empty and overlong keys", () => {
  assert.equal(isValidIdempotencyKey(""), false);
  assert.equal(isValidIdempotencyKey("x".repeat(256)), false);
});

test("isValidIdempotencyKey rejects whitespace, control chars, and non-ASCII", () => {
  assert.equal(isValidIdempotencyKey("has space"), false);
  assert.equal(isValidIdempotencyKey("tab\there"), false);
  assert.equal(isValidIdempotencyKey("new\nline"), false);
  assert.equal(isValidIdempotencyKey("null\x00byte"), false);
  assert.equal(isValidIdempotencyKey("del\x7fchar"), false);
  assert.equal(isValidIdempotencyKey("nøkkel"), false); // non-ASCII
  assert.equal(isValidIdempotencyKey("ключ"), false);
  assert.equal(isValidIdempotencyKey("🔑"), false);
});

// ---- hashRequestBody ----

test("hashRequestBody is sha-256 hex of the raw body", () => {
  // Known vector: sha256("") — guards against accidental algorithm/encoding drift.
  assert.equal(
    hashRequestBody(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(
    hashRequestBody("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("hashRequestBody is byte-exact: whitespace and key order both matter", () => {
  const a = hashRequestBody('{"items":[{"productId":"p1","quantity":1}]}');
  const b = hashRequestBody('{"items": [{"productId":"p1","quantity":1}]}');
  const c = hashRequestBody('{"items":[{"quantity":1,"productId":"p1"}]}');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  // ...but the identical string always hashes identically.
  assert.equal(a, hashRequestBody('{"items":[{"productId":"p1","quantity":1}]}'));
});

test("hashRequestBody handles multi-byte UTF-8 payloads", () => {
  const a = hashRequestBody('{"reference":"Bygg & Anlegg — høst"}');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, hashRequestBody('{"reference":"Bygg & Anlegg — høst"}'));
});
