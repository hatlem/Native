// Indicative pricing per PLAN.md §8/§11:
//   displayPrice = basePrice * (1 + marginPct/100) * seasonalMultiplier
// Publicly we only ever show an *indicative* "from" price; the firm price is
// produced by the desk via a Quote.

const LOCALE_TO_INTL: Record<string, string> = {
  en: "en-GB",
  no: "nb-NO",
  sv: "sv-SE",
  da: "da-DK",
};

export function indicativePrice(
  basePrice: number,
  marginPct: number,
  seasonalMultiplier = 1,
): number {
  return basePrice * (1 + marginPct / 100) * seasonalMultiplier;
}

export function formatMoney(
  amount: number,
  currency: string,
  locale: string,
): string {
  const intlLocale = LOCALE_TO_INTL[locale] ?? "en-GB";
  return new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
