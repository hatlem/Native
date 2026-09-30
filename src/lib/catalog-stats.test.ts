import { test } from "node:test";
import assert from "node:assert/strict";
import { titleCountFloor } from "./catalog-stats";

test("titleCountFloor rounds down so '{n}+' is always true", () => {
  assert.equal(titleCountFloor(2814), 2800);
  assert.equal(titleCountFloor(3492), 3400);
  assert.equal(titleCountFloor(3000), 3000);
  assert.equal(titleCountFloor(487), 480);
  assert.equal(titleCountFloor(42), 42);
  assert.equal(titleCountFloor(0), 0);
  assert.equal(titleCountFloor(Number.NaN), 0);
});
