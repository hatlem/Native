import { test } from "node:test";
import assert from "node:assert/strict";
import { tierSlices } from "./catalog-tiers";

test("tierSlices: first page fills from the first tier, then the next", () => {
  assert.deepEqual(tierSlices([3, 10, 100], 0, 5), [
    { tier: 0, skip: 0, take: 3 },
    { tier: 1, skip: 0, take: 2 },
  ]);
});

test("tierSlices: a later page starts inside a later tier", () => {
  assert.deepEqual(tierSlices([3, 10, 100], 5, 5), [{ tier: 1, skip: 2, take: 5 }]);
  assert.deepEqual(tierSlices([3, 10, 100], 10, 5), [
    { tier: 1, skip: 7, take: 3 },
    { tier: 2, skip: 0, take: 2 },
  ]);
});

test("tierSlices: empty tiers are skipped and a page past the end is empty", () => {
  assert.deepEqual(tierSlices([0, 4, 0, 2], 0, 60), [
    { tier: 1, skip: 0, take: 4 },
    { tier: 3, skip: 0, take: 2 },
  ]);
  assert.deepEqual(tierSlices([2, 2], 60, 60), []);
});
