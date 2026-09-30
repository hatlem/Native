import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG_DEFAULT_LIMIT,
  CATALOG_MAX_LIMIT,
  decodeCatalogCursor,
  describeParamErrors,
  encodeCatalogCursor,
  parseCatalogQuery,
} from "./catalog-query";

const parse = (qs: string) => parseCatalogQuery(new URLSearchParams(qs));

test("no params → defaults", () => {
  assert.deepEqual(parse(""), {
    ok: true,
    query: { market: undefined, format: undefined, limit: CATALOG_DEFAULT_LIMIT, cursor: null },
  });
});

test("valid filters pass through", () => {
  const r = parse("market=SE&format=NATIVE_ARTICLE&limit=10");
  assert.ok(r.ok);
  assert.equal(r.query.market, "SE");
  assert.equal(r.query.format, "NATIVE_ARTICLE");
  assert.equal(r.query.limit, 10);
});

// BUG-prod-api-23: `limit=abc` became take:NaN → Prisma 500 with an empty body.
test("non-numeric, fractional, zero and negative limits are 400s", () => {
  for (const bad of ["abc", "1.5", "0", "-5", "", "1e3", " 10"]) {
    const r = parse(`limit=${encodeURIComponent(bad)}`);
    assert.equal(r.ok, false, `limit=${bad} must be rejected`);
    if (!r.ok) assert.equal(r.errors[0].param, "limit");
  }
});

test("limit above the maximum is clamped, not rejected", () => {
  const r = parse("limit=1000");
  assert.ok(r.ok);
  assert.equal(r.query.limit, CATALOG_MAX_LIMIT);
});

// BUG-prod-api-24: invalid filters were silently dropped → unfiltered results.
test("unknown market / format are 400s naming the allowed values", () => {
  const r = parse("market=XX&format=BOGUS");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(
    r.errors.map((e) => e.param),
    ["market", "format"],
  );
  assert.match(r.errors[0].message, /NO, SE/);
  assert.match(describeParamErrors(r.errors), /^market: .+; format: .+/);
});

test("market codes are case-sensitive, as documented", () => {
  assert.equal(parse("market=no").ok, false);
});

test("a repeated filter is a 400, not first-one-wins", () => {
  const r = parse("market=NO&market=SE");
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.errors, [{ param: "market", message: "may only be given once" }]);
});

// BUG-prod-api-24: a junk cursor returned an empty page with hasMore:false,
// which a partner reads as "sync complete".
test("a cursor this API never issued is a 400", () => {
  for (const bad of ["doesnotexist", "!!!", encodeURIComponent("[1,2]")]) {
    const r = parse(`cursor=${bad}`);
    assert.equal(r.ok, false, `cursor=${bad} must be rejected`);
    if (!r.ok) assert.equal(r.errors[0].param, "cursor");
  }
});

test("cursor round-trips (name, id), including non-ASCII names", () => {
  const token = encodeCatalogCursor("Åndalsnes Avis «Test»", "cmabc123");
  assert.match(token, /^[A-Za-z0-9_-]+$/, "URL-safe without escaping");
  assert.deepEqual(decodeCatalogCursor(token), {
    kind: "keyset",
    name: "Åndalsnes Avis «Test»",
    id: "cmabc123",
  });
  const r = parse(`cursor=${token}`);
  assert.ok(r.ok);
  assert.deepEqual(r.query.cursor, { kind: "keyset", name: "Åndalsnes Avis «Test»", id: "cmabc123" });
});

test("a bare title id from before the keyset token is accepted as legacy", () => {
  assert.deepEqual(decodeCatalogCursor("cmunms0sj0006mj0er59214ea"), {
    kind: "legacy",
    id: "cmunms0sj0006mj0er59214ea",
  });
});

test("unrelated params are ignored (cache-busters, tracking)", () => {
  assert.equal(parse("_=123&utm_source=x").ok, true);
});
