import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOrderRequest } from "./order-request";

test("parseOrderRequest accepts valid items and dedupes by productId summing qty", () => {
  const r = parseOrderRequest({
    items: [
      { productId: "p1", quantity: 2 },
      { productId: "p1", quantity: 1 },
      { productId: "p2", quantity: 3 },
    ],
  });
  assert.deepEqual(r, {
    ok: true,
    items: [
      { productId: "p1", quantity: 3 },
      { productId: "p2", quantity: 3 },
    ],
    reference: null,
  });
});

test("parseOrderRequest keeps a string reference (trimmed to 200 chars)", () => {
  const long = "x".repeat(250);
  const r = parseOrderRequest({
    items: [{ productId: "p1", quantity: 1 }],
    reference: long,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.reference, "x".repeat(200));
    assert.deepEqual(r.items, [{ productId: "p1", quantity: 1 }]);
  }
});

test("parseOrderRequest rejects empty items", () => {
  assert.deepEqual(parseOrderRequest({ items: [] }), {
    ok: false,
    error: "no_items",
  });
});

test("parseOrderRequest rejects non-positive / non-integer quantity", () => {
  assert.deepEqual(parseOrderRequest({ items: [{ productId: "p1", quantity: 0 }] }), {
    ok: false,
    error: "bad_quantity",
  });
  assert.deepEqual(parseOrderRequest({ items: [{ productId: "p1", quantity: 1.5 }] }), {
    ok: false,
    error: "bad_quantity",
  });
});

test("parseOrderRequest rejects malformed body", () => {
  assert.deepEqual(parseOrderRequest(null), { ok: false, error: "bad_body" });
  assert.deepEqual(parseOrderRequest({ items: "nope" }), {
    ok: false,
    error: "bad_body",
  });
  assert.deepEqual(parseOrderRequest({ items: [{ quantity: 1 }] }), {
    ok: false,
    error: "bad_item",
  });
});
