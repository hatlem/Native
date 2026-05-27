// Indicative pricing per PLAN.md §8/§11:
//   displayPrice = basePrice * (1 + marginPct/100) * seasonalMultiplier
// Publicly we only ever show an *indicative* "from" price; the firm price is
// produced by the desk via a Quote.

// next-intl URL slug → BCP 47 language tag. The URL-locale slugs `at`,
// `ch`, `uk`, `ie` are country codes that Intl.NumberFormat /
// Date.toLocaleString reject with RangeError if passed directly. Map
// them to the language variant we want to show in each market.
const LOCALE_TO_INTL: Record<string, string> = {
  en: "en-GB",
  no: "nb-NO",
  sv: "sv-SE",
  da: "da-DK",
  fi: "fi-FI",
  de: "de-DE",
  at: "de-AT",
  ch: "de-CH",
  uk: "en-GB",
  ie: "en-IE",
};

// Shared adapter for any Intl API call that takes a locale tag. Avoid
// passing the bare URL slug directly to `Number.toLocaleString` etc.
// because the country-coded slugs throw RangeError on stock V8.
export function intlLocale(locale: string): string {
  return LOCALE_TO_INTL[locale] ?? "en-GB";
}

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

// Firm line total used by the desk when producing a Quote.
export function firmLineTotal(
  basePrice: number,
  marginPct: number,
  quantity: number,
  seasonalMultiplier = 1,
): number {
  return basePrice * (1 + marginPct / 100) * seasonalMultiplier * quantity;
}

export function withVat(amount: number, vatPct: number): number {
  return amount * (1 + vatPct / 100);
}

// ---------- Rate card / quote engine ----------
// The desk (and the self-serve firm path) turn a basket into priced quote
// lines using the product's rate card. A product may carry several
// PriceRules forming volume tiers; the applicable tier is the one with the
// highest minVolume the quantity still satisfies.

export const DEFAULT_MARGIN_PCT = 15;
export const DEFAULT_SEASONAL = 1;

export type RateRule = {
  marginPct: number;
  seasonalMultiplier: number;
  minVolume: number;
};

export function pickRule(
  rules: RateRule[],
  quantity: number,
): RateRule | null {
  if (rules.length === 0) return null;
  const eligible = rules
    .filter((r) => r.minVolume <= quantity)
    .sort((a, b) => b.minVolume - a.minVolume);
  if (eligible[0]) return eligible[0];
  // Quantity below every tier's floor — fall back to the lowest tier.
  return [...rules].sort((a, b) => a.minVolume - b.minVolume)[0];
}

export type QuotableItem = {
  productId: string;
  name: string;
  quantity: number;
  basePrice: number;
  rules: RateRule[];
};

export type QuoteLineComputation = {
  productId: string;
  description: string;
  quantity: number;
  unitCost: number;
  marginPct: number;
  lineTotal: number;
};

export function computeQuoteLines(
  items: QuotableItem[],
): QuoteLineComputation[] {
  return items.map((i) => {
    const rule = pickRule(i.rules, i.quantity);
    const marginPct = rule ? rule.marginPct : DEFAULT_MARGIN_PCT;
    const seasonal = rule ? rule.seasonalMultiplier : DEFAULT_SEASONAL;
    return {
      productId: i.productId,
      description: i.name,
      quantity: i.quantity,
      unitCost: i.basePrice,
      marginPct,
      lineTotal: Math.round(
        firmLineTotal(i.basePrice, marginPct, i.quantity, seasonal),
      ),
    };
  });
}

export function quoteTotals(
  lines: { lineTotal: number }[],
  vatPct: number,
): { subtotal: number; total: number } {
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  return { subtotal, total: Math.round(withVat(subtotal, vatPct)) };
}

// Normalise persisted PriceRules (Prisma Decimals) into plain RateRules.
export function toRateRules(
  rules: { marginPct: unknown; seasonalMultiplier: unknown; minVolume: number }[],
): RateRule[] {
  return rules.map((r) => ({
    marginPct: Number(r.marginPct),
    seasonalMultiplier: Number(r.seasonalMultiplier),
    minVolume: r.minVolume,
  }));
}

// Public "from" price for a given quantity, using the same tier logic as
// the firm quote so the indicative figure can't drift from the quote.
export function indicativeFromRules(
  basePrice: number,
  rules: RateRule[],
  quantity = 1,
): number {
  const rule = pickRule(rules, quantity);
  return indicativePrice(
    basePrice,
    rule ? rule.marginPct : DEFAULT_MARGIN_PCT,
    rule ? rule.seasonalMultiplier : DEFAULT_SEASONAL,
  );
}
