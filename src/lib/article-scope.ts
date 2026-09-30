import { formatMoney } from "@/lib/money";
import { extraWorkHourlyRate, type ExtraWorkRateSpec } from "@/lib/pricing/extra-work";

// What the article fee buys: the included scope of an article NativeSpin
// writes, and what costs extra. Shown wherever a buyer or their client meets
// the fee (the plan line, the share page, the plan download, the quote page
// and its PDF/DOCX), so every surface promises the same thing:
//
//   * an average native article, as long as the format's spec says (the
//     quote derives word counts from the product spec the same way), else
//     about 600–900 words;
//   * the brief plus one revision round before approval (or the rounds the
//     offer states, Product.inclusions.revisionRounds);
//   * labelled per the publication's rules for advertiser content;
//   * interviews, images, extra rounds and other extra work billed per hour
//     at the currency's rate (lib/pricing/extra-work.ts).
//
// The fee itself is shown as "from": the included scope has a fixed price
// (line and plan totals stay exact); "from" says that work beyond it is
// billed on top.
//
// Pure: no DB, no next-intl import (the translator is passed in), so pages,
// the plan download and the quote documents all share it.

export type Translate = (key: string, values?: Record<string, string | number>) => string;

// The typical native article when the format's spec doesn't say.
export const TYPICAL_ARTICLE_WORDS = { min: 600, max: 900 } as const;
// One round before approval unless the offer states more.
export const DEFAULT_REVISION_ROUNDS = 1;

export type ArticleScope = {
  words: { min: number | null; max: number | null; fromSpec: boolean };
  revisionRounds: number;
  // The marking the publication requires ("Annonsørinnhold"), when known.
  disclosureLabel: string | null;
  hourlyRate: number | null;
  currency: string;
};

// Structural, so a Prisma product row (with or without spec) and a plain test
// object both fit.
export type ArticleScopeProduct = {
  spec?: { wordCountMin?: number | null; wordCountMax?: number | null; disclosureLabel?: string | null } | null;
  inclusions?: unknown;
  title?: { market?: { disclosureLabel?: string | null } | null } | null;
};

function statedRounds(inclusions: unknown): number | null {
  if (!inclusions || typeof inclusions !== "object") return null;
  const n = (inclusions as { revisionRounds?: unknown }).revisionRounds;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

function positive(n: number | null | undefined): number | null {
  return typeof n === "number" && n > 0 ? n : null;
}

export function articleScope(
  product: ArticleScopeProduct | null | undefined,
  currency: string,
  rates: readonly ExtraWorkRateSpec[],
): ArticleScope {
  const min = positive(product?.spec?.wordCountMin);
  const max = positive(product?.spec?.wordCountMax);
  const fromSpec = min !== null || max !== null;
  const label = product?.spec?.disclosureLabel?.trim() || product?.title?.market?.disclosureLabel?.trim() || null;
  return {
    words: fromSpec ? { min, max, fromSpec } : { ...TYPICAL_ARTICLE_WORDS, fromSpec },
    revisionRounds: statedRounds(product?.inclusions) ?? DEFAULT_REVISION_ROUNDS,
    disclosureLabel: label,
    hourlyRate: extraWorkHourlyRate(rates, currency),
    currency,
  };
}

function wordsText(words: ArticleScope["words"], t: Translate): string {
  const { min, max } = words;
  if (!words.fromSpec) return t("wordsTypical", { min: TYPICAL_ARTICLE_WORDS.min, max: TYPICAL_ARTICLE_WORDS.max });
  if (min !== null && max !== null) return t("wordsRange", { min, max });
  if (min !== null) return t("wordsMin", { min });
  return t("wordsMax", { max: max ?? 0 });
}

/** The hourly rate as the copy prints it ("1 650 kr"), or null when unset. */
export function hourlyRateLabel(scope: Pick<ArticleScope, "hourlyRate" | "currency">, locale: string): string | null {
  return scope.hourlyRate === null ? null : formatMoney(scope.hourlyRate, scope.currency, locale);
}

/**
 * The included scope as a short list, in the `articleScope` namespace. Four
 * lines: length, rounds, marking, what is billed per hour.
 */
export function articleScopeLines(
  scope: ArticleScope,
  t: Translate,
  locale: string,
  // A document spanning several currencies states every one's rate
  // ("1 650 kr / 1 600 SEK"); by default, the scope's own currency.
  rateLabel: string | null = hourlyRateLabel(scope, locale),
): string[] {
  const rate = rateLabel;
  return [
    t("average", { words: wordsText(scope.words, t) }),
    t("rounds", { rounds: scope.revisionRounds }),
    scope.disclosureLabel ? t("marking", { label: scope.disclosureLabel }) : t("markingGeneric"),
    rate ? t("hourly", { rate }) : t("hourlyNoRate"),
  ];
}

/** "Article written by NativeSpin · from NOK 2,000". */
export function articleFeeLabel(fee: number, currency: string, locale: string, t: Translate): string {
  return t("feeLabel", { amount: formatMoney(fee, currency, locale) });
}

/** "2.5 h × NOK 1,650/h" for an extra-work line. */
export function extraWorkDetail(
  line: { hours: number; hourlyRate: number },
  currency: string,
  locale: string,
  t: Translate,
): string {
  return t("extraWorkDetail", {
    hours: line.hours,
    rate: formatMoney(line.hourlyRate, currency, locale),
  });
}
