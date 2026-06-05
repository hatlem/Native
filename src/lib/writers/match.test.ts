import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreWriter, rankWriters, type WriterForMatch } from "./match";

function writer(over: Partial<WriterForMatch>): WriterForMatch {
  return {
    active: true,
    maxActiveAssignments: null,
    activeAssignments: 0,
    languages: [],
    specialties: [],
    ...over,
  };
}

test("language match dominates the score", () => {
  const matchLang = writer({
    languages: [{ language: "NO", proficiency: "FLUENT" }],
  });
  const noLang = writer({
    specialties: [{ topic: "FINANCE" }, { topic: "TECH" }],
  });
  const a = scoreWriter(matchLang, { language: "NO", topics: ["FINANCE"] });
  const b = scoreWriter(noLang, { language: "NO", topics: ["FINANCE", "TECH"] });
  assert.equal(a.languageMatch, true);
  assert.equal(b.languageMatch, false);
  assert.ok(a.score > b.score);
});

test("native proficiency beats fluent on equal language", () => {
  const nativeW = writer({ languages: [{ language: "SV", proficiency: "NATIVE" }] });
  const fluentW = writer({ languages: [{ language: "SV", proficiency: "FLUENT" }] });
  const crit = { language: "SV" as const, topics: [] };
  assert.ok(scoreWriter(nativeW, crit).score > scoreWriter(fluentW, crit).score);
});

test("specialty overlap adds to the score and is reported", () => {
  const w = writer({
    languages: [{ language: "DE", proficiency: "FLUENT" }],
    specialties: [{ topic: "FINANCE" }, { topic: "B2B" }],
  });
  const res = scoreWriter(w, { language: "DE", topics: ["FINANCE", "B2B", "TECH"] });
  assert.equal(res.topicOverlap, 2);
});

test("inactive and over-capacity writers are penalised but selectable", () => {
  const inactive = writer({
    active: false,
    languages: [{ language: "NO", proficiency: "NATIVE" }],
  });
  const res = scoreWriter(inactive, { language: "NO", topics: [] });
  assert.ok(res.score < 0);

  const overCap = writer({
    maxActiveAssignments: 2,
    activeAssignments: 2,
    languages: [{ language: "NO", proficiency: "FLUENT" }],
  });
  assert.equal(scoreWriter(overCap, { language: "NO", topics: [] }).overCapacity, true);
});

test("rankWriters sorts best match first", () => {
  const weak: WriterForMatch & { id: string } = {
    ...writer({ specialties: [{ topic: "FOOD" }] }),
    id: "weak",
  };
  const strong: WriterForMatch & { id: string } = {
    ...writer({
      languages: [{ language: "NO", proficiency: "NATIVE" }],
      specialties: [{ topic: "FINANCE" }],
    }),
    id: "strong",
  };
  const ranked = rankWriters([weak, strong], { language: "NO", topics: ["FINANCE"] });
  assert.equal(ranked[0].id, "strong");
});
