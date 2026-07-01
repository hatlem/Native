import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeReasons } from "./campaign-recommend";

test("summarizeReasons: empty / undefined → empty string", () => {
  assert.equal(summarizeReasons(undefined), "");
  assert.equal(summarizeReasons([]), "");
});

test("summarizeReasons: upcases short codes, title-cases words", () => {
  assert.equal(summarizeReasons(["B2B", "finance", "oslo"]), "B2B · Finance · Oslo");
});

test("summarizeReasons: de-duplicates case-insensitively", () => {
  assert.equal(summarizeReasons(["finance", "Finance", "FINANCE"]), "Finance");
});

test("summarizeReasons: caps at 5 parts", () => {
  const many = ["a1", "b2", "c3", "d4", "e5", "f6", "g7"];
  assert.equal(summarizeReasons(many).split(" · ").length, 5);
});

test("summarizeReasons: skips blank entries", () => {
  assert.equal(summarizeReasons(["", "  ", "tech"]), "Tech");
});
