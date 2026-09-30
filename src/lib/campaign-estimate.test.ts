import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReach } from "./campaign-estimate";

test("computeReach: empty → zeroed", () => {
  const e = computeReach([]);
  assert.equal(e.reach, 0);
  assert.equal(e.itemCount, 0);
});

test("computeReach: reach counts each title once (max), not per placement", () => {
  const e = computeReach([
    { titleId: "a", reach: 500 },
    { titleId: "a", reach: 300 },
    { titleId: "b", reach: 200 },
  ]);
  assert.equal(e.reach, 700); // 500 (title a) + 200 (title b)
  assert.equal(e.itemCount, 3);
});
