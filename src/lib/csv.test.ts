import { test } from "node:test";
import assert from "node:assert/strict";
import { csv, csvCell } from "./csv";

test("csvCell escapes embedded quotes/commas/newlines", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("with, comma"), '"with, comma"');
  assert.equal(csvCell('quote " here'), '"quote "" here"');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
});

test("csvCell handles null, numbers and dates", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell(42), "42");
  const d = new Date("2026-05-20T00:00:00Z");
  assert.equal(csvCell(d), d.toISOString());
});

test("csv serializes rows with header derived from first row keys", () => {
  const out = csv([
    { a: 1, b: "x" },
    { a: 2, b: "y" },
  ]);
  assert.equal(out, "a,b\n1,x\n2,y");
});

test("csv respects explicit headers and missing keys become empty", () => {
  const out = csv([{ a: 1 }], ["a", "b"]);
  assert.equal(out, "a,b\n1,");
});
