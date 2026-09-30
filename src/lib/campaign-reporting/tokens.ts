import { randomBytes } from "node:crypto";
import { appUrl } from "@/lib/url";

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

// Absolute link for the publisher's metrics email. Built from the app's
// canonical origin (appUrl: AUTH_URL → NEXTAUTH_URL → NEXT_PUBLIC_SITE_URL)
// like every other emailed link, so a deploy that only sets AUTH_URL no
// longer mails publishers a localhost link.
export function metricsReportLink(token: string, locale = "en"): string {
  const origin = appUrl().replace(/\/+$/, "");
  return `${origin}/${locale}/campaign-report/${encodeURIComponent(token)}`;
}
