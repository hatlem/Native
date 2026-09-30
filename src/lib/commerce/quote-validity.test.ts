import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUOTE_VALIDITY_DAYS,
  QUOTE_VALIDITY_MAX_DAYS,
  acceptableQuoteWhere,
  buyerVisibleQuoteWhere,
  formatQuoteValidUntil,
  editableQuoteWhere,
  effectiveQuoteStatus,
  expiredSentQuoteWhere,
  isQuoteAcceptable,
  isQuoteEditable,
  isQuoteExpired,
  isQuoteRevisable,
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

test("the desk's date field defaults to today + QUOTE_VALIDITY_DAYS, on the buyer's calendar", () => {
  assert.equal(quoteValidUntilInputValue(NOW), "2026-10-09");
  assert.equal(quoteValidUntilInputValue(NOW, NOW), "2026-09-25");
  // 23:30 UTC is already tomorrow in Oslo and Helsinki, still today in London.
  const lateUtc = new Date("2026-09-25T23:30:00Z");
  assert.equal(quoteValidUntilInputValue(lateUtc, lateUtc, "Europe/Oslo"), "2026-09-26");
  assert.equal(quoteValidUntilInputValue(lateUtc, lateUtc, "Europe/Helsinki"), "2026-09-26");
  assert.equal(quoteValidUntilInputValue(lateUtc, lateUtc, "Europe/London"), "2026-09-26");
  assert.equal(quoteValidUntilInputValue(lateUtc, lateUtc, "UTC"), "2026-09-25");
});

test("a chosen validity date is valid through the end of that day in the buyer's zone", () => {
  const parsed = parseQuoteValidUntil("2026-10-09", NOW, "Europe/Oslo");
  // 23:59:59.999 Oslo summer time (UTC+2), not 23:59 UTC (01:59 next day there).
  assert.deepEqual(parsed, { ok: true, validUntil: new Date("2026-10-09T21:59:59.999Z") });
  // Still acceptable late on the day itself, lapsed a millisecond after.
  if (!parsed.ok) throw new Error("unreachable");
  const q = { status: "SENT" as const, validUntil: parsed.validUntil };
  assert.equal(isQuoteAcceptable(q, new Date("2026-10-09T21:30:00Z")), true);
  assert.equal(isQuoteAcceptable(q, new Date("2026-10-09T22:00:00Z")), false);
  // Every surface prints the same day for it, whatever the server's zone.
  assert.equal(quoteValidUntilInputValue(NOW, parsed.validUntil, "Europe/Oslo"), "2026-10-09");
  assert.equal(formatQuoteValidUntil(parsed.validUntil, "en", "Europe/Oslo"), "9 October 2026");
  assert.equal(formatQuoteValidUntil(parsed.validUntil, "no", "Europe/Oslo"), "9. oktober 2026");
});

test("the day end follows each market's zone and the clock change", () => {
  const end = (raw: string, zone: string) => {
    const r = parseQuoteValidUntil(raw, NOW, zone);
    if (!r.ok) throw new Error(r.reason);
    return r.validUntil.toISOString();
  };
  assert.equal(end("2026-10-09", "Europe/London"), "2026-10-09T22:59:59.999Z");
  assert.equal(end("2026-10-09", "Europe/Helsinki"), "2026-10-09T20:59:59.999Z");
  // After the October change Oslo is UTC+1; the change day itself (25 Oct)
  // already ends on winter time.
  assert.equal(end("2026-10-25", "Europe/Oslo"), "2026-10-25T22:59:59.999Z");
  assert.equal(end("2026-11-02", "Europe/Oslo"), "2026-11-02T22:59:59.999Z");
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
  // Blank = the default window, through the end of its last day.
  assert.deepEqual(parseQuoteValidUntil("  ", NOW), parseQuoteValidUntil("2026-10-09", NOW));
});

test("buyers never see DRAFT quotes", () => {
  assert.deepEqual(buyerVisibleQuoteWhere(), { status: { not: "DRAFT" } });
});

// ─── Immutability and revisions ──────────────────────────────────────────────

test("only an unordered DRAFT is editable; a sent offer is locked", () => {
  assert.equal(isQuoteEditable({ status: "DRAFT", order: null }), true);
  assert.equal(isQuoteEditable({ status: "DRAFT", order: { id: "o1" } }), false);
  for (const status of ["SENT", "EXPIRED", "ACCEPTED", "DECLINED", "SUPERSEDED"] as const) {
    assert.equal(isQuoteEditable({ status, order: null }), false, status);
  }
  assert.deepEqual(editableQuoteWhere(), { status: "DRAFT", order: null });
});

test("a SENT or EXPIRED offer may be revised once; nothing else may", () => {
  assert.equal(isQuoteRevisable({ status: "SENT", order: null, nextRevision: null }), true);
  assert.equal(isQuoteRevisable({ status: "EXPIRED", order: null, nextRevision: null }), true);
  assert.equal(
    isQuoteRevisable({ status: "SENT", order: null, nextRevision: { id: "r2" } }),
    false,
    "already revised — revise the newest revision instead",
  );
  assert.equal(isQuoteRevisable({ status: "SENT", order: { id: "o1" }, nextRevision: null }), false);
  for (const status of ["DRAFT", "ACCEPTED", "DECLINED", "SUPERSEDED"] as const) {
    assert.equal(isQuoteRevisable({ status, order: null, nextRevision: null }), false, status);
  }
});

test("a SUPERSEDED quote is never acceptable, never 'expired', and reads as SUPERSEDED", () => {
  const q = { status: "SUPERSEDED" as const, validUntil: future };
  assert.equal(isQuoteAcceptable(q, NOW), false);
  assert.equal(isQuoteExpired({ ...q, validUntil: past }, NOW), false);
  assert.equal(effectiveQuoteStatus({ ...q, validUntil: past }, NOW), "SUPERSEDED");
  // The query forms pin status SENT, so neither the accept CAS nor the expiry
  // sweep can ever match a superseded row.
  assert.equal(acceptableQuoteWhere(NOW).status, "SENT");
  assert.equal(expiredSentQuoteWhere(NOW).status, "SENT");
});
