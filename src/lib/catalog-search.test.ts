import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import assert from "node:assert/strict";
import {
  buildTsQuery,
  buildIlikeFallbackWhere,
  domainOf,
  searchWhereFor,
  significantWords,
  wordVariants,
} from "./catalog-search";
import { spellingVariants } from "./search-synonyms";

// Words without a/o/u (and no synonyms) have exactly one variant, so their
// tsquery is predictable: xyz → xyz:*.
test("buildTsQuery: plain word with no synonyms or spellings becomes word:*", () => {
  assert.equal(buildTsQuery("xyz"), "xyz:*");
});

test("buildTsQuery: two plain words join with ' & '", () => {
  assert.equal(buildTsQuery("xyz qwe"), "xyz:* & qwe:*");
});

test("buildTsQuery: a synonym word expands into a parenthesized OR group", () => {
  const q = buildTsQuery("lastebil");
  assert.match(q, /^\(.+\)$/, "should be wrapped in parens");
  const inner = q.slice(1, -1);
  const terms = inner.split(" | ");
  assert.ok(terms.length > 1, "should contain more than one variant");
  for (const t of terms) assert.match(t, /^[\p{Letter}\p{Number}]+:\*$/u);
  assert.ok(terms.includes("lastebil:*"));
  assert.ok(terms.includes("transport:*"));
});

test("buildTsQuery: punctuation-only / 1-char words produce empty string", () => {
  assert.equal(buildTsQuery("!!!"), "");
  assert.equal(buildTsQuery("a"), "");
  assert.equal(buildTsQuery(""), "");
});

test("buildTsQuery: mixed plain + synonym words stay balanced and AND-joined", () => {
  const q = buildTsQuery("xyz lastebil");
  const [first, rest] = [q.split(" & ")[0], q.split(" & ").slice(1).join(" & ")];
  assert.equal(first, "xyz:*");
  assert.match(rest, /^\(.+\)$/);
  // Balanced parens overall.
  assert.equal((q.match(/\(/g) || []).length, (q.match(/\)/g) || []).length);
});

test("buildIlikeFallbackWhere: covers name/category/vertical/tags/city with synonym variants", () => {
  const where = buildIlikeFallbackWhere("havbruk");
  assert.ok(Array.isArray(where.OR));
  const or = where.OR as Record<string, unknown>[];
  const fields = new Set(or.flatMap((clause) => Object.keys(clause)));
  for (const f of ["name", "category", "vertical", "tags", "city", "publisher", "keywords", "aliases"]) {
    assert.ok(fields.has(f), `missing ${f} clause`);
  }
  const verticalClause = or.find((c) => "vertical" in c) as {
    vertical: { contains: string };
  };
  // At least one of the vertical clauses should carry a synonym variant,
  // not just the raw query term.
  const verticalContainsValues = or
    .filter((c) => "vertical" in c)
    .map((c) => (c as { vertical: { contains: string } }).vertical.contains);
  assert.ok(verticalContainsValues.includes("oppdrett"));
  assert.ok(verticalContainsValues.includes("havbruk"));
  void verticalClause;
});

test("buildIlikeFallbackWhere: keywords/aliases hasSome includes synonym variants", () => {
  const where = buildIlikeFallbackWhere("havbruk");
  const or = where.OR as Record<string, unknown>[];
  const keywordsClause = or.find((c) => "keywords" in c) as {
    keywords: { hasSome: string[] };
  };
  const aliasesClause = or.find((c) => "aliases" in c) as {
    aliases: { hasSome: string[] };
  };
  assert.ok(keywordsClause.keywords.hasSome.includes("oppdrett"));
  assert.ok(aliasesClause.aliases.hasSome.includes("akvakultur"));
});

test("buildIlikeFallbackWhere: empty query returns {}", () => {
  assert.deepEqual(buildIlikeFallbackWhere(""), {});
  assert.deepEqual(buildIlikeFallbackWhere("   "), {});
});

test("searchWhereFor: non-empty matchedIds wins outright", () => {
  assert.deepEqual(searchWhereFor("anything", ["x", "y"]), { id: { in: ["x", "y"] } });
});

test("searchWhereFor: empty matchedIds with a query falls back to ILIKE (not id IN [])", () => {
  const where = searchWhereFor("havbruk", []);
  assert.ok(!("id" in where), "must not pin id: { in: [] }");
  assert.ok(Array.isArray(where.OR));
});

test("searchWhereFor: null matchedIds with a query falls back to ILIKE", () => {
  const where = searchWhereFor("havbruk", null);
  assert.ok(!("id" in where));
  assert.ok(Array.isArray(where.OR));
});

test("searchWhereFor: no query and no matchedIds returns {}", () => {
  assert.deepEqual(searchWhereFor("", null), {});
  assert.deepEqual(searchWhereFor("", []), {});
});

test("buildTsQuery: separators inside a word split into tokens, never fuse", () => {
  // "API-IT" must query api:* & it:* (Postgres tokenizes the hyphenated
  // lexeme into parts) — the old behavior fused it into the unsearchable
  // "apiit". Dots likewise: "AT.no" prefix-matches the 'at.no' host lexeme.
  assert.equal(buildTsQuery("API-IT New Title"), "(api:* | åpi:* | äpi:*) & it:* & new:* & title:*");
  assert.equal(buildTsQuery("AT.no"), "(at.no:* | (at:* & no:*))");
});

test("buildTsQuery: a domain also matches the whole website host", () => {
  assert.equal(buildTsQuery("vg.no"), "(vg.no:* | (vg:* & no:*))");
  assert.equal(buildTsQuery("t-online.de"), "(t-online.de:* | ((online:* | ønline:* | önline:*) & de:*))");
  // A pasted URL resolves to its host (scheme/www/path dropped); other
  // words stay AND-ed alongside.
  assert.equal(
    buildTsQuery("xyz https://www.Nyteknik.se/annonsera"),
    "xyz:* & (nyteknik.se:* | (nyteknik:* & se:*))",
  );
});

test("buildTsQuery: slash-joined names split into AND-ed words", () => {
  // Pairs with the index splitting "/" (20260924120000_fts_split_separators):
  // "Bärgslagsbladet/Arboga Tidning" must be findable by "Arboga Tidning".
  const q = buildTsQuery("Bärgslagsbladet/Arboga");
  // "arboga" also asks for its å/ä spellings; the word itself comes first.
  assert.match(q, /^bärgslagsbladet:\* & \(arboga:\* \| [^&]+\)$/u);
});

test("domainOf: only host-shaped chunks qualify", () => {
  assert.equal(domainOf("E24.no"), "e24.no");
  assert.equal(domainOf("http://bobedre.dk/"), "bobedre.dk");
  assert.equal(domainOf("KK"), null);
  assert.equal(domainOf("1.5"), null);
  assert.equal(domainOf("API-IT"), null);
  assert.equal(domainOf("a..b"), null);
  assert.equal(domainOf("vg.no'|x"), null);
});

// ── BUG-buyer-plan-1: multi-word queries match every word, not any ──────────

test("significantWords: filler words never have to match, unless nothing else is left", () => {
  assert.deepEqual(significantWords("Asker og Bærum"), ["asker", "bærum"]);
  assert.deepEqual(significantWords("Hus og hjem"), ["hus", "hjem"]);
  assert.deepEqual(significantWords("The Economist"), ["economist"]);
  // "it" is a real search term (B2B IT), never filler.
  assert.deepEqual(significantWords("B2B IT"), ["b2b", "it"]);
  assert.deepEqual(significantWords("og"), ["og"]);
});

test("buildTsQuery: filler words are left out of the AND", () => {
  const q = buildTsQuery("Asker og Bærum");
  assert.ok(!/\bog:\*/u.test(q), q);
  assert.equal(q.split(" & ").length, 2);
});

test("buildTsQuery: 'some' mode ORs the words (the widened tier)", () => {
  assert.equal(buildTsQuery("xyz qwe", "some"), "xyz:* | qwe:*");
});

test("buildIlikeFallbackWhere: a multi-word query ANDs one clause per significant word", () => {
  const where = buildIlikeFallbackWhere("Asker og Bærum");
  assert.ok(Array.isArray(where.AND), "every word must match");
  const clauses = where.AND as Prisma.TitleWhereInput[];
  assert.equal(clauses.length, 2, "'og' is not a clause");
  const names = clauses.map((c) =>
    (c.OR as Prisma.TitleWhereInput[])
      .filter((x) => "name" in x)
      .map((x) => (x.name as { contains: string }).contains),
  );
  assert.ok(names[0].includes("asker"));
  assert.ok(names[1].includes("bærum"));
  // The widened tier ORs the same clauses.
  const some = buildIlikeFallbackWhere("Asker og Bærum", "some");
  assert.equal((some.OR as unknown[]).length, 2);
});

// ── BUG-buyer-plan-2: æ/ø/å typed as ASCII (and back) ───────────────────────

test("spellingVariants: ASCII spellings reach the æ/ø/å forms", () => {
  assert.ok(spellingVariants("tromso").includes("tromsø"));
  assert.ok(spellingVariants("baerum").includes("bærum"));
  assert.ok(spellingVariants("orsta").includes("ørsta"));
  assert.ok(spellingVariants("rorlegger").includes("rørlegger"));
  assert.ok(spellingVariants("malmo").includes("malmö"));
  assert.ok(spellingVariants("aarhus").includes("århus"));
});

test("spellingVariants: a word typed with æ/ø/å is taken as written", () => {
  // "Sør" means Sør: folding it to "sor" would pull in every "Sor…" title.
  assert.deepEqual(spellingVariants("sør"), []);
  assert.deepEqual(spellingVariants("tromsø"), []);
});

test("spellingVariants: short words and words without candidates stay alone", () => {
  assert.deepEqual(spellingVariants("at"), []);
  assert.deepEqual(spellingVariants("xyz"), []);
});

test("wordVariants: the searched word first, then its spellings, then synonyms", () => {
  const v = wordVariants("tromso");
  assert.equal(v[0], "tromso");
  assert.ok(v.includes("tromsø"));
  // A synonym-group word keeps its own spelling first and its group after.
  const r = wordVariants("rorlegger");
  assert.equal(r[0], "rorlegger");
  assert.ok(r.includes("rørlegger"));
});

test("buildTsQuery: an ASCII query asks for the æ/ø/å spelling too", () => {
  assert.ok(buildTsQuery("tromso").includes("tromsø:*"));
  assert.ok(buildTsQuery("baerum").includes("bærum:*"));
});
