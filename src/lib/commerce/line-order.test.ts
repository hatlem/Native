import { test } from "node:test";
import assert from "node:assert/strict";
import { compareLines, lineOrder } from "./line-order";

test("lines sort by position, then id", () => {
  const lines = [
    { id: "c", position: 1 },
    { id: "b", position: 0 },
    { id: "a", position: 1 },
  ];
  assert.deepEqual(
    [...lines].sort(compareLines).map((l) => l.id),
    ["b", "a", "c"],
  );
});

test("the Prisma orderBy matches the in-memory rule and is a fresh array per call", () => {
  assert.deepEqual(lineOrder(), [{ position: "asc" }, { id: "asc" }]);
  assert.notEqual(lineOrder(), lineOrder());
});
