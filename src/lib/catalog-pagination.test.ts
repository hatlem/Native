import { test } from "node:test";
import assert from "node:assert/strict";
import { pageWindow } from "./catalog-pagination";

test("single page: just [1], no ellipsis", () => {
  assert.deepEqual(pageWindow(1, 1), [1]);
});

test("few pages: shows every page, no ellipsis needed", () => {
  assert.deepEqual(pageWindow(1, 3), [1, 2, 3]);
  assert.deepEqual(pageWindow(2, 4), [1, 2, 3, 4]);
});

test("current page near the start: no leading ellipsis, trailing ellipsis before last", () => {
  assert.deepEqual(pageWindow(1, 48), [1, 2, "ellipsis", 48]);
  assert.deepEqual(pageWindow(2, 48), [1, 2, 3, "ellipsis", 48]);
});

test("current page near the end: leading ellipsis, no trailing ellipsis", () => {
  assert.deepEqual(pageWindow(48, 48), [1, "ellipsis", 47, 48]);
  assert.deepEqual(pageWindow(47, 48), [1, "ellipsis", 46, 47, 48]);
});

test("current page in the middle: ellipsis on both sides", () => {
  assert.deepEqual(pageWindow(24, 48), [1, "ellipsis", 23, 24, 25, "ellipsis", 48]);
});

test("first and last page never duplicate into the middle window", () => {
  // current=2 on a 3-page total: middle window would naively include 1..3,
  // but 1 and total are already pinned at the ends.
  const items = pageWindow(2, 3);
  assert.equal(items.filter((i) => i === 1).length, 1);
  assert.equal(items.filter((i) => i === 3).length, 1);
});
