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

// ---------------------------------------------------------------------------
// Band RANGES — what banded lines contribute to a total that mixes several of
// them (the /plan summary, the catalog plan bar, the share page). A range is a
// sum of bucket boundaries, so it is never narrower than the buckets it came
// from and never reveals an exact price. `high: null` = open-ended (a line
// sits in the top "90k+" bucket) and renders as "from".
// ---------------------------------------------------------------------------

export type BandRange = { low: number; high: number | null };

export function bandRange(band: Band): BandRange {
  switch (band.kind) {
    case "under":
      return { low: 0, high: band.high };
    case "range":
      return { low: band.low, high: band.high };
    case "over":
      return { low: band.low, high: null };
  }
}

export function addRanges(a: BandRange | null, b: BandRange): BandRange {
  if (!a) return b;
  return {
    low: a.low + b.low,
    high: a.high === null || b.high === null ? null : a.high + b.high,
  };
}

// Same locale-neutral shape as bandLabel: "15–40k NOK", "< 40k NOK" (every
// banded line sits in the bottom bucket), "90k+ NOK" (open-ended).
export function rangeLabel(range: BandRange, currency: string): string {
  if (range.high === null) return `${k(range.low)}k+ ${currency}`;
  if (range.low === 0) return `< ${k(range.high)}k ${currency}`;
  return `${k(range.low)}–${k(range.high)}k ${currency}`;
}

// ---------------------------------------------------------------------------
// Band TIERS — the currency-neutral index of a band: 0 is the bottom "under"
// bucket, BAND_TIER_COUNT - 1 the open top one. Every currency has the same
// number of buckets, so tier 2 means "25–40k NOK" and "2.5–4k EUR" alike.
// Stored on Title.priceBandTier so the catalog filters and pages on the band
// in the database (lib/pricing/title-band.ts).
// ---------------------------------------------------------------------------

function bucketsFor(currency: string): number[] {
  return BUCKETS[currency] ?? FALLBACK_BUCKETS;
}

export const BAND_TIER_COUNT = FALLBACK_BUCKETS.length + 1;

export function bandTier(band: Band, currency: string): number {
  const buckets = bucketsFor(currency);
  switch (band.kind) {
    case "under":
      return 0;
    case "over":
      return buckets.length;
    case "range":
      return buckets.indexOf(band.low) + 1;
  }
}

export function tierBand(tier: number, currency: string): Band {
  const buckets = bucketsFor(currency);
  if (tier <= 0) return { kind: "under", high: buckets[0] };
  if (tier >= buckets.length) return { kind: "over", low: buckets[buckets.length - 1] };
  return { kind: "range", low: buckets[tier - 1], high: buckets[tier] };
}

export function isBandTier(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < BAND_TIER_COUNT;
}

// A tier's label for the catalog filter, in every currency the buyer is
// browsing: currencies on the same bucket scale share one label
// ("25–40k NOK/SEK/DKK · 2.5–4k EUR/GBP/CHF"; "25–40k NOK" for Norway alone).
export function tierLabel(tier: number, currencies: string[]): string {
  const byScale = new Map<string, string[]>();
  for (const currency of [...new Set(currencies)]) {
    const key = bucketsFor(currency).join(",");
    byScale.set(key, [...(byScale.get(key) ?? []), currency]);
  }
  return [...byScale.values()]
    .map((group) => bandLabel(tierBand(tier, group[0]), group.join("/")))
    .join(" · ");
}
