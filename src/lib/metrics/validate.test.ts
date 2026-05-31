import { test } from "node:test";
import assert from "node:assert/strict";
import { parseImpressions } from "./validate";

test("parseImpressions accepts a non-negative integer string", () => {
  assert.deepEqual(parseImpressions("1500"), { ok: true, value: 1500 });
});
test("parseImpressions treats empty as cleared (null)", () => {
  assert.deepEqual(parseImpressions(""), { ok: true, value: null });
});
test("parseImpressions rejects negatives and non-integers", () => {
  assert.deepEqual(parseImpressions("-5"), { ok: false });
  assert.deepEqual(parseImpressions("12.5"), { ok: false });
  assert.deepEqual(parseImpressions("abc"), { ok: false });
});
