import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUOTE_VALIDITY_DAYS,
  effectiveQuoteStatus,
  isQuoteAcceptable,
  isQuoteExpired,
  quoteValidUntilFrom,
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
