import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRequestStatus,
  isOrderEligibleForScan,
  groupBookingsByPublisher,
  resolveRecipient,
} from "./status";

test("computeRequestStatus: COMPLETE when every booking has impressions", () => {
  assert.equal(computeRequestStatus([{ impressions: 100 }, { impressions: 0 }]), "COMPLETE");
});
test("computeRequestStatus: PARTIAL when some but not all", () => {
  assert.equal(computeRequestStatus([{ impressions: 100 }, { impressions: null }]), "PARTIAL");
});
test("computeRequestStatus: PENDING when none reported", () => {
  assert.equal(computeRequestStatus([{ impressions: null }, { impressions: null }]), "PENDING");
  assert.equal(computeRequestStatus([]), "PENDING");
});

test("isOrderEligibleForScan: past flightEnd + grace, not cancelled", () => {
  const now = new Date("2026-06-12T08:00:00Z");
  // flight ends 2026-06-10; end-of-day + 1 grace => eligible from 2026-06-12T00:00Z
  assert.equal(isOrderEligibleForScan({ status: "LIVE", flightEndDate: new Date("2026-06-10T00:00:00Z") }, now, 1), true);
});
test("isOrderEligibleForScan: not yet past grace", () => {
  const now = new Date("2026-06-11T08:00:00Z");
  assert.equal(isOrderEligibleForScan({ status: "LIVE", flightEndDate: new Date("2026-06-10T00:00:00Z") }, now, 1), false);
});
test("isOrderEligibleForScan: cancelled or no flightEnd never eligible", () => {
  const now = new Date("2026-07-01T00:00:00Z");
  assert.equal(isOrderEligibleForScan({ status: "CANCELLED", flightEndDate: new Date("2026-06-10T00:00:00Z") }, now, 1), false);
  assert.equal(isOrderEligibleForScan({ status: "LIVE", flightEndDate: null }, now, 1), false);
});

test("groupBookingsByPublisher: groups non-cancelled bookings with a publisher", () => {
  const groups = groupBookingsByPublisher([
    { id: "b1", publisherId: "p1", status: "PUBLISHED" },
    { id: "b2", publisherId: "p1", status: "CONFIRMED" },
    { id: "b3", publisherId: "p2", status: "PUBLISHED" },
    { id: "b4", publisherId: "p2", status: "CANCELLED" },
    { id: "b5", publisherId: null, status: "PUBLISHED" },
  ]);
  assert.deepEqual(groups, [
    { publisherId: "p1", bookingIds: ["b1", "b2"] },
    { publisherId: "p2", bookingIds: ["b3"] },
  ]);
});

test("resolveRecipient: prefers isPrimary, then first by email", () => {
  assert.deepEqual(
    resolveRecipient([
      { email: "b@x.no", name: "B", isPrimary: false },
      { email: "a@x.no", name: "A", isPrimary: true },
    ]),
    { email: "a@x.no", name: "A" },
  );
  assert.deepEqual(
    resolveRecipient([
      { email: "z@x.no", name: null, isPrimary: false },
      { email: "a@x.no", name: "A", isPrimary: false },
    ]),
    { email: "a@x.no", name: "A" },
  );
  assert.equal(resolveRecipient([]), null);
});
