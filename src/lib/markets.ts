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

// The civil time zone each market lives on. A buyer-facing date (a quote's
// "valid until") is a day on the buyer's calendar, so it starts and ends in
// their zone, whatever zone the server happens to run in.
export const MARKET_TIME_ZONES = {
  NO: "Europe/Oslo",
  SE: "Europe/Stockholm",
  DK: "Europe/Copenhagen",
  FI: "Europe/Helsinki",
  DE: "Europe/Berlin",
  AT: "Europe/Vienna",
  CH: "Europe/Zurich",
  UK: "Europe/London",
  IE: "Europe/Dublin",
} as const satisfies Record<SupportedMarket, string>;

// The desk's own zone: the fallback for an organisation that hasn't picked
// its billing market yet (that happens in onboarding).
export const HOUSE_TIME_ZONE = "Europe/Oslo";

export function marketTimeZone(marketCode: string | null | undefined): string {
  return isSupportedMarket(marketCode) ? MARKET_TIME_ZONES[marketCode] : HOUSE_TIME_ZONE;
}
