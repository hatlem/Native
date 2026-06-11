// Price bands — the ONLY price representation buyers see on browse
// surfaces (catalog grid, title detail, compare, JSON API, CSV export,
// JSON-LD). Many distinct prices collapse into one bucket label so
// neither the customer price nor the net basePrice can be
// reverse-engineered from what we publish.
// Spec: docs/superpowers/specs/2026-06-11-catalog-price-bands-design.md

export type Band =
  | { kind: "under"; high: number }
  | { kind: "range"; low: number; high: number }
  | { kind: "over"; low: number };

// Per-currency bucket boundaries (ascending). Scandi kroner and the
// EUR-scale currencies differ ~10×. NOK/SEK/DKK are calibrated from the
// 2026-06 applied quotes; EUR/GBP/CHF are scale-guesses — recalibrate
// after each market's first ~10 applied quotes (data-only PR).
const BUCKETS: Record<string, number[]> = {
  NOK: [15_000, 25_000, 40_000, 60_000, 90_000],
  SEK: [15_000, 25_000, 40_000, 60_000, 90_000],
  DKK: [15_000, 25_000, 40_000, 60_000, 90_000],
  EUR: [1_500, 2_500, 4_000, 6_000, 9_000],
  GBP: [1_500, 2_500, 4_000, 6_000, 9_000],
  CHF: [1_500, 2_500, 4_000, 6_000, 9_000],
};

// Unknown currency → EUR scale. A wrong-but-plausible band beats a
// crashed render path.
const FALLBACK_BUCKETS = BUCKETS.EUR;

export function priceBand(amount: number, currency: string): Band {
  const buckets = BUCKETS[currency] ?? FALLBACK_BUCKETS;
  // Bad numeric input (NaN from a failed Decimal/parse, negative from a
  // data error) must never render "NaN–NaNk" — clamp to the lowest band.
  if (!Number.isFinite(amount) || amount < 0) {
    return { kind: "under", high: buckets[0] };
  }
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  if (amount < first) return { kind: "under", high: first };
  if (amount >= last) return { kind: "over", low: last };
  // First boundary strictly above `amount` closes the range; the one
  // before it opens it (inclusive-low, exclusive-high).
  const closeIdx = buckets.findIndex((b) => amount < b);
  return { kind: "range", low: buckets[closeIdx - 1], high: buckets[closeIdx] };
}

// "40–60k NOK" | "90k+ NOK" | "< 15k DKK". Deliberately locale-neutral:
// "k" reads as thousand in every market we serve, and the ISO code
// avoids symbol ambiguity ("kr" is three different currencies here).
function k(n: number): string {
  return String(n / 1000);
}

export function bandLabel(band: Band, currency: string): string {
  switch (band.kind) {
    case "under":
      return `< ${k(band.high)}k ${currency}`;
    case "over":
      return `${k(band.low)}k+ ${currency}`;
    case "range":
      return `${k(band.low)}–${k(band.high)}k ${currency}`;
  }
}
