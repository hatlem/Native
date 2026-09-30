import daMessages from "@/messages/da.json";
import deMessages from "@/messages/de.json";
import enMessages from "@/messages/en.json";
import fiMessages from "@/messages/fi.json";
import noMessages from "@/messages/no.json";
import svMessages from "@/messages/sv.json";
import type { QuoteMessages } from "./quote-messages";

// The invoice PDF renders outside next-intl (a route handler), so it reads
// the same `invoice` namespace the invoice page uses straight from the
// message files — one set of strings for page and document.
const ALL = { da: daMessages, de: deMessages, en: enMessages, fi: fiMessages, no: noMessages, sv: svMessages };

const INVOICE_MESSAGES: Record<string, QuoteMessages> = Object.fromEntries(
  Object.entries(ALL).map(([locale, m]) => [locale, m.invoice]),
);

export function invoiceMessagesFor(locale: string): QuoteMessages {
  return INVOICE_MESSAGES[locale] ?? INVOICE_MESSAGES.en;
}
