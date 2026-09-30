import { formatMoney, intlLocale } from "@/lib/money";
import { safeLocale } from "@/i18n/routing";
import { localizeTaxonomy, localizeVertical } from "@/lib/taxonomy-i18n";
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

// The row's main text: the title, or "Extra work / revision" for billed hours
// (whose description then goes into the detail line).
export function quoteRowTitle(row: QuotePdfRow, messages: QuoteMessages): string {
  return row.kind === "EXTRA_WORK" ? qt(messages, "extraWork") : row.titleName;
}

// The pricing detail under a row, shared by the PDF and the DOCX: an extra
// work row's description and hours × rate ("Third revision round · 2.5 h ×
// NOK 1,650/h"), or the article fee folded into a placement row ("Incl.
// article written by NativeSpin · from NOK 2,000"). Null when neither.
export function quoteRowDetail(
  row: QuotePdfRow,
  messages: QuoteMessages,
  locale: string,
  currency: string,
): string | null {
  if (row.kind === "EXTRA_WORK") {
    const hours =
      row.hours != null && row.hourlyRate != null
        ? qt(messages, "extraWorkDetail", {
            hours: new Intl.NumberFormat(intlLocale(locale)).format(row.hours),
            rate: formatMoney(row.hourlyRate, currency, locale),
          })
        : null;
    return [row.titleName, hours].filter(Boolean).join(" · ") || null;
  }
  return row.articleFee != null
    ? qt(messages, "inclArticle", { amount: formatMoney(row.articleFee, currency, locale) })
    : null;
}

// The small grey facts line under each title (reach, vertical, audience,
// frequency). Null when the title has none of them. The taxonomy values are
// stored in English research-sheet form ("News (National)"), so they go
// through the same display mapping the catalog title page uses — a Norwegian
// quote must not print English labels next to Norwegian headings.
export function quoteRowBlurb(
  row: QuotePdfRow,
  messages: QuoteMessages,
  locale: string,
): string | null {
  const n = (v: number) => v.toLocaleString(intlLocale(locale));
  const appLocale = safeLocale(locale);
  const parts = [
    row.digitalReach
      ? `${qt(messages, "digitalReach")}: ${n(row.digitalReach)}`
      : row.circulation
        ? `${qt(messages, "circulation")}: ${n(row.circulation)}`
        : null,
    row.vertical ? `${qt(messages, "vertical")}: ${localizeVertical(row.vertical, appLocale)}` : null,
    row.audience ? `${qt(messages, "audience")}: ${localizeVertical(row.audience, appLocale)}` : null,
    row.frequency ? `${qt(messages, "frequency")}: ${localizeTaxonomy(row.frequency, appLocale)}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
