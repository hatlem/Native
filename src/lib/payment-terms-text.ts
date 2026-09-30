import { createTranslator } from "next-intl";
import daMessages from "@/messages/da.json";
import deMessages from "@/messages/de.json";
import enMessages from "@/messages/en.json";
import fiMessages from "@/messages/fi.json";
import noMessages from "@/messages/no.json";
import svMessages from "@/messages/sv.json";

// The payment-terms sentence for renderers outside next-intl's request
// scope (quote PDF/DOCX, invoice PDF). Same `paymentTerms.line` message the
// pages render, formatted with ICU so "1 day" / "14 days" plurals are right
// in every language.
const MESSAGES = { da: daMessages, de: deMessages, en: enMessages, fi: fiMessages, no: noMessages, sv: svMessages };

export function paymentTermsLine(locale: string, days: number): string {
  const key = (locale in MESSAGES ? locale : "en") as keyof typeof MESSAGES;
  const t = createTranslator({
    locale: key,
    messages: MESSAGES[key],
    namespace: "paymentTerms",
  });
  return t("line", { days });
}
