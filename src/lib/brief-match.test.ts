import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractFacets,
  scoreTitle,
  matchTitles,
  mergeFacets,
  facetsAreEmpty,
  type MatchableTitle,
} from "./brief-match";

const title = (over: Partial<MatchableTitle>): MatchableTitle => ({
  id: "t",
  name: "T",
  b2bB2c: null,
  vertical: null,
  audience: null,
  category: null,
  reach: null,
  nativeFit: null,
  tags: null,
  locationNote: null,
  digitalReach: null,
  monthlyReach: null,
  ...over,
});

test("extractFacets reads the user's brief: business in Oslo", () => {
  const f = extractFacets("We only sell to business in Oslo, Norway");
  assert.equal(f.audienceType, "B2B");
  assert.deepEqual(f.locations, ["oslo"]);
});

test("extractFacets detects industries multilingually", () => {
  assert.ok(extractFacets("we target the finance and insurance sector").industries.includes("finance"));
  assert.ok(extractFacets("vi selger til advokater og juss").industries.includes("legal"));
  assert.ok(extractFacets("healthcare and pharma buyers").industries.includes("health"));
});

test("extractFacets resolves B2C and treats mixed signals as ambiguous", () => {
  assert.equal(extractFacets("for general consumers and households").audienceType, "B2C");
  // both business and consumer present -> ambiguous (null)
  assert.equal(extractFacets("we sell to business and consumers alike").audienceType, null);
});

test("extractFacets picks up geo scope and strips stopwords from keywords", () => {
  const f = extractFacets("a nationwide campaign for outdoor enthusiasts");
  assert.ok(f.geoScopes.includes("National"));
  assert.ok(f.keywords.includes("outdoor"));
  assert.ok(!f.keywords.includes("for")); // stopword
});

test("scoreTitle rewards audience + industry + reasons", () => {
  const f = extractFacets("business buyers in finance");
  const t = title({ b2bB2c: "B2B", vertical: "B2B – Finance & Insurance", audience: "Business decision-makers" });
  const { score, reasons } = scoreTitle(t, f);
  assert.ok(score >= 9); // 5 audience + 4 industry
  assert.ok(reasons.includes("B2B"));
  assert.ok(reasons.includes("finance"));
});

test("matchTitles ranks the on-brief title above an off-brief one", () => {
  const f = extractFacets("we only sell to business in Oslo");
  const onBrief = title({ id: "biz", name: "Finansavisen", b2bB2c: "B2B", audience: "Business decision-makers", reach: "National" });
  const offBrief = title({ id: "con", name: "Allers", b2bB2c: "B2C", audience: "General consumer", reach: "National" });
  const ranked = matchTitles([offBrief, onBrief], f);
  assert.equal(ranked[0].title.id, "biz");
});

test("matchTitles filters below minScore and respects limit + reach tie-break", () => {
  const f = extractFacets("finance");
  const a = title({ id: "a", vertical: "B2B – Finance & Insurance", digitalReach: 100 });
  const b = title({ id: "b", vertical: "B2B – Finance & Insurance", digitalReach: 900 });
  const c = title({ id: "c", vertical: "Sports" }); // no finance -> score 0
  const ranked = matchTitles([a, b, c], f, { limit: 5 });
  assert.equal(ranked.length, 2); // c filtered out
  assert.equal(ranked[0].title.id, "b"); // higher reach breaks the tie
});

test("mergeFacets unions and only fills a missing audienceType", () => {
  const base = extractFacets("finance in oslo");
  const merged = mergeFacets(base, { audienceType: "B2B", industries: ["tech"], keywords: ["startup"] });
  assert.equal(merged.audienceType, "B2B"); // base had none -> filled
  assert.ok(merged.industries.includes("finance") && merged.industries.includes("tech"));
  assert.ok(merged.keywords.includes("startup"));
  // a deterministic audienceType is never overridden
  const b2c = mergeFacets(extractFacets("for consumers"), { audienceType: "B2B" });
  assert.equal(b2c.audienceType, "B2C");
});

test("facetsAreEmpty detects a signal-free brief", () => {
  assert.equal(facetsAreEmpty(extractFacets("hello there")), false); // "hello"/"there" -> keywords
  assert.equal(facetsAreEmpty(extractFacets("to the and of")), true); // all stopwords
});
