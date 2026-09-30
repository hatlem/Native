// Payment terms: one rule, one source of truth.
//
// Terms are per customer organization (Organization.paymentTermsDays),
// net N days from the invoice date, default 14. Everything that states or
// applies terms reads them from here: the buyer's web quote, the quote PDF
// and DOCX, the invoice due date, and the invoice page / PDF. Before this,
// the web quote said "50/50 at acceptance/publication", the documents said
// net 14 and the invoice was due in 30 days — three terms for one deal.
//
// Only SUPERADMIN sets a customer's terms (they are a commercial agreement,
// not an operational toggle), see canSetPaymentTerms.

export const DEFAULT_PAYMENT_TERMS_DAYS = 14;
// Bounds keep a typo ("140" for "14", "0") from reaching an invoice. The DB
// enforces the same range with a CHECK constraint.
export const MIN_PAYMENT_TERMS_DAYS = 1;
export const MAX_PAYMENT_TERMS_DAYS = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

// A stored value, or the default for a missing org / legacy null.
export function paymentTermsDaysFor(
  org: { paymentTermsDays?: number | null } | null | undefined,
): number {
  const days = org?.paymentTermsDays;
  return typeof days === "number" && isValidPaymentTermsDays(days)
    ? days
    : DEFAULT_PAYMENT_TERMS_DAYS;
}

export function isValidPaymentTermsDays(days: number): boolean {
  return (
    Number.isInteger(days) &&
    days >= MIN_PAYMENT_TERMS_DAYS &&
    days <= MAX_PAYMENT_TERMS_DAYS
  );
}

// Parse the SUPERADMIN form input. Whole days only: "14" → 14; "14.5",
// "", "abc", out-of-range → null.
export function parsePaymentTermsDays(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const days = Number(trimmed);
  return isValidPaymentTermsDays(days) ? days : null;
}

// Net N days from the invoice date.
export function invoiceDueAt(issuedAt: Date, days: number): Date {
  return new Date(issuedAt.getTime() + days * DAY_MS);
}

export function canSetPaymentTerms(role: string | null | undefined): boolean {
  return role === "SUPERADMIN";
}
