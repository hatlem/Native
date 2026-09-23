import { appUrl } from "@/lib/url";

// The signed-in page where the buyer reviews and accepts this quote. Printed
// (and linked) on every quote PDF so a forwarded or downloaded copy always
// leads back to the live version — the PDF is a snapshot, the page is the
// source of truth (pris-på-forespørsel lines get priced there, accept lives
// there). Absolute via appUrl(), never a request-derived host.
export function quoteOnlineUrl(requestId: string, locale: string): string {
  return `${appUrl().replace(/\/+$/, "")}/${locale}/requests/${requestId}`;
}
