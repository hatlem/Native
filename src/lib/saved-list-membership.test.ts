import { test } from "node:test";
import assert from "node:assert/strict";
import { savedListMembershipMap } from "./saved-list-membership";

test("empty input yields an empty map", () => {
  assert.equal(savedListMembershipMap([]).size, 0);
});

test("title-placeholder rows map titleId to listId", () => {
  const map = savedListMembershipMap([
    { listId: "l1", titleId: "t1", product: null },
    { listId: "l2", titleId: "t1", product: null },
  ]);
  assert.deepEqual(map.get("t1"), ["l1", "l2"]);
});

test("product-line rows map via product.titleId", () => {
  const map = savedListMembershipMap([
    { listId: "l1", titleId: null, product: { titleId: "t1" } },
  ]);
  assert.deepEqual(map.get("t1"), ["l1"]);
});

test("placeholder and product rows for the same title merge, listIds deduped", () => {
  const map = savedListMembershipMap([
    { listId: "l1", titleId: "t1", product: null },
    { listId: "l1", titleId: null, product: { titleId: "t1" } },
    { listId: "l2", titleId: null, product: { titleId: "t1" } },
    { listId: "l2", titleId: "t2", product: null },
  ]);
  assert.deepEqual(map.get("t1"), ["l1", "l2"]);
  assert.deepEqual(map.get("t2"), ["l2"]);
  assert.equal(map.size, 2);
});

test("explicit titleId wins over product.titleId on the same row", () => {
  const map = savedListMembershipMap([
    { listId: "l1", titleId: "t1", product: { titleId: "t2" } },
  ]);
  assert.deepEqual(map.get("t1"), ["l1"]);
  assert.equal(map.has("t2"), false);
});

test("rows with neither titleId nor product are ignored", () => {
  const map = savedListMembershipMap([
    { listId: "l1", titleId: null, product: null },
  ]);
  assert.equal(map.size, 0);
});
