import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogVisibleTitleWhere } from "./catalog-visibility";

test("fragment matches the catalog surface: active OR unverified, never discontinued", () => {
  assert.deepEqual(catalogVisibleTitleWhere, {
    OR: [{ active: true }, { lastVerifiedAt: null }],
    discontinuedAt: null,
  });
});

test("fragment spreads cleanly into a wider where-clause", () => {
  const where = { ...catalogVisibleTitleWhere, marketId: "m1" };
  assert.deepEqual(where.OR, [{ active: true }, { lastVerifiedAt: null }]);
  assert.equal(where.discontinuedAt, null);
  assert.equal(where.marketId, "m1");
});
