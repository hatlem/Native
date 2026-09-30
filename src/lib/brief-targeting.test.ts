import { test } from "node:test";
import assert from "node:assert/strict";
import { briefTargeting, briefWithoutFoldedTargeting } from "./brief-targeting";

test("briefTargeting: known segments only, trimmed text, null when empty", () => {
  assert.deepEqual(
    briefTargeting({
      targetGeo: " Oslo ",
      targetAudience: "b2b-decision-makers,not-a-segment,construction-property-pros",
      targetContext: "Byggebransje",
    }),
    { geo: "Oslo", audience: ["b2b-decision-makers", "construction-property-pros"], context: "Byggebransje" },
  );
  assert.equal(briefTargeting({ targetGeo: " ", targetAudience: "", targetContext: null }), null);
});

test("briefWithoutFoldedTargeting: drops the old trailing fold, keeps the buyer's words", () => {
  const folded = "We sell cranes.\nAudience: b2b-decision-makers,construction-property-pros\nContext: Byggebransje";
  assert.equal(briefWithoutFoldedTargeting(folded), "We sell cranes.");
  // Only the fold: nothing left.
  assert.equal(briefWithoutFoldedTargeting("Geo: Oslo\nContext: Bygg"), null);
  // A brief that mentions "Context:" mid-text keeps it.
  const own = "Context: we launch in May.\nMore text.";
  assert.equal(briefWithoutFoldedTargeting(own), own);
  assert.equal(briefWithoutFoldedTargeting(null), null);
});
