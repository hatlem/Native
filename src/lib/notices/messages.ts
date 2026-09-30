// Message-file access for notices rendered outside next-intl's request scope
// (server actions, background sweeps, the /notifications re-render).
//
// Notice copy lives in the `notices` namespace of src/messages/<locale>.json,
// so the locale-parity test guarantees every key exists in all six languages
// and translators work in one place. Same approach as payment-terms-text.ts:
// the JSON is imported directly and formatted with ICU (plurals included).

import { createTranslator } from "next-intl";
import daMessages from "@/messages/da.json";
import deMessages from "@/messages/de.json";
import enMessages from "@/messages/en.json";
import fiMessages from "@/messages/fi.json";
import noMessages from "@/messages/no.json";
import svMessages from "@/messages/sv.json";
import type { BuyerLocale } from "@/lib/market-locale";
import { formatMoney, intlLocale } from "@/lib/money";

const MESSAGES = { da: daMessages, de: deMessages, en: enMessages, fi: fiMessages, no: noMessages, sv: svMessages };

export const NOTICE_LOCALES: readonly BuyerLocale[] = ["en", "no", "sv", "da", "fi", "de"];

/** Narrow an untrusted string (User.locale, a form field) to a notice locale. */
export function asNoticeLocale(value: string | null | undefined): BuyerLocale | null {
  return NOTICE_LOCALES.includes(value as BuyerLocale) ? (value as BuyerLocale) : null;
}

export function noticeT(locale: BuyerLocale) {
  return createTranslator({ locale, messages: MESSAGES[locale], namespace: "notices" });
}

export function publisherInviteT(locale: BuyerLocale) {
  return createTranslator({ locale, messages: MESSAGES[locale], namespace: "publisherInviteEmail" });
}

// Product-type label ("Native article", "Annonsørinnhold" …) in `locale` — the
// same `productType` strings the catalog shows. An unknown type (a future
// enum value on a row written by a newer deploy) prints as stored rather than
// throwing mid-notification.
export function productTypeLabel(type: string, locale: BuyerLocale): string {
  const labels = MESSAGES[locale].productType as Record<string, string>;
  return labels[type] ?? type;
}

export function noticeMoney(amount: number, currency: string, locale: BuyerLocale): string {
  return formatMoney(amount, currency, locale);
}

export function noticeNumber(value: number, locale: BuyerLocale): string {
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 0 }).format(value);
}

// Calendar dates (due dates, flight windows) are stored as UTC midnights or
// end-of-day UTC instants and printed as that UTC calendar day — the same
// day the order, invoice and quote pages show.
export function noticeDate(iso: string, locale: BuyerLocale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(iso),
  );
}
