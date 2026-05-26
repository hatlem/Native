import { randomBytes } from "node:crypto";

// 24 bytes → ~32 url-safe base64 chars. Strong enough for a single-use
// time-limited link. Same shape as the PublisherInvite token so admins
// only have to learn one pattern.
const TOKEN_BYTES = 24;
export const DEFAULT_REQUEST_TTL_DAYS = 30;

export function newPriceRequestToken(): string {
  return randomBytes(TOKEN_BYTES)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function expiryFromNow(
  days: number = DEFAULT_REQUEST_TTL_DAYS,
  now: Date = new Date(),
): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export type RequestShape = {
  expiresAt: Date;
  respondedAt: Date | null;
  cancelledAt: Date | null;
};

export type RequestVerdict =
  | { ok: true }
  | { ok: false; reason: "expired" | "responded" | "cancelled" };

export function checkRequest(
  req: RequestShape | null | undefined,
  now: Date = new Date(),
): RequestVerdict | null {
  if (!req) return null;
  if (req.cancelledAt) return { ok: false, reason: "cancelled" };
  if (req.respondedAt) return { ok: false, reason: "responded" };
  if (req.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}

export function priceRequestLink(token: string, locale: string = "en"): string {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";
  return `${origin}/${locale}/price-request/${encodeURIComponent(token)}`;
}
