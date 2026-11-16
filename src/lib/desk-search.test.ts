import { test } from "node:test";
import assert from "node:assert/strict";
import { DESK_SEARCH_MAX, normalizeDeskQuery, orderNumber } from "./desk-search";

test("normalizeDeskQuery: trims, strips a leading #, bounds length, needs 2 chars", () => {
  assert.equal(normalizeDeskQuery("  acme "), "acme");
  assert.equal(normalizeDeskQuery("#BTJ519SP"), "BTJ519SP");
  assert.equal(normalizeDeskQuery("a"), null);
  assert.equal(normalizeDeskQuery(""), null);
  assert.equal(normalizeDeskQuery(null), null);
  assert.equal(normalizeDeskQuery("x".repeat(500))?.length, DESK_SEARCH_MAX);
});

test("orderNumber is the upper-cased last 8 characters", () => {
  assert.equal(orderNumber("cmwhgfe6800327dgzbtj519sp"), "#BTJ519SP");
});
