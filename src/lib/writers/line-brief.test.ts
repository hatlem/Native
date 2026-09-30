import { test } from "node:test";
import assert from "node:assert/strict";
import { lineBrief } from "./line-brief";

const BRIEF = "Vi selger maskiner til entreprenører.";
const WITH_TIMING = `${BRIEF}\n\nKampanjen bør gå i Q4 2026.`;

// BUG-final-local-15: the brief showed under both "Budskap" and "Målgrupp".
test("an audience that only repeats the brief is shown once, as the message", () => {
  assert.deepEqual(lineBrief({ message: null, audience: WITH_TIMING }, BRIEF), {
    message: WITH_TIMING,
    audience: null,
  });
  assert.deepEqual(lineBrief({ message: BRIEF, audience: `  ${BRIEF} ` }, null), {
    message: BRIEF,
    audience: null,
  });
});

test("the message falls back to the request brief when the plan had no goal", () => {
  assert.deepEqual(lineBrief({ message: null, audience: null }, BRIEF), { message: BRIEF, audience: null });
  assert.deepEqual(lineBrief(null, null), { message: null, audience: null });
});

test("a real audience note is kept beside the message", () => {
  assert.deepEqual(lineBrief({ message: "Lansering av ny gravemaskin", audience: "Anleggsledere" }, BRIEF), {
    message: "Lansering av ny gravemaskin",
    audience: "Anleggsledere",
  });
});
