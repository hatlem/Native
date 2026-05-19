import { test } from "node:test";
import assert from "node:assert/strict";
import { recommendMix, type Candidate } from "./recommend";

const c = (
  id: string,
  title: string,
  reach: number,
  price: number,
  category = "news",
): Candidate => ({
  productId: `p-${id}`,
  titleId: `t-${title}`,
  titleName: title,
  category,
  type: "NATIVE_ARTICLE",
  reach,
  unitPrice: price,
});

test("picks the most reach-efficient products within budget", () => {
  const r = recommendMix(
    [
      c("1", "A", 1000, 100), // 10 reach/cost
      c("2", "B", 1000, 500), // 2
      c("3", "C", 900, 100), // 9
    ],
    250,
  );
  assert.deepEqual(
    r.picks.map((p) => p.titleName),
    ["A", "C"],
  );
  assert.equal(r.totalCost, 200);
  assert.equal(r.totalReach, 1900);
  assert.equal(r.remaining, 50);
});

test("never recommends the same title twice", () => {
  const r = recommendMix(
    [c("1", "A", 1000, 100), c("2", "A", 800, 50)],
    1000,
  );
  assert.equal(r.picks.length, 1);
  assert.equal(r.picks[0].titleName, "A");
});

test("respects a category filter", () => {
  const r = recommendMix(
    [
      c("1", "A", 1000, 100, "news"),
      c("2", "B", 1000, 100, "business"),
    ],
    1000,
    { category: "business" },
  );
  assert.deepEqual(
    r.picks.map((p) => p.titleName),
    ["B"],
  );
});

test("returns an empty mix when nothing fits the budget", () => {
  const r = recommendMix([c("1", "A", 1000, 5000)], 1000);
  assert.deepEqual(r.picks, []);
  assert.equal(r.totalCost, 0);
  assert.equal(r.remaining, 1000);
});

test("skips zero/unpriced candidates", () => {
  const r = recommendMix([c("1", "A", 1000, 0)], 1000);
  assert.deepEqual(r.picks, []);
});
