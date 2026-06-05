"use client";

import { useTranslations } from "next-intl";
import { submitCampaignReportAction } from "../actions";
import { SubmitButton } from "@/components";

export type BookingRow = {
  bookingId: string;
  titleName: string;
  liveUrl: string | null;
  publisherTrackingUrl: string | null;
  metrics: {
    impressions: number | null;
    pageViews: number | null;
    publisherReportedClicks: number | null;
    avgTimeSec: number | null;
    scrollDepthPct: number | null;
  } | null;
};

export function MetricsForm({
  token,
  locale,
  bookings,
}: {
  token: string;
  locale: string;
  bookings: BookingRow[];
}) {
  const t = useTranslations("campaignReport");

  return (
    <form action={submitCampaignReportAction} className="mt-6 space-y-8">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      {bookings.map((b) => (
        <fieldset key={b.bookingId} className="border rounded-lg p-4">
          <legend className="px-1 font-medium">{b.titleName}</legend>
          {b.liveUrl ? (
            <a
              href={b.liveUrl}
              className="text-sm underline"
              target="_blank"
              rel="noreferrer"
            >
              {b.liveUrl}
            </a>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <NumberInput
              name={`m[${b.bookingId}].impressions`}
              label={t("impressions")}
              value={b.metrics?.impressions}
            />
            <NumberInput
              name={`m[${b.bookingId}].pageViews`}
              label={t("pageViews")}
              value={b.metrics?.pageViews}
            />
            <NumberInput
              name={`m[${b.bookingId}].clicks`}
              label={t("clicks")}
              value={b.metrics?.publisherReportedClicks}
            />
            <NumberInput
              name={`m[${b.bookingId}].avgTimeSec`}
              label={t("avgTimeSec")}
              value={b.metrics?.avgTimeSec}
            />
            <NumberInput
              name={`m[${b.bookingId}].scrollDepthPct`}
              label={t("scrollDepthPct")}
              value={b.metrics?.scrollDepthPct}
            />
          </div>
          <label className="mt-3 block text-sm">
            {t("publisherTrackingUrl")}
            <input
              name={`m[${b.bookingId}].publisherTrackingUrl`}
              defaultValue={b.publisherTrackingUrl ?? ""}
              className="mt-1 w-full border rounded px-2 py-1"
            />
          </label>
        </fieldset>
      ))}
      <SubmitButton label={t("submit")} pendingLabel={t("sending")} />
    </form>
  );
}

function NumberInput({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value: number | null | undefined;
}) {
  return (
    <label className="block text-sm">
      {label}
      <input
        name={name}
        inputMode="numeric"
        pattern="\d*"
        defaultValue={value ?? ""}
        className="mt-1 w-full border rounded px-2 py-1"
      />
    </label>
  );
}
