import { getTranslations } from "next-intl/server";
import { findMetricsRequestByToken } from "@/lib/campaign-reporting/campaign";
import { checkMetricsRequest } from "@/lib/campaign-reporting/tokens";
import { MetricsForm } from "./_components/MetricsForm";

export const dynamic = "force-dynamic";

export default async function CampaignReportPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  const t = await getTranslations({ locale, namespace: "campaignReport" });

  const req = await findMetricsRequestByToken(token);
  if (!req) {
    return (
      <main className="p-8 max-w-prose mx-auto">
        <h1 className="text-xl font-semibold">{t("pageTitle")}</h1>
        <p className="mt-2">{t("statusNotFound")}</p>
      </main>
    );
  }

  const verdict = checkMetricsRequest({
    expiresAt: req.expiresAt,
    respondedAt: req.respondedAt,
    cancelledAt: req.cancelledAt,
  });

  if (!verdict || !verdict.ok) {
    const reason = verdict && !verdict.ok ? verdict.reason : "expired";
    const statusKey =
      reason === "responded"
        ? "statusResponded"
        : reason === "cancelled"
          ? "statusCancelled"
          : "statusExpired";
    return (
      <main className="p-8 max-w-prose mx-auto">
        <h1 className="text-xl font-semibold">{t("pageTitle")}</h1>
        <p className="mt-2">
          {t(statusKey as "statusExpired" | "statusResponded" | "statusCancelled")}
        </p>
      </main>
    );
  }

  const bookings = req.bookings.map((rb) => ({
    bookingId: rb.bookingId,
    titleName: rb.booking.title?.name ?? "—",
    liveUrl: rb.booking.liveUrl,
    publisherTrackingUrl: rb.booking.publisherTrackingUrl,
    metrics: rb.booking.metrics
      ? {
          impressions: rb.booking.metrics.impressions,
          pageViews: rb.booking.metrics.pageViews,
          publisherReportedClicks: rb.booking.metrics.publisherReportedClicks,
          avgTimeSec: rb.booking.metrics.avgTimeSec,
          scrollDepthPct: rb.booking.metrics.scrollDepthPct,
        }
      : null,
  }));

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
      <p className="mt-2 text-gray-600">
        {t("intro", { publisher: req.publisher.name })}
      </p>
      <MetricsForm token={token} locale={locale} bookings={bookings} />
    </main>
  );
}
