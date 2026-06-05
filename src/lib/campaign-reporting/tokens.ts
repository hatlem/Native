import { randomBytes } from "node:crypto";

const TOKEN_BYTES = 24;
export const DEFAULT_METRICS_TTL_DAYS = 45;

export function newMetricsToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function metricsExpiryFromNow(days = DEFAULT_METRICS_TTL_DAYS, now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export type MetricsRequestShape = { expiresAt: Date; respondedAt: Date | null; cancelledAt: Date | null };
export type MetricsVerdict = { ok: true } | { ok: false; reason: "expired" | "responded" | "cancelled" };

export function checkMetricsRequest(req: MetricsRequestShape | null | undefined, now: Date = new Date()): MetricsVerdict | null {
  if (!req) return null;
  if (req.cancelledAt) return { ok: false, reason: "cancelled" };
  if (req.respondedAt) return { ok: false, reason: "responded" };
  if (req.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}

export function metricsReportLink(token: string, locale = "en"): string {
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";
  return `${origin}/${locale}/campaign-report/${encodeURIComponent(token)}`;
}
