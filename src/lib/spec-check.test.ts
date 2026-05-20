import { test } from "node:test";
import assert from "node:assert/strict";
import { specCheck } from "./spec-check";

test("passes when body has both required disclosures and length is OK", () => {
  const r = specCheck({
    body: "Annonsørinnhold — a fully compliant article body with enough words.",
    wordCountMin: 5,
    wordCountMax: 50,
    titleDisclosure: "Annonsørinnhold",
    marketDisclosure: "Annonsørinnhold",
  });
  assert.equal(r.passed, true);
  assert.deepEqual(r.issues, []);
});

test("flags a missing title-level disclosure label", () => {
  const r = specCheck({
    body: "no label here, just words words words words",
    titleDisclosure: "Annonsørinnhold",
  });
  assert.equal(r.passed, false);
  assert.match(r.issues[0], /Annonsørinnhold/);
});

test("market-level label is enforced when title has none", () => {
  const r = specCheck({
    body: "missing the market marker here",
    marketDisclosure: "Annons",
  });
  assert.equal(r.passed, false);
  assert.match(r.issues[0], /Annons/);
});

test("title and market labels both required when both differ", () => {
  const r = specCheck({
    body: "Has Annons but not the other one",
    titleDisclosure: "Sponsored",
    marketDisclosure: "Annons",
  });
  assert.equal(r.passed, false);
  assert.equal(r.issues.length, 1);
  assert.match(r.issues[0], /Sponsored/);
});

test("disclosure check is case-insensitive", () => {
  const r = specCheck({
    body: "ANNONSØRINNHOLD long body of words words words words words",
    titleDisclosure: "Annonsørinnhold",
    wordCountMin: 3,
  });
  assert.equal(r.passed, true);
});

test("word count bounds are enforced both ways", () => {
  const tooShort = specCheck({
    body: "Annons short",
    titleDisclosure: "Annons",
    wordCountMin: 10,
  });
  assert.equal(tooShort.passed, false);
  assert.match(tooShort.issues[0], /Too short/);

  const tooLong = specCheck({
    body: "Annons " + "word ".repeat(20),
    titleDisclosure: "Annons",
    wordCountMax: 5,
  });
  assert.equal(tooLong.passed, false);
  assert.match(tooLong.issues[0], /Too long/);
});

test("empty body produces zero words and reports issues", () => {
  const r = specCheck({ body: "", wordCountMin: 1, titleDisclosure: "Annons" });
  assert.equal(r.words, 0);
  assert.equal(r.passed, false);
});
