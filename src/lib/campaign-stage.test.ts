import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveStage } from "./campaign-stage";

test("no request activity yet -> Plan built", () => {
  assert.equal(deriveStage({ requestStatus: "DRAFT", quoteStatus: null, orderStatus: null }), 1);
});

test("submitted, no quote yet -> Sent", () => {
  assert.equal(deriveStage({ requestStatus: "SUBMITTED", quoteStatus: null, orderStatus: null }), 2);
  assert.equal(deriveStage({ requestStatus: "IN_REVIEW", quoteStatus: null, orderStatus: null }), 2);
});

test("quote exists, no order yet -> Quoted, regardless of quote status", () => {
  assert.equal(deriveStage({ requestStatus: "QUOTED", quoteStatus: "SENT", orderStatus: null }), 3);
  assert.equal(deriveStage({ requestStatus: "QUOTED", quoteStatus: "EXPIRED", orderStatus: null }), 3);
  assert.equal(deriveStage({ requestStatus: "QUOTED", quoteStatus: "DECLINED", orderStatus: null }), 3);
});

test("order exists but not live -> Approved", () => {
  for (const orderStatus of ["QUOTED", "CONFIRMED", "IN_PRODUCTION", "SCHEDULED", "CANCELLED"]) {
    assert.equal(
      deriveStage({ requestStatus: "CLOSED", quoteStatus: "ACCEPTED", orderStatus }),
      4,
      orderStatus,
    );
  }
});

test("order is live/completed/invoiced -> Live", () => {
  for (const orderStatus of ["LIVE", "COMPLETED", "INVOICED"]) {
    assert.equal(
      deriveStage({ requestStatus: "CLOSED", quoteStatus: "ACCEPTED", orderStatus }),
      5,
      orderStatus,
    );
  }
});

test("firm-order gotcha: Request.status CLOSED with an order is NOT stage 1/2", () => {
  // firm-order.ts creates Request status=CLOSED, Quote status=ACCEPTED and
  // Order status=CONFIRMED in one transaction — a naive Request.status-only
  // check would misread this as a dead/closed RFQ (or fall through to
  // "Sent"). Order existence must win.
  const stage = deriveStage({ requestStatus: "CLOSED", quoteStatus: "ACCEPTED", orderStatus: "CONFIRMED" });
  assert.equal(stage, 4);
});

test("closed request with no quote/order at all -> Sent bucket (dead RFQ), not Plan built", () => {
  assert.equal(deriveStage({ requestStatus: "CLOSED", quoteStatus: null, orderStatus: null }), 2);
});
