import type { MetricsRequestStatus, OrderStatus, BookingStatus } from "@prisma/client";

// COMPLETE when every covered booking has a non-null impressions value;
// PARTIAL when some do; PENDING when none. (Impressions is the required
// field — the open-ended metric set means "all fields" can never complete.)
export function computeRequestStatus(metrics: { impressions: number | null }[]): MetricsRequestStatus {
  if (metrics.length === 0) return "PENDING";
  const reported = metrics.filter((m) => m.impressions !== null).length;
  if (reported === 0) return "PENDING";
  return reported === metrics.length ? "COMPLETE" : "PARTIAL";
}

// End-of-day of flightEndDate + graceDays, in UTC. We never email "campaign's
// over" on the end date itself (markets span NO/SE/DK/FI/DE/AT/CH/UK/IE).
export function scanThreshold(flightEndDate: Date, graceDays: number): Date {
  const d = new Date(flightEndDate);
  d.setUTCHours(23, 59, 59, 999);
  d.setUTCDate(d.getUTCDate() + graceDays);
  return d;
}

const SCAN_EXCLUDED_STATUS = new Set<OrderStatus>(["QUOTED", "CANCELLED"]);

export function isOrderEligibleForScan(
  order: { status: OrderStatus; flightEndDate: Date | null },
  now: Date,
  graceDays: number,
): boolean {
  if (order.flightEndDate === null) return false;
  if (SCAN_EXCLUDED_STATUS.has(order.status)) return false;
  return now.getTime() > scanThreshold(order.flightEndDate, graceDays).getTime();
}

// The desk can ask for metrics as soon as an order's flight has ended,
// without waiting for the once-a-day sweep and its one-day grace period.
// Pure so the page (button state) and the action agree.
export function canRequestMetricsNow(
  order: { status: OrderStatus; flightEndDate: Date | null },
  now: Date = new Date(),
): boolean {
  if (order.flightEndDate === null) return false;
  if (order.status === "QUOTED" || order.status === "CANCELLED") return false;
  // The flight runs through its end date (UTC), so "ended" is after that
  // day — the same threshold the sweep uses, minus its grace day.
  return now.getTime() > scanThreshold(order.flightEndDate, 0).getTime();
}

export function groupBookingsByPublisher(
  bookings: { id: string; publisherId: string | null; status: BookingStatus }[],
): { publisherId: string; bookingIds: string[] }[] {
  const byPub = new Map<string, string[]>();
  for (const b of bookings) {
    if (b.publisherId === null || b.status === "CANCELLED") continue;
    const list = byPub.get(b.publisherId) ?? [];
    list.push(b.id);
    byPub.set(b.publisherId, list);
  }
  return [...byPub.entries()].map(([publisherId, bookingIds]) => ({ publisherId, bookingIds }));
}

export function resolveRecipient(
  contacts: { email: string; name: string | null; isPrimary: boolean }[],
): { email: string; name: string | null } | null {
  if (contacts.length === 0) return null;
  const sorted = [...contacts].sort(
    (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.email.localeCompare(b.email),
  );
  return { email: sorted[0].email, name: sorted[0].name };
}
