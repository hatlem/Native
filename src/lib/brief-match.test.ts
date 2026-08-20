import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractFacets,
  scoreTitle,
  matchTitles,
  mergeFacets,
  facetsAreEmpty,
  type MatchableTitle,
  type BriefFacets,
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
  description: null,
  keywords: [],
  aliases: [],
  audienceNote: null,
  city: null,
  region: null,
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

// ---------- Word-boundary matching (short-term substring bugs) ----------

test("extractFacets does not spuriously match short terms inside unrelated words", () => {
  // "with" contains "it" as a substring — must not trigger the tech industry.
  const f = extractFacets("we sell fleet tracking with GPS");
  assert.ok(!f.industries.includes("tech"));
  // "fleet"/"tracking" should surface the new transport industry instead.
  assert.ok(f.industries.includes("transport"));
});

test("scoreTitle does not match short industry terms as substrings of unrelated words", () => {
  const facetsAuto: BriefFacets = { audienceType: null, industries: ["auto"], geoScopes: [], locations: [], keywords: [] };
  // "car" (auto trigger) must not match inside "healthcare".
  const healthTitle = title({ vertical: "B2B – Healthcare" });
  assert.equal(scoreTitle(healthTitle, facetsAuto).score, 0);

  const facetsTech: BriefFacets = { audienceType: null, industries: ["tech"], geoScopes: [], locations: [], keywords: [] };
  // "it" (tech trigger) must not match inside "Health & Fitness" or "Hospitality".
  assert.equal(scoreTitle(title({ vertical: "Health & Fitness" }), facetsTech).score, 0);
  assert.equal(scoreTitle(title({ vertical: "B2B – Hospitality" }), facetsTech).score, 0);
});

// ---------- New transport/machinery/trades industries ----------

test("extractFacets recognizes the transport/logistics/fleet industry multilingually", () => {
  assert.ok(extractFacets("we manage a fleet of trucks and vans").industries.includes("transport"));
  assert.ok(extractFacets("vi har en bilpark med lastebiler og logistikk").industries.includes("transport"));
});

test("extractFacets recognizes machinery and trades industries", () => {
  assert.ok(extractFacets("entreprenører med anleggsmaskiner").industries.includes("machinery"));
  assert.ok(extractFacets("håndverkere som elektriker og rørlegger").industries.includes("trades"));
});

// ---------- Topical-score demotion ----------

test("matchTitles filters out a B2B-only title when the brief has topical facets it doesn't match", () => {
  const facets: BriefFacets = { audienceType: "B2B", industries: ["transport"], geoScopes: [], locations: [], keywords: [] };
  const offTopic = title({ id: "hospitality", b2bB2c: "B2B", vertical: "B2B – Hospitality", nativeFit: "High", digitalReach: 500000 });
  const onTopic = title({ id: "transport", b2bB2c: "B2B", vertical: "B2B – Transport & Logistics", nativeFit: "High", digitalReach: 1000 });
  const ranked = matchTitles([offTopic, onTopic], facets);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].title.id, "transport");
});

test("matchTitles still matches on audience alone when the brief has no topical facets", () => {
  const facets: BriefFacets = { audienceType: "B2B", industries: [], geoScopes: [], locations: [], keywords: [] };
  const b2bOnly = title({ id: "biz", b2bB2c: "B2B" });
  const ranked = matchTitles([b2bOnly], facets);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].title.id, "biz");
});

// ---------- Aquaculture/seafood/maritime industry (search-synonyms consult) ----------

test("extractFacets recognizes the aquaculture industry from an English-only brief", () => {
  // No "salmon"/"havbruk" mentioned — just the English industry name — must
  // still resolve to the aquaculture industry key.
  const f = extractFacets("We want to reach the aquaculture industry in Norway");
  assert.ok(f.industries.includes("aquaculture"));
});

test("extractFacets recognizes aquaculture/seafood/maritime terms multilingually via the shared synonym groups", () => {
  assert.ok(extractFacets("vi selger til havbruksnæringen").industries.includes("aquaculture"));
  assert.ok(extractFacets("targeting the seafood and fisheries sector").industries.includes("aquaculture"));
  assert.ok(extractFacets("reaching maritime and salmon farming buyers").industries.includes("aquaculture"));
});

test("scoreTitle surfaces a salmon/aquaculture trade title on an English-only aquaculture brief", () => {
  const f = extractFacets("We want to reach the aquaculture industry in Norway");
  // Modeled on the real salmon-business-no catalog row: vertical/audience
  // carry "Maritime"/"seafood industry", keywords carry the Norwegian terms —
  // none of which contain the English word "aquaculture" itself.
  const salmonBusiness = title({
    id: "salmon-business-no",
    vertical: "B2B – Maritime",
    audience: "Maritime/seafood industry",
    keywords: ["akvakultur", "oppdrett", "havbruk", "sjømat", "salmon", "laks"],
  });
  const { score, reasons } = scoreTitle(salmonBusiness, f);
  assert.ok(score > 0, "aquaculture brief should match the salmon/seafood title");
  assert.ok(reasons.includes("aquaculture"));
});

// ---------- Structured (keywords[]/aliases[]/description) fields ----------

test("scoreTitle picks up keywords[]/aliases[]/description and outranks a tags-only match", () => {
  const facets: BriefFacets = { audienceType: null, industries: [], geoScopes: [], locations: [], keywords: ["salmon"] };
  const structuredMatch = title({ keywords: ["Salmon Farming"] });
  const aliasMatch = title({ aliases: ["Salmon Business"] });
  const descriptionMatch = title({ description: "Coverage of salmon farming and aquaculture." });
  const tagsOnlyMatch = title({ tags: "salmon, aquaculture" });
  const noMatch = title({ vertical: "Sports" });

  const structured = scoreTitle(structuredMatch, facets);
  const alias = scoreTitle(aliasMatch, facets);
  const description = scoreTitle(descriptionMatch, facets);
  const tagsOnly = scoreTitle(tagsOnlyMatch, facets);
  const none = scoreTitle(noMatch, facets);

  assert.ok(structured.score > 0 && alias.score > 0 && description.score > 0);
  assert.equal(none.score, 0);
  // A structured keywords[] hit outweighs a freetext (tags-only) hit.
  assert.ok(structured.score > tagsOnly.score);
});
