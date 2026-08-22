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
  kind: "INVENTORY" | "CONTENT_FEE";
  // Null for CONTENT_FEE lines — they bill our production service.
  productId: string | null;
  description: string;
  quantity: number;
  unitCost: number;
  marginPct: number;
  lineTotal: number;
};

export function computeQuoteLines(
  items: QuotableItem[],
  defaultMarginPct: number = DEFAULT_MARGIN_PCT,
): QuoteLineComputation[] {
  return items.map((i) => {
    const rule = pickRule(i.rules, i.quantity);
    const marginPct = rule ? rule.marginPct : defaultMarginPct;
    const seasonal = rule ? rule.seasonalMultiplier : DEFAULT_SEASONAL;
    return {
      kind: "INVENTORY" as const,
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

// ---------- Content-fee pricing ----------
// Our own production-service revenue, billed when a buyer asks NativeSpin
// to produce the native content for a placement. Priced from a
// ContentFeeRule (desk-owned), not the publisher rate card. One fee per
// placement: the article is written once regardless of insertion count.

export type ContentFeeRuleSpec = {
  marketCode: string | null;
  productType: string | null;
  currency: string;
  greenfieldFee: number;
  adaptationFee: number | null;
  active: boolean;
};

// Most-specific active match wins. Scoring: a matched productType is
// worth more than a matched market (type drives effort far more than
// geography); a wildcard (null) dimension scores 0. A rule whose non-null
// dimension contradicts the request is ineligible.
export function pickContentFeeRule(
  rules: ContentFeeRuleSpec[],
  productType: string,
  marketCode: string,
): ContentFeeRuleSpec | null {
  const eligible = rules.filter(
    (r) =>
      r.active &&
      (r.productType === null || r.productType === productType) &&
      (r.marketCode === null || r.marketCode === marketCode),
  );
  if (eligible.length === 0) return null;
  const score = (r: ContentFeeRuleSpec) =>
    (r.productType === productType ? 2 : 0) +
    (r.marketCode === marketCode ? 1 : 0);
  return [...eligible].sort((a, b) => score(b) - score(a))[0];
}

export function contentFeeAmount(
  rule: ContentFeeRuleSpec,
  isAdaptation = false,
): number {
  if (isAdaptation && rule.adaptationFee != null) return rule.adaptationFee;
  return rule.greenfieldFee;
}

export type ContentFeeItem = {
  name: string;
  productType: string;
  isAdaptation?: boolean;
};

// Produce CONTENT_FEE quote lines for placements the buyer wants us to
// write. Items with no matching active rule are skipped (no silent
// zero-priced line — the desk sees the gap and sets a rule).
export function computeContentFeeLines(
  items: ContentFeeItem[],
  rules: ContentFeeRuleSpec[],
  marketCode: string,
): QuoteLineComputation[] {
  const lines: QuoteLineComputation[] = [];
  for (const item of items) {
    const rule = pickContentFeeRule(rules, item.productType, marketCode);
    if (!rule) continue;
    const fee = Math.round(contentFeeAmount(rule, item.isAdaptation));
    lines.push({
      kind: "CONTENT_FEE",
      productId: null,
      description: `Content production — ${item.name}`,
      quantity: 1,
      unitCost: 0,
      marginPct: 0,
      lineTotal: fee,
    });
  }
  return lines;
}

// ---------- Default commission (MarginRule) ----------
// Desk-owned default margin % used when a product carries no PriceRule.
// Mirrors the ContentFeeRule most-specific-wins pattern, market dimension
// only: an exact market match beats the global (null-market) fallback.

export type MarginRuleSpec = {
  marketCode: string | null;
  marginPct: number;
  active: boolean;
};

// Most-specific active match wins: a matched market scores above the
// global wildcard (null). A rule whose non-null market contradicts the
// request is ineligible. No match -> null (callers fall back to
// DEFAULT_MARGIN_PCT).
export function pickMarginRule(
  rules: MarginRuleSpec[],
  marketCode: string,
): MarginRuleSpec | null {
  const eligible = rules.filter(
    (r) => r.active && (r.marketCode === null || r.marketCode === marketCode),
  );
  if (eligible.length === 0) return null;
  const score = (r: MarginRuleSpec) => (r.marketCode === marketCode ? 1 : 0);
  return [...eligible].sort((a, b) => score(b) - score(a))[0];
}

export function resolveDefaultMarginPct(
  rules: MarginRuleSpec[],
  marketCode: string,
): number {
  return pickMarginRule(rules, marketCode)?.marginPct ?? DEFAULT_MARGIN_PCT;
}

// Lines flagged priceOnRequest go out on the quote WITHOUT an amount
// ("pris på forespørsel") and never count toward subtotal/total — the
// footnote on the customer document says they are confirmed separately.
export function quoteTotals(
  lines: { lineTotal: number; priceOnRequest?: boolean }[],
  vatPct: number,
): { subtotal: number; total: number } {
  const subtotal = lines.reduce(
    (s, l) => (l.priceOnRequest ? s : s + l.lineTotal),
    0,
  );
  return { subtotal, total: Math.round(withVat(subtotal, vatPct)) };
}

// Inverse of firmLineTotal for a desk override: given the rate-card cost
// and the seller's new line total, what margin % did the seller just
// price at? Keeps the superadmin cost-vs-sell readout truthful after a
// manual reprice. Zero-cost lines (content fees, unknown cost) keep 0.
export function marginPctFromSell(
  unitCost: number,
  quantity: number,
  lineTotal: number,
): number {
  const cost = unitCost * quantity;
  if (cost <= 0) return 0;
  return Math.round((lineTotal / cost - 1) * 10000) / 100;
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
  defaultMarginPct: number = DEFAULT_MARGIN_PCT,
): number {
  const rule = pickRule(rules, quantity);
  return indicativePrice(
    basePrice,
    rule ? rule.marginPct : defaultMarginPct,
    rule ? rule.seasonalMultiplier : DEFAULT_SEASONAL,
  );
}
