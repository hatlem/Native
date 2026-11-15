import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evalSummary, scoreEvalCase, type EvalCase } from "./ai-eval";

const CASE: EvalCase = {
  id: "c1",
  brief: "…",
  expected: { audienceType: "B2B", industries: ["finance"], locations: ["oslo"] },
  forbidden: { industries: ["politics"] },
};

test("scoreEvalCase passes when every expected facet is present and no forbidden one", () => {
  const r = scoreEvalCase(CASE, {
    audienceType: "B2B",
    industries: ["tech", "Finance"],
    locations: ["oslo"],
  });
  assert.deepEqual(r, { id: "c1", pass: true, missing: [], unexpected: [] });
});

test("scoreEvalCase reports what is missing and what should not be there", () => {
  const r = scoreEvalCase(CASE, { audienceType: "B2C", industries: ["politics"], locations: [] });
  assert.equal(r.pass, false);
  assert.deepEqual(r.missing, ["audienceType=B2B", "industries:finance", "locations:oslo"]);
  assert.deepEqual(r.unexpected, ["industries:politics"]);
});

test("evalSummary", () => {
  assert.deepEqual(
    evalSummary([
      { id: "a", pass: true, missing: [], unexpected: [] },
      { id: "b", pass: false, missing: ["x"], unexpected: [] },
    ]),
    { passed: 1, total: 2, rate: 0.5 },
  );
});

test("the golden set is well-formed and only uses the closed industry vocabulary", () => {
  const file = JSON.parse(
    readFileSync(join(process.cwd(), "scripts/eval-data/brief-match-golden.json"), "utf8"),
  ) as { passThreshold: number; cases: EvalCase[] };
  const industries = new Set([
    "finance", "legal", "health", "fitness", "agriculture", "tech", "marketing", "retail", "energy",
    "education", "auto", "construction", "sports", "food", "politics", "charity", "transport",
    "machinery", "trades",
  ]);
  assert.ok(file.passThreshold > 0 && file.passThreshold <= 1);
  assert.ok(file.cases.length >= 5);
  assert.equal(new Set(file.cases.map((c) => c.id)).size, file.cases.length, "unique ids");
  for (const c of file.cases) {
    assert.ok(c.brief.trim(), c.id);
    for (const i of [...(c.expected.industries ?? []), ...(c.forbidden?.industries ?? [])]) {
      assert.ok(industries.has(i), `${c.id}: unknown industry ${i}`);
    }
  }
});
