import { test } from "node:test";
import assert from "node:assert/strict";
import {
  latestConfirmedAtAcrossProducts,
  ageInDays,
  freshnessBucket,
} from "./freshness";

test("latestConfirmedAtAcrossProducts returns null when none confirmed", () => {
  assert.equal(
    latestConfirmedAtAcrossProducts([{ confirmedAt: null }, { confirmedAt: null }]),
    null,
  );
});

test("latestConfirmedAtAcrossProducts returns most recent", () => {
  const a = new Date("2026-01-01");
  const b = new Date("2026-05-01");
  const result = latestConfirmedAtAcrossProducts([
    { confirmedAt: a },
    { confirmedAt: null },
    { confirmedAt: b },
  ]);
  assert.equal(result?.toISOString(), b.toISOString());
});

test("ageInDays computes whole-day diff", () => {
  const now = new Date("2026-05-26T12:00:00Z");
  const past = new Date("2026-05-01T12:00:00Z");
  assert.equal(ageInDays(past, now), 25);
});

test("ageInDays returns null when input is null", () => {
  assert.equal(ageInDays(null, new Date()), null);
});

test("freshnessBucket categorises by age", () => {
  const now = new Date("2026-05-26T00:00:00Z");
  assert.equal(freshnessBucket(null, now), "never");
  assert.equal(freshnessBucket(new Date("2026-05-20"), now), "fresh");
  assert.equal(freshnessBucket(new Date("2026-03-01"), now), "aging");
  assert.equal(freshnessBucket(new Date("2026-01-01"), now), "stale");
});
