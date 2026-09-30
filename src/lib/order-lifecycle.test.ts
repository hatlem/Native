import { test } from "node:test";
import assert from "node:assert/strict";
import { OrderStatus } from "@prisma/client";
import {
  ORDER_STATUS_AFTER_FULL_CREDIT,
  canIssueInvoice,
  creditNoteEligibility,
  deliveryGap,
  isPlacementPublished,
  nextOrderStatus,
  type DeliveryLine,
} from "./order-lifecycle";
import { canCancelOrder } from "./cancellation";

test("nextOrderStatus walks the production flow and stops at COMPLETED", () => {
  assert.equal(nextOrderStatus(OrderStatus.CONFIRMED), OrderStatus.IN_PRODUCTION);
  assert.equal(nextOrderStatus(OrderStatus.IN_PRODUCTION), OrderStatus.SCHEDULED);
  assert.equal(nextOrderStatus(OrderStatus.SCHEDULED), OrderStatus.LIVE);
  assert.equal(nextOrderStatus(OrderStatus.LIVE), OrderStatus.COMPLETED);
  // Billing and terminal states are not advanced by "Advance".
  assert.equal(nextOrderStatus(OrderStatus.COMPLETED), null);
  assert.equal(nextOrderStatus(OrderStatus.INVOICED), null);
  assert.equal(nextOrderStatus(OrderStatus.CANCELLED), null);
  assert.equal(nextOrderStatus(OrderStatus.QUOTED), null);
});

test("canIssueInvoice: only a COMPLETED order without an open invoice", () => {
  assert.equal(canIssueInvoice(OrderStatus.COMPLETED, []), true);
  assert.equal(canIssueInvoice(OrderStatus.LIVE, []), false);
  assert.equal(canIssueInvoice(OrderStatus.INVOICED, []), false);
  assert.equal(canIssueInvoice(OrderStatus.COMPLETED, [{ id: "i1", status: "ISSUED" }]), false);
  assert.equal(canIssueInvoice(OrderStatus.COMPLETED, [{ id: "i1", status: "DRAFT" }]), false);
  // A credited/void invoice no longer bills the customer.
  assert.equal(canIssueInvoice(OrderStatus.COMPLETED, [{ id: "i1", status: "CREDITED" }]), true);
});

test("creditNoteEligibility: an INVOICED order's issued invoice can be credited", () => {
  const invoice = { id: "i1", status: "ISSUED" as const };
  const r = creditNoteEligibility(OrderStatus.INVOICED, [invoice], []);
  assert.deepEqual(r, { ok: true, invoice });
  // PAID and OVERDUE are still creditable.
  assert.equal(creditNoteEligibility(OrderStatus.INVOICED, [{ id: "i", status: "PAID" }], []).ok, true);
  assert.equal(creditNoteEligibility(OrderStatus.INVOICED, [{ id: "i", status: "OVERDUE" }], []).ok, true);
});

test("creditNoteEligibility refuses with the reason the desk sees", () => {
  // Not invoiced yet: cancel instead (or invoice first).
  for (const s of [OrderStatus.CONFIRMED, OrderStatus.LIVE, OrderStatus.COMPLETED]) {
    assert.deepEqual(creditNoteEligibility(s, [{ id: "i", status: "ISSUED" }], []), {
      ok: false,
      reason: "wrong-order-status",
    });
  }
  assert.deepEqual(creditNoteEligibility(OrderStatus.INVOICED, [], []), {
    ok: false,
    reason: "no-invoice",
  });
  assert.deepEqual(creditNoteEligibility(OrderStatus.INVOICED, [{ id: "i", status: "DRAFT" }], []), {
    ok: false,
    reason: "no-invoice",
  });
  assert.deepEqual(
    creditNoteEligibility(OrderStatus.CANCELLED, [{ id: "i", status: "CREDITED" }], [{ invoiceId: "i" }]),
    { ok: false, reason: "already-credited" },
  );
  assert.deepEqual(
    creditNoteEligibility(OrderStatus.INVOICED, [{ id: "i", status: "ISSUED" }], [{ invoiceId: "i" }]),
    { ok: false, reason: "already-credited" },
  );
});

test("the lifecycle is closed: every post-live state has a reachable way out", () => {
  // LIVE → COMPLETED (advance), COMPLETED → INVOICED (invoice),
  // INVOICED → CANCELLED (full credit). Cancellation stays pre-live only.
  assert.equal(nextOrderStatus(OrderStatus.LIVE), OrderStatus.COMPLETED);
  assert.equal(canIssueInvoice(OrderStatus.COMPLETED, []), true);
  assert.equal(creditNoteEligibility(OrderStatus.INVOICED, [{ id: "i", status: "ISSUED" }], []).ok, true);
  assert.equal(ORDER_STATUS_AFTER_FULL_CREDIT, OrderStatus.CANCELLED);
  assert.equal(canCancelOrder(OrderStatus.INVOICED), false);
  // A legacy CANCELLED order with an open invoice can still be credited.
  assert.equal(creditNoteEligibility(OrderStatus.CANCELLED, [{ id: "i", status: "ISSUED" }], []).ok, true);
});

const line = (
  id: string,
  booking: DeliveryLine["booking"],
  kind: DeliveryLine["kind"] = "INVENTORY",
): DeliveryLine => ({ id, kind, label: id, booking });

test("isPlacementPublished: PUBLISHED or a published link; CONFIRMED alone is not delivery", () => {
  assert.equal(isPlacementPublished(line("a", { status: "PUBLISHED", liveUrl: null })), true);
  assert.equal(isPlacementPublished(line("a", { status: "BOOKED", liveUrl: "https://vg.no/a" })), true);
  assert.equal(isPlacementPublished(line("a", { status: "CONFIRMED", liveUrl: null })), false);
  assert.equal(isPlacementPublished(line("a", { status: "PENDING", liveUrl: "  " })), false);
  assert.equal(isPlacementPublished(line("a", null)), false);
});

test("deliveryGap gates LIVE/COMPLETED on unpublished placements only", () => {
  const lines = [
    line("vg", { status: "PUBLISHED", liveUrl: "https://vg.no/x" }),
    line("ap", { status: "PENDING", liveUrl: null }),
    // Content fees and cancelled bookings aren't expected to be published.
    line("fee", null, "CONTENT_FEE"),
    line("gone", { status: "CANCELLED", liveUrl: null }),
  ];
  const live = deliveryGap(lines, OrderStatus.LIVE);
  assert.equal(live.needsConfirmation, true);
  assert.equal(live.total, 2);
  assert.deepEqual(live.missing.map((l) => l.id), ["ap"]);
  assert.deepEqual(live.published.map((l) => l.id), ["vg"]);
  assert.equal(deliveryGap(lines, OrderStatus.COMPLETED).needsConfirmation, true);
  // Pre-live steps don't claim delivery, so no confirmation.
  assert.equal(deliveryGap(lines, OrderStatus.SCHEDULED).needsConfirmation, false);
  assert.equal(deliveryGap(lines, null).needsConfirmation, false);
});

test("deliveryGap needs no confirmation when every placement is published", () => {
  const gap = deliveryGap(
    [
      line("vg", { status: "PUBLISHED", liveUrl: null }),
      line("ap", { status: "BOOKED", liveUrl: "https://aftenposten.no/x" }),
    ],
    OrderStatus.COMPLETED,
  );
  assert.equal(gap.needsConfirmation, false);
  assert.equal(gap.published.length, 2);
});
