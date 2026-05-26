// Per-market activation blueprint — what `markTitleNative` uses to
// generate seed product rows when a publisher first goes live.
//
// History: the original blueprint was market-blind (NOK 25 per 1000
// reach for native articles). That makes sense in NO; it produces
// EUR 120 for a German B2B trade with 4,800 IVW circulation — well
// below NativeSpin's content-production cost. Ingrid's scenario
// (Frankfurter Stilhaus expansion) surfaced this as a real launch
// blocker — without per-market overrides the catalog would either
// publish nonsense indicative prices or require manual overrides on
// every German activation.
//
// Two knobs per market:
//   - perThousandFactor: multiplier on the base rate
//     (1.0 = same as Nordic; higher = market bears more per-thousand)
//   - floor: minimum basePrice in market currency, applied after the
//     per-thousand calc. Below the floor → bump to the floor.
//
// Numbers below are starting points reflecting publicly observable
// rate cards. They're meant to be tuned by Ingrid via /desk/titles as
// catalog coverage grows; this module is the single place to do so.

import { MarketCode, ProductType, PriceVisibility } from "@prisma/client";

export type BlueprintRow = {
  type: ProductType;
  perThousandReach: number;
  leadTimeDays: number;
  visibility: PriceVisibility;
  marginPct: number;
  seasonalMultiplier: number;
};

// Nordic baseline — matches what title-actions used pre-Ingrid.
const BASELINE: BlueprintRow[] = [
  {
    type: ProductType.NATIVE_ARTICLE,
    perThousandReach: 25,
    leadTimeDays: 12,
    visibility: PriceVisibility.INDICATIVE,
    marginPct: 22,
    seasonalMultiplier: 1,
  },
  {
    type: ProductType.ADVERTORIAL,
    perThousandReach: 18,
    leadTimeDays: 10,
    visibility: PriceVisibility.INDICATIVE,
    marginPct: 18,
    seasonalMultiplier: 1,
  },
  {
    type: ProductType.NATIVE_DISPLAY,
    perThousandReach: 12,
    leadTimeDays: 7,
    visibility: PriceVisibility.FIRM,
    marginPct: 12,
    seasonalMultiplier: 1.1,
  },
];

// Per-market knobs. Anything missing defaults to factor=1.0, floor=0
// (i.e. the baseline). Add a row whenever a new market is enabled.
const MARKET_OVERRIDES: Partial<
  Record<MarketCode, { perThousandFactor: number; floor: number }>
> = {
  // Nordic baseline — explicit so the defaults table is self-documenting.
  [MarketCode.NO]: { perThousandFactor: 1.0, floor: 8_000 },
  [MarketCode.SE]: { perThousandFactor: 1.0, floor: 8_000 },
  [MarketCode.DK]: { perThousandFactor: 1.0, floor: 6_000 },
  [MarketCode.FI]: { perThousandFactor: 1.0, floor: 700 }, // EUR
  // DACH — higher per-thousand rates than Nordics for premium consumer
  // titles, but EUR floor matters for niche B2B (Ingrid's Frankfurter
  // Stilhaus 4,800-circ case would otherwise auto-price at ~EUR 120).
  [MarketCode.DE]: { perThousandFactor: 1.4, floor: 1_200 },
  [MarketCode.AT]: { perThousandFactor: 1.2, floor: 900 },
  [MarketCode.CH]: { perThousandFactor: 1.8, floor: 1_800 }, // CHF
  // English-language markets — placeholder rates until rate cards land.
  [MarketCode.UK]: { perThousandFactor: 1.6, floor: 1_000 }, // GBP
  [MarketCode.IE]: { perThousandFactor: 1.2, floor: 900 }, // EUR
};

// Compute the seed base price for a single product type, given a
// title's monthly reach and target market. Pure — title-actions
// remains the only writer, so this helper stays unit-testable.
export function basePriceFor(
  reach: number,
  blueprint: BlueprintRow,
  market: MarketCode,
): number {
  const override = MARKET_OVERRIDES[market] ?? {
    perThousandFactor: 1.0,
    floor: 0,
  };
  const raw = (reach / 1000) * blueprint.perThousandReach * override.perThousandFactor;
  return Math.max(override.floor, Math.round(raw));
}

// Return the rows to seed. We export the same shape as the legacy
// inline constant so the caller pattern in title-actions.markTitleNative
// stays one line per product.
export function blueprintFor(market: MarketCode): BlueprintRow[] {
  return BASELINE;
}

// Surface the floor + factor so a future "preview pricing" UI can
// explain WHY an auto-generated price came out where it did — Ingrid
// wants to see this before committing to activation.
export function marketAdjustments(market: MarketCode): {
  perThousandFactor: number;
  floor: number;
} {
  return (
    MARKET_OVERRIDES[market] ?? { perThousandFactor: 1.0, floor: 0 }
  );
}
