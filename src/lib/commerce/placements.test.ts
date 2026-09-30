import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlacementLine, placementCount } from "./placements";

test("placementCount counts inventory lines, never the content fees billed with them", () => {
  // Two placements, each with our article fee: 2 placements, not 4.
  const lines = [
    { kind: "INVENTORY" as const },
    { kind: "INVENTORY" as const },
    { kind: "CONTENT_FEE" as const },
    { kind: "CONTENT_FEE" as const },
  ];
  assert.equal(placementCount(lines), 2);
  // One instant placement with its fee: 1.
  assert.equal(placementCount([{ kind: "INVENTORY" }, { kind: "CONTENT_FEE" }]), 1);
  assert.equal(placementCount([]), 0);
});

test("a line without a kind predates content fees and is a placement", () => {
  assert.equal(isPlacementLine({}), true);
  assert.equal(isPlacementLine({ kind: null }), true);
  assert.equal(isPlacementLine({ kind: "CONTENT_FEE" }), false);
});
