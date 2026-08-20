// Pure state-machine guards for the order-cancellation and editorial-
// veto flows. Lives outside the server actions so it can be unit-tested
// without spinning up the DB.
//
// PLAN §10.D talks about the booking → live → report tail; the
// cancellation flow is the reverse path that wasn't built when
// scenario tests started surfacing customer disputes (Kirsten R2).
//
// We treat *cancellation* as terminal — once an order is CANCELLED it
// is not eligible for un-cancellation. If a customer wants to revive a
// dead booking, the desk issues a fresh quote.

import { OrderStatus } from "@prisma/client";

// Orders that can still be cancelled. Anything past LIVE is too late —
// the article has run, the publisher has earned, the invoice is in
// motion. The desk can still write a credit note, but that's a separate
// concern from cancellation.
const CANCELLABLE_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.QUOTED,
  OrderStatus.CONFIRMED,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.SCHEDULED,
]);

export function canCancelOrder(status: OrderStatus): boolean {
  return CANCELLABLE_ORDER_STATUSES.has(status);
}

// Why this status is locked, in a form the desk UI can render verbatim.
// Empty string when cancellation IS allowed.
export function cancelBlockReason(status: OrderStatus): string {
  if (canCancelOrder(status)) return "";
  switch (status) {
    case OrderStatus.LIVE:
      return "Placement is already live — issue a credit note instead.";
    case OrderStatus.COMPLETED:
      return "Order is completed — issue a credit note instead.";
    case OrderStatus.INVOICED:
      return "Invoice is issued — issue a credit note against it instead.";
    case OrderStatus.CANCELLED:
      return "Order is already cancelled.";
    default:
      return "Order cannot be cancelled in its current state.";
  }
}

// Normalises the free-text reason a desk/publisher actor supplies when
// invoking cancel/retract. We require *something* so the audit row has
// a defensible reason later — empty string is treated as "no reason
// given" and the action is refused.
export function normaliseReason(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Generous cap; this gets logged + emailed, not stored as a constrained
  // column. The schema column is TEXT so any reasonable narrative fits.
  return trimmed.slice(0, 2000);
}

// Who cancelled. We persist the role on the order so the buyer's
// dispute-resolution flow doesn't have to dig through audit history to
// distinguish "publisher killed it for editorial reasons" from "desk
// cancelled it for ops reasons".
export type CancelActor = "DESK" | "PUBLISHER" | "BUYER" | "SUPERADMIN";
