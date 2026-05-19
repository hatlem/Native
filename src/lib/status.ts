// Maps any workflow status enum value (RequestStatus, QuoteStatus,
// OrderStatus, ContentAssetStatus, BookingStatus, InvoiceStatus) to a
// presentation tone. Pure + exhaustive-by-default so it's safe for any
// value and unit testable.

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONES: Record<string, Tone> = {
  ACCEPTED: "success",
  APPROVED: "success",
  FINAL: "success",
  LIVE: "success",
  COMPLETED: "success",
  CONFIRMED: "success",
  PUBLISHED: "success",
  PAID: "success",
  BOOKED: "success",

  SUBMITTED: "info",
  SENT: "info",
  QUOTED: "info",
  IN_REVIEW: "info",
  IN_PRODUCTION: "info",
  SCHEDULED: "info",
  ISSUED: "info",
  INVOICED: "info",

  PENDING: "warning",
  CHANGES_REQUESTED: "warning",
  EXPIRED: "warning",
  OVERDUE: "warning",

  DECLINED: "danger",
  CANCELLED: "danger",
  REJECTED: "danger",

  DRAFT: "neutral",
  CLOSED: "neutral",
};

export function statusTone(value: string): Tone {
  return TONES[String(value ?? "").toUpperCase()] ?? "neutral";
}

export function statusLabel(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}
