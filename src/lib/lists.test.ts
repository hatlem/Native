import { test } from "node:test";
import assert from "node:assert/strict";
import { assertItemShape, listForcesRfq, ACTIVE_LIST_COOKIE, snapshotListToPlanData } from "./lists";

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

test("snapshotListToPlanData preserves product and title shape", () => {
  const data = snapshotListToPlanData([
    { productId: "p1", titleId: null, quantity: 2, withContent: false, authorshipMode: "BUYER_SUPPLIED", notes: null },
    { productId: null, titleId: "t1", quantity: 1, withContent: true, authorshipMode: "NATIVESPIN_PRODUCED", notes: "x" },
  ]);
  assert.equal(data.length, 2);
  assert.equal(data[0].productId, "p1");
  assert.equal(data[0].titleId, null);
  assert.equal(data[1].productId, null);
  assert.equal(data[1].titleId, "t1");
});
