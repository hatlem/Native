import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeReasons, pickBriefMatches } from "./campaign-recommend";
import type { MatchableTitle, TitleMatch } from "./brief-match";
import type { Candidate, SupplementaryTitle } from "./recommend";

const matchableTitle = (over: Partial<MatchableTitle> = {}): MatchableTitle => ({
  id: "t1",
  name: "Title",
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

const match = (id: string, score = 1, reasons: string[] = []): TitleMatch => ({
  title: matchableTitle({ id }),
  score,
  reasons,
});

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  productId: "p",
  titleId: "t1",
  titleName: "Title",
  category: "business",
  type: "ARTICLE",
  reach: 1000,
  unitPrice: 100,
  ...over,
});

test("summarizeReasons: empty / undefined → empty string", () => {
  assert.equal(summarizeReasons(undefined), "");
  assert.equal(summarizeReasons([]), "");
});

test("summarizeReasons: upcases short codes, title-cases words", () => {
  assert.equal(summarizeReasons(["B2B", "finance", "oslo"]), "B2B · Finance · Oslo");
});

test("summarizeReasons: de-duplicates case-insensitively", () => {
  assert.equal(summarizeReasons(["finance", "Finance", "FINANCE"]), "Finance");
});

test("summarizeReasons: caps at 5 parts", () => {
  const many = ["a1", "b2", "c3", "d4", "e5", "f6", "g7"];
  assert.equal(summarizeReasons(many).split(" · ").length, 5);
});

test("summarizeReasons: skips blank entries", () => {
  assert.equal(summarizeReasons(["", "  ", "tech"]), "Tech");
});

// ---------- pickBriefMatches: dedup by title ----------

test("pickBriefMatches dedups a title with multiple priced products, keeping the cheapest", () => {
  const priced = [
    candidate({ productId: "p1", titleId: "t1", unitPrice: 500 }),
    candidate({ productId: "p2", titleId: "t1", unitPrice: 300 }),
    candidate({ productId: "p3", titleId: "t1", unitPrice: 900 }),
  ];
  const { picks, matchedPriced } = pickBriefMatches(priced, [], [match("t1")], Number.MAX_SAFE_INTEGER);
  assert.equal(matchedPriced.length, 1);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].productId, "p2");
  assert.equal(picks[0].unitPrice, 300);
});

test("pickBriefMatches drops priced products whose title isn't in the ranked matches", () => {
  const priced = [candidate({ titleId: "t1" }), candidate({ productId: "p2", titleId: "unranked" })];
  const { picks } = pickBriefMatches(priced, [], [match("t1")], Number.MAX_SAFE_INTEGER);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].titleId, "t1");
});

test("pickBriefMatches respects budget and rank order, and caps at maxPicks", () => {
  const matches = [match("a"), match("b")];
  const priced = [
    candidate({ titleId: "a", productId: "pa", unitPrice: 800 }),
    candidate({ titleId: "b", productId: "pb", unitPrice: 800 }),
  ];
  const { picks } = pickBriefMatches(priced, [], matches, 1000);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].titleId, "a"); // ranked first, "b" would blow the budget

  const capped = pickBriefMatches(priced, [], matches, Number.MAX_SAFE_INTEGER, { maxPicks: 1 });
  assert.equal(capped.picks.length, 1);
});

test("pickBriefMatches orders supplementary titles by rank and caps them", () => {
  const matches = [match("a"), match("b")];
  const unpriced: SupplementaryTitle[] = [
    { titleId: "b", titleName: "B", productId: "pb", reach: 10, currency: "EUR" },
    { titleId: "a", titleName: "A", productId: "pa", reach: 10, currency: "EUR" },
    { titleId: "unranked", titleName: "X", productId: "px", reach: 10, currency: "EUR" },
  ];
  const { supplementary } = pickBriefMatches([], unpriced, matches, 0);
  assert.deepEqual(supplementary.map((s) => s.titleId), ["a", "b"]);
});

test("pickBriefMatches attaches the matched title's reasons to each pick", () => {
  const matches = [match("t1", 9, ["B2B", "transport"])];
  const { picks } = pickBriefMatches([candidate({ titleId: "t1" })], [], matches, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(picks[0].reasons, ["B2B", "transport"]);
});
