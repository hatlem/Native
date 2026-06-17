import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBasket, clampQuantity, MAX_QTY } from "./basket";

test("parseBasket returns empty for missing or blank input", () => {
  assert.deepEqual(parseBasket(undefined), []);
  assert.deepEqual(parseBasket(null), []);
  assert.deepEqual(parseBasket(""), []);
});

test("parseBasket tolerates malformed JSON and non-arrays", () => {
  assert.deepEqual(parseBasket("{not json"), []);
  assert.deepEqual(parseBasket('{"productId":"p1"}'), []);
  assert.deepEqual(parseBasket("42"), []);
});

test("parseBasket drops entries without a string productId", () => {
  const raw = JSON.stringify([
    { quantity: 2 },
    { productId: 5, quantity: 1 },
    { productId: "p1", quantity: 3 },
  ]);
  assert.deepEqual(parseBasket(raw), [
    { productId: "p1", quantity: 3, withContent: false },
  ]);
});

test("parseBasket clamps quantity to a positive integer", () => {
  const raw = JSON.stringify([
    { productId: "a", quantity: 0 },
    { productId: "b", quantity: -4 },
    { productId: "c", quantity: 2.9 },
    { productId: "d" },
    { productId: "e", quantity: "7" },
  ]);
  assert.deepEqual(parseBasket(raw), [
    { productId: "a", quantity: 1, withContent: false },
    { productId: "b", quantity: 1, withContent: false },
    { productId: "c", quantity: 2, withContent: false },
    { productId: "d", quantity: 1, withContent: false },
    { productId: "e", quantity: 7, withContent: false },
  ]);
});

test("parseBasket carries the withContent flag (only literal true)", () => {
  const raw = JSON.stringify([
    { productId: "a", quantity: 1, withContent: true },
    { productId: "b", quantity: 1, withContent: "yes" },
    { productId: "c", quantity: 1 },
  ]);
  assert.deepEqual(parseBasket(raw), [
    { productId: "a", quantity: 1, withContent: true },
    { productId: "b", quantity: 1, withContent: false },
    { productId: "c", quantity: 1, withContent: false },
  ]);
});

test("parseBasket round-trips serialized items", () => {
  const items = [
    { productId: "p1", quantity: 1, withContent: false },
    { productId: "p2", quantity: 4, withContent: true },
  ];
  assert.deepEqual(parseBasket(JSON.stringify(items)), items);
});

test("clampQuantity floors at 1", () => {
  assert.equal(clampQuantity(0), 1);
  assert.equal(clampQuantity(-3), 1);
  assert.equal(clampQuantity(NaN), 1);
});
test("clampQuantity caps at MAX_QTY", () => {
  assert.equal(MAX_QTY, 20);
  assert.equal(clampQuantity(21), 20);
  assert.equal(clampQuantity(999), 20);
});
test("clampQuantity passes valid values through, truncating", () => {
  assert.equal(clampQuantity(1), 1);
  assert.equal(clampQuantity(5), 5);
  assert.equal(clampQuantity(3.7), 3);
});
