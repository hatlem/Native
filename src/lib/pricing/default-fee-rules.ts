import type { ContentFeeRuleSpec } from "../money";

// The desk's starting price list for writing an article (ContentFeeRule), as
// the seeds create it (prisma/seed.ts, scripts/seed-content-fees.ts). ONE rule
// per market, for every format: a print advertorial costs the same to write
// as a digital native article (decision 2026-09-30; migration
// 20261001011000_unify_article_fees collapsed the old per-format rules). The
// desk tunes the amounts in /desk/content-fees; an offer's or publication's
// own production fee still beats the rule (pricing/production-fee.ts).
//
// Krone markets 2 000 (adaptation half), EUR/GBP/CHF markets 200 — the real
// fees set 2026-06-12, now for every format.
export const ARTICLE_FEE_KRONE = { greenfieldFee: 2000, adaptationFee: 1000 } as const;
export const ARTICLE_FEE_MAJOR = { greenfieldFee: 200, adaptationFee: 100 } as const;

const KRONE = new Set(["NOK", "SEK", "DKK"]);

// Each market's billing currency (Market.currency as seeded).
export const MARKET_CURRENCIES = {
  NO: "NOK",
  SE: "SEK",
  DK: "DKK",
  FI: "EUR",
  DE: "EUR",
  AT: "EUR",
  CH: "CHF",
  UK: "GBP",
  IE: "EUR",
  NL: "EUR",
  BE: "EUR",
} as const satisfies Record<string, string>;

// productType is always null: the rule prices every format of its market.
export type DefaultFeeRule = Omit<ContentFeeRuleSpec, "active" | "marketCode" | "productType"> & {
  marketCode: string;
  productType: null;
  note: string;
};

export function defaultContentFeeRules(markets: readonly { code: string; currency: string }[]): DefaultFeeRule[] {
  return markets.map((m) => {
    const fee = KRONE.has(m.currency) ? ARTICLE_FEE_KRONE : ARTICLE_FEE_MAJOR;
    return {
      marketCode: m.code,
      productType: null,
      currency: m.currency,
      greenfieldFee: fee.greenfieldFee,
      adaptationFee: fee.adaptationFee,
      note: "Article fee for every format (print and digital alike). Tune in /desk/content-fees.",
    };
  });
}
