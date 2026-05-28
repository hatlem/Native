import { randomBytes } from "node:crypto";

// 24 bytes → ~32 url-safe base64 chars. Strong enough for a single-use
// time-limited link. Mirrors src/lib/pricing/tokens.ts for the RateCardRequest shape.
const TOKEN_BYTES = 24;
export const DEFAULT_RATE_CARD_TTL_DAYS = 30;

export function newRateCardToken(): string {
  return randomBytes(TOKEN_BYTES)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function rateCardExpiryFromNow(
  days: number = DEFAULT_RATE_CARD_TTL_DAYS,
  now: Date = new Date(),
): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export type RateCardRequestShape = {
  expiresAt: Date;
  respondedAt: Date | null;
  cancelledAt: Date | null;
};

export type RateCardVerdict =
  | { ok: true }
  | { ok: false; reason: "expired" | "responded" | "cancelled" };

export function checkRateCardRequest(
  req: RateCardRequestShape | null | undefined,
  now: Date = new Date(),
): RateCardVerdict | null {
  if (!req) return null;
  if (req.cancelledAt) return { ok: false, reason: "cancelled" };
  if (req.respondedAt) return { ok: false, reason: "responded" };
  if (req.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}

export function rateCardLink(token: string, locale: string = "en"): string {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";
  return `${origin}/${locale}/rate-card/${encodeURIComponent(token)}`;
}

export function unsubscribeLink(token: string, locale: string = "en"): string {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";
  return `${origin}/${locale}/rate-card/${encodeURIComponent(token)}/unsubscribe`;
}
