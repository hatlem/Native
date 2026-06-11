// Phase 4 — pricing intelligence & benchmarks (PLAN.md §4).
//
// Pure, deterministic, DB-free so it can be unit-tested and reused by the
// desk reports page and the price editor. Everything here is ADVISORY: a
// suggested margin is a hint the desk can take or ignore — nothing auto-
// applies a price.

import { DEFAULT_MARGIN_PCT } from "@/lib/money";

// ---------- Benchmarks ----------
// One observation per inventory quote line on a *decided* quote (accepted
// or lost). `won` = the quote was accepted. Grouped by a caller-chosen key
// (title id, category, …) so the same helper serves title- and
// category-level benchmarks.

export type BenchmarkRow = {
  key: string;
  marginPct: number;
  lineTotal: number;
  won: boolean;
};

export type Benchmark = {
  key: string;
  samples: number;
  avgMarginPct: number; // one decimal
  winRatePct: number; // one decimal, accepted / decided
  avgLineTotal: number; // rounded
};

export function benchmarkBy(rows: BenchmarkRow[]): Benchmark[] {
  const byKey = new Map<string, BenchmarkRow[]>();
  for (const r of rows) {
    const list = byKey.get(r.key);
    if (list) list.push(r);
    else byKey.set(r.key, [r]);
  }
  const out: Benchmark[] = [];
  for (const [key, list] of byKey) {
    const samples = list.length;
    const wins = list.filter((r) => r.won).length;
    const sumMargin = list.reduce((s, r) => s + r.marginPct, 0);
    const sumTotal = list.reduce((s, r) => s + r.lineTotal, 0);
    out.push({
      key,
      samples,
      avgMarginPct: Math.round((sumMargin / samples) * 10) / 10,
      winRatePct: Math.round((wins / samples) * 1000) / 10,
      avgLineTotal: Math.round(sumTotal / samples),
    });
  }
  // Most-quoted first; stable tie-break by key.
  return out.sort((a, b) => b.samples - a.samples || a.key.localeCompare(b.key));
}

// ---------- Margin suggestion ----------

export type MarginObservation = { marginPct: number; won: boolean };

export type MarginSuggestion = {
  marginPct: number;
  // How we arrived at it, so the UI can explain the hint honestly.
  basis: "win-rate" | "category-median" | "default";
  sampleSize: number;
};

export type SuggestMarginOpts = {
  // Below this many decided quotes we don't trust the win-rate signal and
  // fall back to the category median (then the platform default).
  minSamples?: number;
  // The lowest win rate (0..1) we still consider "winning" at a margin.
  winRateThreshold?: number;
};

// Find the highest margin tier whose historical win rate still clears the
// threshold — i.e. the most we've been able to charge and still close the
// deal. Falls back to the category median, then the platform default, when
// the data is too thin to trust.
export function suggestMargin(
  observations: MarginObservation[],
  categoryMedianMargin: number | null,
  opts: SuggestMarginOpts = {},
): MarginSuggestion {
  const minSamples = opts.minSamples ?? 5;
  const threshold = opts.winRateThreshold ?? 0.5;

  const fallback = (): MarginSuggestion =>
    categoryMedianMargin != null
      ? {
          marginPct: Math.round(categoryMedianMargin * 10) / 10,
          basis: "category-median",
          sampleSize: observations.length,
        }
      : {
          // TODO(margin-rules): admin default not threaded here yet — display-only estimate
          // (observations are grouped per category across markets, so no single
          // market code is in scope to resolve a MarginRule against).
          marginPct: DEFAULT_MARGIN_PCT,
          basis: "default",
          sampleSize: observations.length,
        };

  if (observations.length < minSamples) return fallback();

  // Bucket by integer margin; compute win rate per bucket.
  const buckets = new Map<number, { won: number; total: number }>();
  for (const o of observations) {
    const m = Math.round(o.marginPct);
    const b = buckets.get(m) ?? { won: 0, total: 0 };
    b.total += 1;
    if (o.won) b.won += 1;
    buckets.set(m, b);
  }

  const winning = [...buckets.entries()]
    .filter(([, b]) => b.won / b.total >= threshold)
    .map(([m]) => m);

  if (winning.length === 0) return fallback();

  return {
    marginPct: Math.max(...winning),
    basis: "win-rate",
    sampleSize: observations.length,
  };
}

// Median of a numeric list, or null when empty. Helper for deriving the
// category-median fallback from benchmark data.
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
