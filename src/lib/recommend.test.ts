import { test } from "node:test";
import assert from "node:assert/strict";
import { recommendMix, recommendTiered, type Candidate, type SupplementaryTitle } from "./recommend";

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

const sup = (id: string, reach: number): SupplementaryTitle => ({
  titleId: `t-${id}`,
  titleName: id,
  productId: `p-${id}`,
  reach,
  currency: "NOK",
});

test("recommendTiered: tier1 packs to budget, tier2 fills from unpriced by reach", () => {
  const priced = [c("a", "Alpha", 100, 40), c("b", "Beta", 90, 50)];
  const unpriced = [sup("x", 200), sup("y", 50), sup("z", 300)];
  const r = recommendTiered(priced, unpriced, 60, { supplementaryCap: 2 });
  assert.deepEqual(r.picks.map((p) => p.titleName), ["Alpha"]);
  assert.deepEqual(r.supplementary.map((s) => s.titleName), ["z", "x"]);
});

test("recommendTiered: excludes already-picked titles from supplementary", () => {
  const priced = [c("a", "Alpha", 100, 40)];
  const unpriced = [sup("Alpha", 999), sup("y", 10)];
  const r = recommendTiered(priced, unpriced, 100);
  assert.ok(!r.supplementary.some((s) => s.titleId === "t-Alpha"));
  assert.deepEqual(r.supplementary.map((s) => s.titleName), ["y"]);
});

test("recommendTiered: no budget (MAX_SAFE) returns all priced + supplementary", () => {
  const priced = [c("a", "Alpha", 100, 40), c("b", "Beta", 90, 50)];
  const r = recommendTiered(priced, [sup("x", 5)], Number.MAX_SAFE_INTEGER);
  assert.equal(r.picks.length, 2);
  assert.deepEqual(r.supplementary.map((s) => s.titleName), ["x"]);
});
