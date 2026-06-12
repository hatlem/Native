import { test } from "node:test";
import assert from "node:assert/strict";
import { productDisplayName, productDisplayNames } from "./display-name";

// Fake translator: returns "key(values)" so assertions see exactly which
// template was chosen and what was interpolated.
const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}(${Object.values(values).join(",")})` : key;

// Fake locale formatter: nb-NO style thin grouping, deterministic.
const formatNumber = (n: number) =>
  n.toLocaleString("en-US").replace(/,/g, " ");

test("typeLabel alone when inclusions are null", () => {
  assert.equal(
    productDisplayName({ typeLabel: "Native article", inclusions: null, formatNumber, t }),
    "Native article",
  );
});

test("typeLabel alone when inclusions carry no name-worthy fact", () => {
  assert.equal(
    productDisplayName({
      typeLabel: "Native article",
      inclusions: { frontpage: true, newsletter: true },
      formatNumber,
      t,
    }),
    "Native article",
  );
});

test("articles beats viewsPerWeek (priority order)", () => {
  assert.equal(
    productDisplayName({
      typeLabel: "Native article",
      inclusions: { articles: 3, viewsPerWeek: 20_000 },
      formatNumber,
      t,
    }),
    "Native article — nameQ.articles(3)",
  );
});

test("viewsPerWeek beats viewsPerMonth and lower metrics", () => {
  assert.equal(
    productDisplayName({
      typeLabel: "Native article",
      inclusions: { viewsPerWeek: 5_000, viewsPerMonth: 80_000, viewsTotal: 100_000 },
      formatNumber,
      t,
    }),
    "Native article — nameQ.viewsPerWeek(5 000)",
  );
});

test("amount goes through the provided formatNumber", () => {
  assert.equal(
    productDisplayName({
      typeLabel: "Native article",
      inclusions: { viewsPerMonth: 1000 },
      formatNumber,
      t,
    }),
    "Native article — nameQ.viewsPerMonth(1 000)",
  );
});

test("articles of 1 is not a qualifier", () => {
  assert.equal(
    productDisplayName({
      typeLabel: "Native article",
      inclusions: { articles: 1, readsTotal: 4_000 },
      formatNumber,
      t,
    }),
    "Native article — nameQ.readsTotal(4 000)",
  );
});

test("print qualifies only when nothing else does", () => {
  assert.equal(
    productDisplayName({
      typeLabel: "Advertorial",
      inclusions: { print: true },
      formatNumber,
      t,
    }),
    "Advertorial — nameQ.print",
  );
  assert.equal(
    productDisplayName({
      typeLabel: "Advertorial",
      inclusions: { print: true, durationWeeks: 2 },
      formatNumber,
      t,
    }),
    "Advertorial — nameQ.durationWeeks(2)",
  );
});

test("collision: articles count appended as second qualifier", () => {
  // Akersposten shape: 1/2/3 saker, all 80k views/month. The multi-article
  // ones differ via priority 1; a pair sharing the metric and articles=1
  // vs absent collides and gets the count appended.
  const names = productDisplayNames(
    [
      { typeLabel: "Native article", inclusions: { articles: 1, viewsPerMonth: 80_000 } },
      { typeLabel: "Native article", inclusions: { viewsPerMonth: 80_000 } },
      { typeLabel: "Native article", inclusions: { articles: 3, viewsPerMonth: 80_000 } },
    ],
    formatNumber,
    t,
  );
  assert.deepEqual(names, [
    "Native article — nameQ.viewsPerMonth(80 000) · nameQ.articles(1)",
    "Native article — nameQ.viewsPerMonth(80 000)",
    "Native article — nameQ.articles(3)",
  ]);
});

test("collision without an articles disambiguator stays identical", () => {
  const names = productDisplayNames(
    [
      { typeLabel: "Native article", inclusions: { viewsPerMonth: 80_000 } },
      { typeLabel: "Native article", inclusions: { viewsPerMonth: 80_000, frontpage: true } },
    ],
    formatNumber,
    t,
  );
  assert.deepEqual(names, [
    "Native article — nameQ.viewsPerMonth(80 000)",
    "Native article — nameQ.viewsPerMonth(80 000)",
  ]);
});

test("unique names are left untouched", () => {
  const names = productDisplayNames(
    [
      { typeLabel: "Native article", inclusions: { viewsPerMonth: 80_000 } },
      { typeLabel: "Native display", inclusions: null },
    ],
    formatNumber,
    t,
  );
  assert.deepEqual(names, [
    "Native article — nameQ.viewsPerMonth(80 000)",
    "Native display",
  ]);
});
