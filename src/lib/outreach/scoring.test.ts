import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreCandidate, classifyLocalPart, type CandidateHints } from "./scoring";

function hints(overrides: Partial<CandidateHints>): CandidateHints {
  return {
    isMailto: false,
    pathKind: "other",
    contextHasSalesVocab: false,
    hasName: false,
    emailDomainMatchesPublisher: false,
    localPartKind: "neutral",
    ...overrides,
  };
}

test("baseline (no signals) is 0", () => {
  assert.equal(scoreCandidate(hints({})), 0);
});

test("strong: mailto + sales page + vocab + name + matching domain = 100 (capped)", () => {
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
    100, // 40+25+15+15+10 = 105, clamped to 100
  );
});

test("mailto alone is 40", () => {
  assert.equal(scoreCandidate(hints({ isMailto: true })), 40);
});

test("sales-vocab without mailto or sales path is 15", () => {
  assert.equal(scoreCandidate(hints({ contextHasSalesVocab: true })), 15);
});

test("advertising local part adds 40 — a plain mailto annonse@ reaches review", () => {
  // 40 (mailto) + 40 (advertising) = 80
  assert.equal(
    scoreCandidate(hints({ isMailto: true, localPartKind: "advertising" })),
    80,
  );
});

test("editorial local part is demoted below the bulk-approve threshold", () => {
  // Even on the ad page with a name + matching domain: 105 - 60 = 45 < 80
  const score = scoreCandidate(
    hints({
      isMailto: true,
      pathKind: "sales",
      contextHasSalesVocab: true,
      hasName: true,
      emailDomainMatchesPublisher: true,
      localPartKind: "editorial",
    }),
  );
  assert.equal(score, 45);
  assert.ok(score < 80);
});

test("score never below 0 (editorial with no positive signal)", () => {
  assert.equal(scoreCandidate(hints({ localPartKind: "editorial" })), 0);
});

test("classifyLocalPart: advertising inboxes", () => {
  for (const e of [
    "annonse@avis.no",
    "annonsering@x.se",
    "salg@y.no",
    "sales@z.co.uk",
    "marketing@a.com",
    "anzeigen@b.de",
    "mainos@c.fi",
    "annonsavdelningen@d.se",
  ]) {
    assert.equal(classifyLocalPart(e), "advertising", e);
  }
});

test("classifyLocalPart: editorial / system inboxes", () => {
  for (const e of [
    "tips@avis.no",
    "redaksjon@x.no",
    "redaktion@y.de",
    "abonnement@z.no",
    "kundeservice@a.no",
    "support@b.com",
    "faktura@c.no",
    "jobb@d.no",
    "noreply@e.com",
  ]) {
    assert.equal(classifyLocalPart(e), "editorial", e);
  }
});

test("classifyLocalPart: neutral inboxes (generic + named people)", () => {
  for (const e of ["info@x.no", "post@y.no", "kontakt@z.no", "ola.nordmann@avis.no"]) {
    assert.equal(classifyLocalPart(e), "neutral", e);
  }
});
