import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canDeclineQuote,
  canGiveFeedback,
  isCsatScore,
  canRequestCancellation,
  canWithdrawRequest,
  normalizeReason,
  SELF_SERVICE_REASON_MAX,
} from "./buyer-self-service";

test("normalizeReason trims, bounds and nulls empties", () => {
  assert.equal(normalizeReason("  too expensive  "), "too expensive");
  assert.equal(normalizeReason("   "), null);
  assert.equal(normalizeReason(undefined), null);
  assert.equal(normalizeReason("x".repeat(5000))?.length, SELF_SERVICE_REASON_MAX);
});

test("canDeclineQuote: only a sent quote without an order", () => {
  assert.equal(canDeclineQuote({ status: "SENT", order: null }), true);
  assert.equal(canDeclineQuote({ status: "SENT", order: { id: "o" } }), false);
  for (const status of ["DRAFT", "ACCEPTED", "DECLINED", "EXPIRED", "SUPERSEDED"]) {
    assert.equal(canDeclineQuote({ status, order: null }), false, status);
  }
});

test("canWithdrawRequest: open request with nothing bought", () => {
  const open = (status: string, quotes: { status: string; order: { id: string } | null }[] = []) =>
    canWithdrawRequest({ status, quotes });
  assert.equal(open("SUBMITTED"), true);
  assert.equal(open("IN_REVIEW"), true);
  assert.equal(open("QUOTED", [{ status: "SENT", order: null }]), true);
  assert.equal(open("DRAFT"), false);
  assert.equal(open("CLOSED"), false);
  assert.equal(open("QUOTED", [{ status: "ACCEPTED", order: { id: "o" } }]), false);
  // One market accepted, one still open: the request carries an order.
  assert.equal(
    open("QUOTED", [
      { status: "SENT", order: null },
      { status: "ACCEPTED", order: { id: "o" } },
    ]),
    false,
  );
});

test("canRequestCancellation: active orders, one open ask", () => {
  for (const status of ["CONFIRMED", "IN_PRODUCTION", "SCHEDULED", "LIVE"]) {
    assert.equal(canRequestCancellation({ status, cancellationRequestedAt: null }), true, status);
  }
  for (const status of ["QUOTED", "COMPLETED", "INVOICED", "CANCELLED"]) {
    assert.equal(canRequestCancellation({ status, cancellationRequestedAt: null }), false, status);
  }
  assert.equal(
    canRequestCancellation({ status: "CONFIRMED", cancellationRequestedAt: new Date() }),
    false,
  );
});

test("CSAT: delivered orders only, whole scores 1-5", () => {
  assert.equal(canGiveFeedback("COMPLETED"), true);
  assert.equal(canGiveFeedback("INVOICED"), true);
  assert.equal(canGiveFeedback("LIVE"), false);
  assert.equal(canGiveFeedback("CANCELLED"), false);
  for (const ok of [1, 2, 3, 4, 5]) assert.equal(isCsatScore(ok), true);
  for (const bad of [0, 6, 2.5, NaN, "3"]) assert.equal(isCsatScore(bad), false);
});
