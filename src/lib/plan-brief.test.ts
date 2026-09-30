import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeListBrief, parseTiming, planBriefValues, timingOptions } from "./plan-brief";

test("timingOptions: the next two quarters a campaign can still run in, then flexible", () => {
  // 30 Sep 2026: Q3 ends today, so the offer starts at Q4 (the hard-coded
  // "Q3 2026" option was stale).
  assert.deepEqual(
    timingOptions(new Date("2026-09-30T12:00:00Z")).map((o) => o.value),
    ["2026-Q4", "2027-Q1", "flexible"],
  );
  // Early in a quarter it is still offered.
  assert.deepEqual(
    timingOptions(new Date("2026-07-02T00:00:00Z")).map((o) => o.value),
    ["2026-Q3", "2026-Q4", "flexible"],
  );
  // Rolls over the year.
  assert.deepEqual(
    timingOptions(new Date("2026-12-20T00:00:00Z")).map((o) => o.value),
    ["2027-Q1", "2027-Q2", "flexible"],
  );
});

test("parseTiming: accepts quarters and flexible only", () => {
  assert.deepEqual(parseTiming("2026-Q4"), { value: "2026-Q4", kind: "quarter", quarter: 4, year: 2026 });
  assert.deepEqual(parseTiming("flexible"), { value: "flexible", kind: "flexible" });
  assert.equal(parseTiming("q4"), null);
  assert.equal(parseTiming("2026-Q5"), null);
  assert.equal(parseTiming(null), null);
});

test("normalizeListBrief: trims, drops junk, keeps only known segments", () => {
  assert.deepEqual(
    normalizeListBrief({
      briefText: "  Treasury software for finance teams  ",
      briefTiming: "2026-Q4",
      budget: " 50000 ",
      budgetCurrency: "NOK",
      targetAudience: ["b2b-decision-makers", "not-a-segment", "b2b-decision-makers", "affluent"],
      targetGeo: " Oslo, Bergen, Tromsø ",
      targetContext: "",
    }),
    {
      briefText: "Treasury software for finance teams",
      briefTiming: "2026-Q4",
      budget: 50000,
      currency: "NOK",
      targetAudience: "b2b-decision-makers,affluent",
      targetGeo: "Oslo, Bergen, Tromsø",
      targetContext: null,
    },
  );
});

test("normalizeListBrief: an empty form clears every field", () => {
  assert.deepEqual(normalizeListBrief({ budget: "", briefTiming: "", budgetCurrency: "NOK" }), {
    briefText: null,
    briefTiming: null,
    budget: null,
    currency: null,
    targetAudience: null,
    targetGeo: null,
    targetContext: null,
  });
});

test("normalizeListBrief: rejects negative, non-numeric and absurd budgets; junk currency", () => {
  assert.equal(normalizeListBrief({ budget: "-5" }).budget, null);
  assert.equal(normalizeListBrief({ budget: "abc" }).budget, null);
  assert.equal(normalizeListBrief({ budget: "1e30" }).budget, 9_999_999_999);
  assert.equal(normalizeListBrief({ budget: "100", budgetCurrency: "nok; drop" }).currency, null);
  assert.equal(normalizeListBrief({ briefTiming: "someday" }).briefTiming, null);
  assert.equal(normalizeListBrief({ briefText: "x".repeat(5000) }).briefText?.length, 4000);
});

test("planBriefValues: stored columns back into form values", () => {
  assert.deepEqual(
    planBriefValues({
      briefText: "Fleet telematics",
      briefTiming: "2026-Q4",
      budget: 50000,
      targetAudience: "b2b-decision-makers,unknown",
      targetGeo: "Oslo",
      targetContext: null,
    }),
    {
      briefText: "Fleet telematics",
      briefTiming: "2026-Q4",
      budget: "50000",
      targetAudience: ["b2b-decision-makers"],
      targetGeo: "Oslo",
      targetContext: "",
    },
  );
});
