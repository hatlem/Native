import { test } from "node:test";
import assert from "node:assert/strict";
import { pageHref, pageWindow, parsePageParam } from "./pagination";

test("parsePageParam: defaults to 1 for junk", () => {
  assert.equal(parsePageParam(undefined), 1);
  assert.equal(parsePageParam("abc"), 1);
  assert.equal(parsePageParam("0"), 1);
  assert.equal(parsePageParam("-3"), 1);
  assert.equal(parsePageParam(["2", "3"]), 1);
  assert.equal(parsePageParam("4"), 4);
});

test("pageWindow: clamps to the last page and computes skip/take", () => {
  assert.deepEqual(pageWindow(1, 0, 50), { page: 1, pageCount: 1, skip: 0, take: 50 });
  assert.deepEqual(pageWindow(2, 120, 50), { page: 2, pageCount: 3, skip: 50, take: 50 });
  assert.deepEqual(pageWindow(999, 120, 50), { page: 3, pageCount: 3, skip: 100, take: 50 });
  assert.deepEqual(pageWindow(1, 50, 50), { page: 1, pageCount: 1, skip: 0, take: 50 });
});

test("pageHref: keeps filters, drops empty ones, omits page 1", () => {
  assert.equal(pageHref("/desk/orders", { sort: "created", dir: "desc" }, 1), "/desk/orders?sort=created&dir=desc");
  assert.equal(pageHref("/desk/orders", { sort: "created", dir: "" }, 3), "/desk/orders?sort=created&page=3");
  assert.equal(pageHref("/invoices", {}, 1), "/invoices");
});
