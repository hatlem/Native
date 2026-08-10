import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTsQuery, buildIlikeFallbackWhere, searchWhereFor } from "./catalog-search";

test("buildTsQuery: plain word with no synonyms becomes word:*", () => {
  assert.equal(buildTsQuery("foo"), "foo:*");
});

test("buildTsQuery: two plain words join with ' & '", () => {
  assert.equal(buildTsQuery("foo bar"), "foo:* & bar:*");
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

test("buildTsQuery: dot-stripping regression (AT.no -> atno:*)", () => {
  assert.equal(buildTsQuery("AT.no"), "atno:*");
});

test("buildTsQuery: punctuation-only / 1-char words produce empty string", () => {
  assert.equal(buildTsQuery("!!!"), "");
  assert.equal(buildTsQuery("a"), "");
  assert.equal(buildTsQuery(""), "");
});

test("buildTsQuery: mixed plain + synonym words stay balanced and AND-joined", () => {
  const q = buildTsQuery("foo lastebil");
  const [first, rest] = [q.split(" & ")[0], q.split(" & ").slice(1).join(" & ")];
  assert.equal(first, "foo:*");
  assert.match(rest, /^\(.+\)$/);
  // Balanced parens overall.
  assert.equal((q.match(/\(/g) || []).length, (q.match(/\)/g) || []).length);
});

test("buildIlikeFallbackWhere: covers name/category/vertical/tags/city with synonym variants", () => {
  const where = buildIlikeFallbackWhere("havbruk");
  assert.ok(Array.isArray(where.OR));
  const or = where.OR as Record<string, unknown>[];
  const fields = new Set(or.flatMap((clause) => Object.keys(clause)));
  for (const f of ["name", "category", "vertical", "tags", "city", "keywords", "aliases"]) {
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
