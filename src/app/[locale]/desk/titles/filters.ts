import { MarketCode } from "@prisma/client";
import type { FreshnessBucket } from "@/lib/pricing/freshness";

export const MARKET_CODES = Object.values(MarketCode);
export const STATUS_VALUES = ["all", "unverified", "active", "no-native"] as const;
export type StatusFilter = (typeof STATUS_VALUES)[number];

export const FRESHNESS_VALUES = ["never", "stale", "aging", "fresh"] as const;

export function asFreshness(value: string | undefined): FreshnessBucket | undefined {
  return value && (FRESHNESS_VALUES as readonly string[]).includes(value)
    ? (value as FreshnessBucket)
    : undefined;
}

// Small fixed-domain CSV columns — perfect for dropdowns.
export const NATIVE_FIT_VALUES = ["High", "Medium", "Low"] as const;
export const FORMAT_VALUES = ["Print + Digital", "Digital", "Print"] as const;
export const B2B_B2C_VALUES = ["B2B", "B2C"] as const;
export const REACH_VALUES = ["National", "Regional", "Local", "International"] as const;
export const URL_STATUS_VALUES = ["VERIFIED", "LIKELY_OK", "UNVERIFIED"] as const;

export const PAGE_SIZE = 60;

export function asMarket(value: string | undefined): MarketCode | undefined {
  return value && (MARKET_CODES as string[]).includes(value)
    ? (value as MarketCode)
    : undefined;
}

export function asStatus(value: string | undefined): StatusFilter {
  return value && (STATUS_VALUES as readonly string[]).includes(value)
    ? (value as StatusFilter)
    : "all";
}

export function asEnumValue<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return value && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

export function str(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return typeof v === "string" ? v.trim() : "";
}
