import { test } from "node:test";
import assert from "node:assert/strict";
import { BUYER_ORDER_SELECT, BUYER_QUOTE_LINE_SELECT, BUYER_REQUEST_SELECT } from "./buyer-export";

// Internal pricing and desk fields that must never reach a buyer's data export.
const INTERNAL = [
  "unitCost",
  "marginPct",
  "priceSetById",
  "priceSetBy",
  "priceSetAt",
  "availability",
  "nextEngagementNote",
  "cancelledBy",
  "assignedDeskUserId",
  "assignedById",
  "publisherTrackingUrl",
  "metricsRequestRefs",
  "notes",
];

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

test("buyer export selects contain no internal pricing or desk fields", () => {
  const keys = keysDeep([BUYER_REQUEST_SELECT, BUYER_ORDER_SELECT, BUYER_QUOTE_LINE_SELECT]);
  for (const field of INTERNAL) assert.ok(!keys.has(field), `${field} must not be in a buyer export`);
});

test("buyer export still carries what the customer was quoted and bought", () => {
  assert.equal(BUYER_QUOTE_LINE_SELECT.lineTotal, true);
  assert.equal(BUYER_QUOTE_LINE_SELECT.customerNote, true);
  assert.equal(BUYER_ORDER_SELECT.lines.select.lineTotal, true);
});
