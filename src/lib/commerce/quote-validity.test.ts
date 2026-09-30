import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUOTE_VALIDITY_DAYS,
  QUOTE_VALIDITY_MAX_DAYS,
  buyerVisibleQuoteWhere,
  effectiveQuoteStatus,
  isQuoteAcceptable,
  isQuoteExpired,
  parseQuoteValidUntil,
  quoteValidUntilFrom,
  quoteValidUntilInputValue,
} from "./quote-validity";

const NOW = new Date("2026-09-25T10:00:00Z");
const past = new Date("2026-09-03T00:00:00Z");
const future = new Date("2026-10-01T00:00:00Z");

test("a SENT quote inside its window is acceptable and not expired", () => {
  const q = { status: "SENT" as const, validUntil: future };
  assert.equal(isQuoteAcceptable(q, NOW), true);
  assert.equal(isQuoteExpired(q, NOW), false);
  assert.equal(effectiveQuoteStatus(q, NOW), "SENT");
});

test("a SENT quote past validUntil is expired, not acceptable, and reads as EXPIRED", () => {
  const q = { status: "SENT" as const, validUntil: past };
  assert.equal(isQuoteExpired(q, NOW), true);
  assert.equal(isQuoteAcceptable(q, NOW), false);
  assert.equal(effectiveQuoteStatus(q, NOW), "EXPIRED");
});

test("validUntil exactly now counts as expired (the window is exclusive)", () => {
  assert.equal(isQuoteAcceptable({ status: "SENT", validUntil: NOW }, NOW), false);
});

test("a SENT quote without validUntil never expires", () => {
  const q = { status: "SENT" as const, validUntil: null };
  assert.equal(isQuoteAcceptable(q, NOW), true);
  assert.equal(effectiveQuoteStatus(q, NOW), "SENT");
});

test("only SENT quotes are acceptable — DRAFT, DECLINED, ACCEPTED, EXPIRED never", () => {
  for (const status of ["DRAFT", "DECLINED", "ACCEPTED", "EXPIRED"] as const) {
    assert.equal(isQuoteAcceptable({ status, validUntil: future }, NOW), false, status);
  }
});

test("non-SENT statuses are shown as stored", () => {
  assert.equal(effectiveQuoteStatus({ status: "ACCEPTED", validUntil: past }, NOW), "ACCEPTED");
  assert.equal(effectiveQuoteStatus({ status: "DECLINED", validUntil: past }, NOW), "DECLINED");
});

test("a renewal is firm for QUOTE_VALIDITY_DAYS from now", () => {
  const until = quoteValidUntilFrom(NOW);
  assert.equal(until.getTime() - NOW.getTime(), QUOTE_VALIDITY_DAYS * 86_400_000);
});

test("the desk's date field defaults to today + QUOTE_VALIDITY_DAYS (UTC day)", () => {
  assert.equal(quoteValidUntilInputValue(NOW), "2026-10-09");
  assert.equal(quoteValidUntilInputValue(NOW, NOW), "2026-09-25");
});

test("a chosen validity date is valid through the end of that UTC day", () => {
  const parsed = parseQuoteValidUntil("2026-10-09", NOW);
  assert.deepEqual(parsed, { ok: true, validUntil: new Date("2026-10-09T23:59:59.999Z") });
  // Still acceptable late on the day itself, lapsed a millisecond after.
  if (!parsed.ok) throw new Error("unreachable");
  const q = { status: "SENT" as const, validUntil: parsed.validUntil };
  assert.equal(isQuoteAcceptable(q, new Date("2026-10-09T23:00:00Z")), true);
  assert.equal(isQuoteAcceptable(q, new Date("2026-10-10T00:00:00Z")), false);
});

test("today is a valid (same-day) validity; yesterday is not", () => {
  assert.equal(parseQuoteValidUntil("2026-09-25", NOW).ok, true);
  assert.deepEqual(parseQuoteValidUntil("2026-09-24", NOW), { ok: false, reason: "past" });
});

test("validity is capped at QUOTE_VALIDITY_MAX_DAYS", () => {
  const lastDay = quoteValidUntilInputValue(
    NOW,
    new Date(NOW.getTime() + QUOTE_VALIDITY_MAX_DAYS * 86_400_000),
  );
  assert.equal(parseQuoteValidUntil(lastDay, NOW).ok, true);
  const dayAfter = quoteValidUntilInputValue(
    NOW,
    new Date(NOW.getTime() + (QUOTE_VALIDITY_MAX_DAYS + 1) * 86_400_000),
  );
  assert.deepEqual(parseQuoteValidUntil(dayAfter, NOW), { ok: false, reason: "too-far" });
});

test("malformed or impossible dates are refused, blank falls back to the default", () => {
  for (const raw of ["tomorrow", "2026-13-01", "2026-02-31", "09/10/2026"]) {
    assert.deepEqual(parseQuoteValidUntil(raw, NOW), { ok: false, reason: "invalid" }, raw);
  }
  assert.deepEqual(parseQuoteValidUntil("  ", NOW), { ok: true, validUntil: quoteValidUntilFrom(NOW) });
});

test("buyers never see DRAFT quotes", () => {
  assert.deepEqual(buyerVisibleQuoteWhere(), { status: { not: "DRAFT" } });
});
