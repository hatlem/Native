import { test } from "node:test";
import assert from "node:assert/strict";
import { assertItemShape, listForcesRfq, ACTIVE_LIST_COOKIE } from "./lists";

test("assertItemShape accepts product-only", () => {
  assert.doesNotThrow(() => assertItemShape({ productId: "p1", titleId: null }));
});

test("assertItemShape accepts title-only", () => {
  assert.doesNotThrow(() => assertItemShape({ productId: null, titleId: "t1" }));
});

test("assertItemShape rejects both set", () => {
  assert.throws(() => assertItemShape({ productId: "p1", titleId: "t1" }), /exactly one/);
});

test("assertItemShape rejects neither set", () => {
  assert.throws(() => assertItemShape({ productId: null, titleId: null }), /exactly one/);
});

test("listForcesRfq true when any line is a title placeholder", () => {
  assert.equal(
    listForcesRfq([{ productId: "p", titleId: null }, { productId: null, titleId: "t" }]),
    true,
  );
});

test("listForcesRfq false when all lines are products", () => {
  assert.equal(
    listForcesRfq([{ productId: "p1", titleId: null }, { productId: "p2", titleId: null }]),
    false,
  );
});

test("cookie name is stable", () => {
  assert.equal(ACTIVE_LIST_COOKIE, "nativespin_active_list");
});
