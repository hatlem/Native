// Market → default notification locale. Buyer-facing notifications
// (in-app rows and their emails) are written for the ORG, not for the
// desk user who happened to trigger them, so the language must come
// from the org's home market — not from whichever UI locale the desk
// associate was browsing in.
//
// This is a default, not a per-user preference: until users carry an
// explicit locale of their own, the legal-entity home market is the
// best signal we have for what an org's inbox reads.

import { MarketCode } from "@prisma/client";

export type BuyerLocale = "en" | "no" | "sv" | "da" | "fi" | "de";

const MARKET_LOCALE: Partial<Record<MarketCode, BuyerLocale>> = {
  [MarketCode.NO]: "no",
  [MarketCode.SE]: "sv",
  [MarketCode.DK]: "da",
  [MarketCode.FI]: "fi",
  [MarketCode.DE]: "de",
  [MarketCode.AT]: "de",
  [MarketCode.CH]: "de",
  [MarketCode.UK]: "en",
  [MarketCode.IE]: "en",
};

// Accepts a plain string (callers often hold a nullable enum they've
// already narrowed) and falls back to English for markets without a
// dedicated UI locale (NL/BE today) or any future enum addition —
// a wrong-language notification is worse than an English one.
export function marketDefaultLocale(marketCode: string): BuyerLocale {
  return MARKET_LOCALE[marketCode as MarketCode] ?? "en";
}
