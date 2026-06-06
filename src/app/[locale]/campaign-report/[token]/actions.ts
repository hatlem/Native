"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  findMetricsRequestByToken,
  writeBookingMetric,
  recomputeRequestStatus,
} from "@/lib/campaign-reporting/campaign";
import { checkMetricsRequest } from "@/lib/campaign-reporting/tokens";
import { recordAudit } from "@/lib/audit";
import { rfqLimiter } from "@/lib/rate-limit";
import { safeExternalUrl } from "@/lib/security";

function num(fd: FormData, k: string): number | null {
  const v = fd.get(k);
  if (typeof v !== "string" || v.trim() === "") return null;
  return /^\d+$/.test(v.trim()) ? Number(v.trim()) : null;
}

function str(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown"
  );
}

export async function submitCampaignReportAction(formData: FormData) {
  const token = str(formData, "token");
  const locale = str(formData, "locale") || "en";

  const ip = await clientIp();
  const limited = await rfqLimiter.check(
    `metrics-submit:${ip}:${token.slice(0, 16)}`,
  );
  if (!limited.ok) redirect(`/${locale}/campaign-report/${token}?error=rate`);

  const req = await findMetricsRequestByToken(token);
  if (!req) redirect(`/${locale}/campaign-report/${token}`);

  const verdict = checkMetricsRequest({
    expiresAt: req.expiresAt,
    respondedAt: req.respondedAt,
    cancelledAt: req.cancelledAt,
  });
  if (!verdict?.ok) redirect(`/${locale}/campaign-report/${token}`);

  let wrote = 0;
  for (const rb of req.bookings) {
    const id = rb.bookingId;
    const fields = {
      impressions: num(formData, `m[${id}].impressions`),
      pageViews: num(formData, `m[${id}].pageViews`),
      publisherReportedClicks: num(formData, `m[${id}].clicks`),
      avgTimeSec: num(formData, `m[${id}].avgTimeSec`),
      scrollDepthPct: num(formData, `m[${id}].scrollDepthPct`),
    };
    const tracking = str(formData, `m[${id}].publisherTrackingUrl`);
    const safeTracking = safeExternalUrl(tracking);
    if (safeTracking) {
      await prisma.publisherBooking.update({
        where: { id },
        data: { publisherTrackingUrl: safeTracking },
      });
    }
    const hasAny = Object.values(fields).some((v) => v !== null);
    if (!hasAny && !safeTracking) continue;
    if (hasAny) {
      await writeBookingMetric({
        bookingId: id,
        source: "PUBLISHER_FORM",
        reportedBy: `metrics-form:${req.id}`,
        fields,
      });
      wrote++;
    }
  }

  await recomputeRequestStatus(req.id);
  await recordAudit(
    `metrics:${req.recipientEmail ?? req.id}`,
    "metrics.submit",
    `MetricsRequest:${req.id}`,
    { bookings: wrote, source: "FORM" },
  );

  redirect(`/${locale}/campaign-report/${token}/thanks`);
}
