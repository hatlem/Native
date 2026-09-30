import type { MarketCode } from "@prisma/client";

// The markets NativeSpin sells in — nine, the same nine the marketing copy,
// the pricing FAQ's currency list and the catalog data cover.
//
// The MarketCode enum also carries NL and BE, left over from early planning:
// their Market rows exist but hold no titles, no currency copy and no UI
// locale. Every selector, filter and validator that a person uses reads
// THIS list, not Object.values(MarketCode), so nobody can pick (or bill to)
// a market we don't serve. The enum itself stays as the storage type — the
// public API schema and data ingest still describe it in full.
//
// String literals, no runtime Prisma import, so client components can use
// it; `satisfies` keeps it in lockstep with the enum.
export const SUPPORTED_MARKETS = [
  "NO",
  "SE",
  "DK",
  "FI",
  "DE",
  "AT",
  "CH",
  "UK",
  "IE",
] as const satisfies readonly MarketCode[];

export type SupportedMarket = (typeof SUPPORTED_MARKETS)[number];

export function isSupportedMarket(value: unknown): value is SupportedMarket {
  return (SUPPORTED_MARKETS as readonly unknown[]).includes(value);
}
