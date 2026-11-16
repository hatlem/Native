// Per-user EMAIL preferences for notices. The in-app inbox always gets the
// row; a muted category only stops the email copy. Categories are coarse on
// purpose — five switches a person can reason about, not one per notice kind.
//
// Stored on User.emailMutedCategories (muted list, so a new category and
// every existing user default to "on").

import type { NotificationKind } from "@prisma/client";

export const NOTIFICATION_CATEGORIES = ["quotes", "orders", "content", "billing", "planning"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

// Record<NotificationKind, …>: adding an enum value without a category is a
// type error, so no notice can silently bypass the preferences.
const CATEGORY_BY_KIND: Record<NotificationKind, NotificationCategory> = {
  RFQ_SUBMITTED: "quotes",
  QUOTE_READY: "quotes",
  QUOTE_ACCEPTED: "quotes",
  QUOTE_RENEWAL_REQUESTED: "quotes",
  QUOTE_DECLINED: "quotes",
  REQUEST_WITHDRAWN: "quotes",
  BOOKING_NEW: "orders",
  BOOKING_CONFIRMED: "orders",
  ORDER_CANCELLED: "orders",
  ORDER_COMPLETED: "orders",
  ORDER_CANCELLATION_REQUESTED: "orders",
  ASSET_REVIEW: "content",
  EDITORIAL_VETO: "content",
  INVOICE_ISSUED: "billing",
  PLACEMENT_PROPOSED: "planning",
  PLAN_CLIENT_APPROVED: "planning",
  TITLE_PRODUCT_READY: "planning",
};

export function categoryOf(kind: NotificationKind): NotificationCategory {
  return CATEGORY_BY_KIND[kind];
}

/** Should this notice also be emailed to a user with these muted categories? */
export function emailEnabledFor(kind: NotificationKind, muted: readonly string[] | null | undefined): boolean {
  return !(muted ?? []).includes(categoryOf(kind));
}

/** The muted list to store, from the categories the form left CHECKED. */
export function mutedFromEnabled(enabled: readonly string[]): NotificationCategory[] {
  const on = new Set(enabled);
  return NOTIFICATION_CATEGORIES.filter((c) => !on.has(c));
}
