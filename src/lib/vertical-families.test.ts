import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isVerticalSelected,
  matchesCategoryFilter,
  toggleVerticalSelection,
  verticalFamilies,
  verticalFilterWhere,
  verticalHead,
} from "./vertical-families";

const options = [
  { value: "B2B – Healthcare", label: "B2B – helse" },
  { value: "B2B – Energy & Utilities", label: "B2B – energi og forsyning" },
  { value: "Business & Finance", label: "Næringsliv og finans" },
  { value: "News (Local)", label: "Nyheter (lokal)" },
  { value: "News (National)", label: "Nyheter (riks)" },
  { value: "Sports", label: "Sport" },
  { value: "Sports – Golf", label: "Sport – golf" },
  { value: "Children – Comics & TV", label: "Barn – tegneserier og TV" },
];

test("verticalHead reads the head of dash and bracket verticals", () => {
  assert.equal(verticalHead("B2B – Energy & Utilities"), "B2B");
  assert.equal(verticalHead("News (National quality)"), "News");
  assert.equal(verticalHead("Lifestyle"), null);
  assert.equal(verticalHead("Business & Finance"), null);
});

test("verticalFamilies groups shared heads, labelled in the buyer's language", () => {
  const families = verticalFamilies(options);
  assert.deepEqual(
    families.map((f) => [f.token, f.label, f.members.length]),
    [
      ["family:B2B", "B2B", 2],
      ["family:News", "Nyheter", 2],
      ["family:Sports", "Sport", 2],
    ],
  );
});

test("verticalFilterWhere: exact verticals and whole families combine with OR", () => {
  assert.equal(verticalFilterWhere([]), null);
  assert.deepEqual(verticalFilterWhere(["Sports – Golf"]), { vertical: { in: ["Sports – Golf"] } });
  const where = verticalFilterWhere(["family:B2B", "Business & Finance"]) as { OR: unknown[] };
  assert.deepEqual(where.OR[0], { vertical: { in: ["Business & Finance"] } });
  assert.deepEqual(where.OR[1], { vertical: { equals: "B2B", mode: "insensitive" } });
  assert.ok(where.OR.some((c) => JSON.stringify(c) === JSON.stringify({ vertical: { startsWith: "B2B –", mode: "insensitive" } })));
});

test("isVerticalSelected: a chosen family ticks its members", () => {
  assert.equal(isVerticalSelected("B2B – Healthcare", ["family:B2B"]), true);
  assert.equal(isVerticalSelected("Business & Finance", ["family:B2B"]), false);
  assert.equal(isVerticalSelected("Sports", ["family:Sports"]), true);
});

test("toggleVerticalSelection: a family replaces its members, unticking a member keeps the rest", () => {
  const [b2b] = verticalFamilies(options);
  assert.deepEqual(toggleVerticalSelection(["B2B – Healthcare", "Sports"], "family:B2B", b2b), ["Sports", "family:B2B"]);
  assert.deepEqual(toggleVerticalSelection(["family:B2B"], "family:B2B", b2b), []);
  assert.deepEqual(toggleVerticalSelection(["family:B2B"], "B2B – Healthcare", b2b), ["B2B – Energy & Utilities"]);
  assert.deepEqual(toggleVerticalSelection([], "Sports"), ["Sports"]);
  assert.deepEqual(toggleVerticalSelection(["Sports"], "Sports"), []);
});

test("matchesCategoryFilter ignores case and Nordic letters, and matches the stored value", () => {
  const finans = options[2];
  assert.equal(matchesCategoryFilter(finans, "NÆRING"), true);
  assert.equal(matchesCategoryFilter(finans, "naering"), true);
  assert.equal(matchesCategoryFilter(finans, "business"), true);
  assert.equal(matchesCategoryFilter(finans, "golf"), false);
  assert.equal(matchesCategoryFilter(finans, "  "), true);
});
