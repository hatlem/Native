import { intlLocale } from "@/lib/money";
import type { QuotePdfRow } from "./quote-pdf-data";
import daMessages from "@/messages/da.json";
import deMessages from "@/messages/de.json";
import enMessages from "@/messages/en.json";
import fiMessages from "@/messages/fi.json";
import noMessages from "@/messages/no.json";
import svMessages from "@/messages/sv.json";

// Customer-facing quote copy (the `quotePdf` namespace), shared by the PDF
// and DOCX renderers so both formats always say the same thing.
export type QuoteMessages = Record<string, string>;

const ALL = { da: daMessages, de: deMessages, en: enMessages, fi: fiMessages, no: noMessages, sv: svMessages };

const QUOTE_MESSAGES: Record<string, QuoteMessages> = Object.fromEntries(
  Object.entries(ALL).map(([locale, m]) => [locale, m.quotePdf]),
);

// ProductType enum value → the buyer-facing format name the catalog uses.
const FORMAT_LABELS: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(ALL).map(([locale, m]) => [locale, m.productType]),
);

export function quoteMessagesFor(locale: string): QuoteMessages {
  return QUOTE_MESSAGES[locale] ?? QUOTE_MESSAGES.en;
}

// "Native-artikel" rather than the raw enum value `NATIVE_ARTICLE`. Falls
// back to English, then to the stored value, so an unknown type still shows.
export function quoteFormatLabel(format: string, locale: string): string {
  if (!format) return "";
  return FORMAT_LABELS[locale]?.[format] ?? FORMAT_LABELS.en[format] ?? format;
}

export function qt(
  messages: QuoteMessages,
  key: string,
  values?: Record<string, string | number>,
): string {
  let s = messages[key] ?? key;
  if (values) {
    for (const [k, v] of Object.entries(values)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

// The small grey facts line under each title (reach, vertical, audience,
// frequency). Null when the title has none of them.
export function quoteRowBlurb(
  row: QuotePdfRow,
  messages: QuoteMessages,
  locale: string,
): string | null {
  const n = (v: number) => v.toLocaleString(intlLocale(locale));
  const parts = [
    row.digitalReach
      ? `${qt(messages, "digitalReach")}: ${n(row.digitalReach)}`
      : row.circulation
        ? `${qt(messages, "circulation")}: ${n(row.circulation)}`
        : null,
    row.vertical ? `${qt(messages, "vertical")}: ${row.vertical}` : null,
    row.audience ? `${qt(messages, "audience")}: ${row.audience}` : null,
    row.frequency ? `${qt(messages, "frequency")}: ${row.frequency}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
