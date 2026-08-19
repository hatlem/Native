import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrderCompletedNotice } from "./order-completed-notice";

const LOCALES = ["en", "no", "sv", "da", "fi", "de"] as const;

test("en: due wave with angle keeps the desk-actions baseline meaning", () => {
  const n = buildOrderCompletedNotice({
    locale: "en",
    planName: "ABAX Q3",
    due: { waveNumber: 2, plannedWaves: 4, articleAngle: "Why fleet downtime costs more than you think" },
  });
  assert.equal(n.title, "Campaign finished: ABAX Q3");
  assert.ok(n.body.includes("Wave 2 of 4 is ready to send"));
  assert.ok(n.body.includes("angle: Why fleet downtime costs more than you think"));
  assert.ok(n.body.includes("while readers still remember the last one"));
});

test("en: due wave without angle omits the angle clause", () => {
  const n = buildOrderCompletedNotice({
    locale: "en",
    planName: "ABAX Q3",
    due: { waveNumber: 3, plannedWaves: 4, articleAngle: null },
  });
  assert.ok(n.body.includes("Wave 3 of 4"));
  assert.ok(!n.body.includes("angle:"));
});

test("en: finished variant sells repetition and the next wave", () => {
  const n = buildOrderCompletedNotice({ locale: "en", planName: "ABAX Q3", due: null });
  assert.equal(n.title, "Campaign finished: ABAX Q3");
  assert.ok(n.body.includes("Native works through repetition"));
  assert.ok(n.body.includes("plan the next wave"));
});

test("no: due wave uses programme terminology (runde/vinkel)", () => {
  const n = buildOrderCompletedNotice({
    locale: "no",
    planName: "ABAX Q3",
    due: { waveNumber: 2, plannedWaves: 4, articleAngle: "Hvorfor stillstand koster" },
  });
  assert.equal(n.title, "Kampanjen er ferdig: ABAX Q3");
  assert.ok(n.body.includes("Runde 2 av 4"));
  assert.ok(n.body.includes("vinkel: Hvorfor stillstand koster"));
});

test("no: finished variant is idiomatic Norwegian", () => {
  const n = buildOrderCompletedNotice({ locale: "no", planName: "ABAX Q3", due: null });
  assert.ok(n.body.includes("gjentakelse"));
  assert.ok(n.body.includes("neste runde"));
});

test("all six locales produce non-empty, locale-distinct copy for both variants", () => {
  const dueBodies = new Set<string>();
  const finishedBodies = new Set<string>();
  for (const locale of LOCALES) {
    const due = buildOrderCompletedNotice({
      locale,
      planName: "Plan",
      due: { waveNumber: 1, plannedWaves: 3, articleAngle: "Angle" },
    });
    const finished = buildOrderCompletedNotice({ locale, planName: "Plan", due: null });
    assert.ok(due.title.includes("Plan"), `${locale} due title missing plan name`);
    assert.ok(due.body.length > 40, `${locale} due body too short`);
    assert.ok(due.body.includes("Angle"), `${locale} due body missing angle`);
    assert.ok(finished.body.length > 40, `${locale} finished body too short`);
    dueBodies.add(due.body);
    finishedBodies.add(finished.body);
  }
  // No locale silently fell back to another's copy.
  assert.equal(dueBodies.size, LOCALES.length);
  assert.equal(finishedBodies.size, LOCALES.length);
});

test("unknown locale falls back to English", () => {
  const n = buildOrderCompletedNotice({ locale: "xx", planName: "Plan", due: null });
  assert.ok(n.title.startsWith("Campaign finished"));
});
