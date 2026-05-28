import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreCandidate, type CandidateHints } from "./scoring";

function hints(overrides: Partial<CandidateHints>): CandidateHints {
  return {
    isMailto: false,
    pathKind: "other",
    contextHasSalesVocab: false,
    hasName: false,
    emailDomainMatchesPublisher: false,
    ...overrides,
  };
}

test("baseline (no signals) is 0", () => {
  assert.equal(scoreCandidate(hints({})), 0);
});

test("strong: mailto + sales page + sales vocab + name + matching domain = 100 (capped)", () => {
  assert.equal(
    scoreCandidate(
      hints({
        isMailto: true,
        pathKind: "sales",
        contextHasSalesVocab: true,
        hasName: true,
        emailDomainMatchesPublisher: true,
      }),
    ),
    100, // 50+30+20+20+10 = 130, clamped to 100
  );
});

test("medium: scraped-text email on /kontakt with name = 20", () => {
  assert.equal(scoreCandidate(hints({ pathKind: "contact", hasName: true })), 20);
});

test("mailto alone is 50", () => {
  assert.equal(scoreCandidate(hints({ isMailto: true })), 50);
});

test("sales-vocab without mailto or sales path is 20", () => {
  assert.equal(scoreCandidate(hints({ contextHasSalesVocab: true })), 20);
});

test("score never below 0", () => {
  assert.equal(scoreCandidate(hints({})), 0);
});
