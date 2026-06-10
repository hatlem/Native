import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import {
  saveFlightWindow,
  saveBookingMetricOverride,
  resendMetricsRequest,
} from "@/app/desk-reporting-actions";
import { SubmitButton } from "@/components";
import { safeExternalUrl } from "@/lib/security";

// ---------------------------------------------------------------------------
// Prop types — mirrors the extended query added in page.tsx.
// ---------------------------------------------------------------------------

type BookingWithDetails = Prisma.PublisherBookingGetPayload<{
  include: {
    metrics: true;
    publisher: { select: { name: true } };
    title: { select: { name: true } };
  };
}>;

type LineWithBooking = Prisma.OrderLineGetPayload<{
  include: {
    brief: { include: { assets: { orderBy: { version: "desc" } } } };
    trackedLinks: true;
    booking: {
      include: {
        metrics: true;
        publisher: { select: { name: true } };
        title: { select: { name: true } };
      };
    };
  };
}>;

type OrderForCampaign = Prisma.OrderGetPayload<{
  include: {
    organization: true;
    quote: true;
    invoices: true;
    creditNotes: true;
    lines: {
      include: {
        brief: { include: { assets: { orderBy: { version: "desc" } } } };
        trackedLinks: true;
        booking: {
          include: {
            metrics: true;
            publisher: { select: { name: true } };
            title: { select: { name: true } };
          };
        };
      };
    };
    writerPool: {
      select: {
        writerId: true;
        writer: { select: { user: { select: { name: true; email: true } } } };
      };
    };
  };
}>;

type MetricsRequestRow = {
  id: string;
  publisherId: string;
  status: string;
  recipientEmail: string | null;
  sentCount: number;
  token: string;
};

type Props = {
  locale: string;
  order: OrderForCampaign;
  metricsRequests: MetricsRequestRow[];
  clicks: Record<string, number>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function toInputDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

function sourceLabel(source: string): string {
  switch (source) {
    case "PUBLISHER_FORM":
      return "form";
    case "PUBLISHER_EMAIL":
      return "email";
    case "DESK":
      return "desk";
    case "SYSTEM":
      return "system";
    default:
      return source.toLowerCase();
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "COMPLETE":
      return "badge badge-success";
    case "PARTIAL":
      return "badge badge-warning";
    case "NEEDS_CONTACT":
      return "badge badge-error";
    case "EXPIRED":
    case "CANCELLED":
      return "badge";
    default:
      return "badge badge-info";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export async function CampaignSection({ locale, order, metricsRequests, clicks }: Props) {
  const t = await getTranslations({ locale, namespace: "campaignReport" });

  // Group lines that have a booking by publisher name.
  const linesWithBooking: LineWithBooking[] = order.lines.filter(
    (l): l is LineWithBooking => l.booking != null,
  );

  // Build a map: publisherName → lines[]
  const byPublisher = new Map<string, LineWithBooking[]>();
  for (const line of linesWithBooking) {
    const name = line.booking!.publisher?.name ?? t("unknownPublisher");
    const arr = byPublisher.get(name) ?? [];
    arr.push(line);
    byPublisher.set(name, arr);
  }

  // Map publisherId → MetricsRequest row (at most one per publisher per order).
  const requestByPublisherId = new Map<string, MetricsRequestRow>(
    metricsRequests.map((r) => [r.publisherId, r]),
  );

  return (
    <section className="section">
      <div className="section-head">
        <div>
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h2>{t("title")}</h2>
          <p className="muted small">{t("subtitle")}</p>
        </div>
      </div>

      {/* Flight window */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ marginBottom: "0.75rem" }}>{t("flightWindow")}</h3>
        <form
          action={async (fd: FormData) => {
            "use server";
            await saveFlightWindow(order.id, fd);
          }}
          className="product-form"
        >
          <div className="grid two" style={{ gap: "1rem" }}>
            <div className="field">
              <label htmlFor={`flight-start-${order.id}`}>{t("flightStart")}</label>
              <input
                id={`flight-start-${order.id}`}
                type="date"
                name="flightStartDate"
                defaultValue={toInputDate(order.flightStartDate)}
              />
            </div>
            <div className="field">
              <label htmlFor={`flight-end-${order.id}`}>{t("flightEnd")}</label>
              <input
                id={`flight-end-${order.id}`}
                type="date"
                name="flightEndDate"
                defaultValue={toInputDate(order.flightEndDate)}
              />
            </div>
          </div>
          <div className="actions">
            <SubmitButton
              label={t("saveFlightWindow")}
              pendingLabel={t("saving")}
              className="btn small"
            />
          </div>
        </form>
      </div>

      {/* No bookings yet */}
      {linesWithBooking.length === 0 ? (
        <p className="muted small">{t("noBookings")}</p>
      ) : (
        <div className="stack-4">
          {[...byPublisher.entries()].map(([publisherName, lines]) => {
            const firstBooking = lines[0].booking as BookingWithDetails;
            const request = firstBooking.publisherId
              ? requestByPublisherId.get(firstBooking.publisherId)
              : undefined;

            return (
              <article className="card" key={publisherName}>
                <div className="line-head" style={{ marginBottom: "1rem" }}>
                  <div>
                    <h3>{publisherName}</h3>
                    {request ? (
                      <span className={statusBadgeClass(request.status)}>
                        {t("requestStatus")}: {request.status}
                      </span>
                    ) : (
                      <span className="badge">{t("noRequest")}</span>
                    )}
                  </div>
                  {request ? (
                    <form
                      action={async () => {
                        "use server";
                        await resendMetricsRequest(request.id);
                      }}
                    >
                      <button type="submit" className="btn small ghost">
                        {t("resend")}
                      </button>
                    </form>
                  ) : null}
                </div>

                {request?.recipientEmail ? (
                  <p className="muted small" style={{ marginBottom: "0.75rem" }}>
                    {t("recipient")}: {request.recipientEmail} · {t("sentCount", { count: request.sentCount })}
                  </p>
                ) : null}

                {/* Per-booking rows */}
                {lines.map((line) => {
                  const booking = line.booking as BookingWithDetails;
                  const m = booking.metrics;
                  const lineClicks = clicks[line.id] ?? 0;

                  return (
                    <div
                      key={booking.id}
                      className="card"
                      style={{ marginBottom: "0.75rem", background: "var(--surface-raised, #f9f9f9)" }}
                    >
                      {/* Booking header */}
                      <div className="line-head" style={{ marginBottom: "0.5rem" }}>
                        <h4 style={{ margin: 0 }}>
                          {booking.title?.name ?? line.id}
                        </h4>
                      </div>

                      {/* Live dates + URLs */}
                      <dl className="spec-grid" style={{ marginBottom: "0.75rem" }}>
                        <dt>{t("liveDates")}</dt>
                        <dd>
                          {fmtDate(booking.liveStartDate)} → {fmtDate(booking.liveEndDate)}
                        </dd>

                        <dt>{t("liveUrl")}</dt>
                        <dd>
                          {(() => {
                            const safeLiveUrl = safeExternalUrl(booking.liveUrl);
                            return safeLiveUrl ? (
                              <a
                                href={safeLiveUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="small-link"
                              >
                                {booking.liveUrl}
                              </a>
                            ) : (
                              "—"
                            );
                          })()}
                        </dd>

                        <dt>{t("publisherTrackingUrl")}</dt>
                        <dd>
                          {(() => {
                            const safeTracking = safeExternalUrl(booking.publisherTrackingUrl);
                            return safeTracking ? (
                              <a
                                href={safeTracking}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="small-link"
                              >
                                {booking.publisherTrackingUrl}
                              </a>
                            ) : (
                              "—"
                            );
                          })()}
                        </dd>

                        <dt>{t("ourClicks")}</dt>
                        <dd>{lineClicks}</dd>
                      </dl>

                      {/* Reported metrics */}
                      {m ? (
                        <div style={{ marginBottom: "0.75rem" }}>
                          <p className="small muted" style={{ marginBottom: "0.25rem" }}>
                            {t("reportedMetrics")}{" "}
                            <span className="badge dotless">{sourceLabel(m.source)}</span>
                            {m.frozenAt ? (
                              <span className="badge badge-success dotless" style={{ marginLeft: "0.25rem" }}>
                                {t("frozen")} {fmtDate(m.frozenAt)}
                              </span>
                            ) : null}
                          </p>
                          <dl className="spec-grid">
                            <dt>{t("impressions")}</dt>
                            <dd>{m.impressions ?? "—"}</dd>
                            <dt>{t("pageViews")}</dt>
                            <dd>{m.pageViews ?? "—"}</dd>
                            <dt>{t("publisherClicks")}</dt>
                            <dd>{m.publisherReportedClicks ?? "—"}</dd>
                            <dt>{t("avgTimeSec")}</dt>
                            <dd>{m.avgTimeSec != null ? `${m.avgTimeSec}s` : "—"}</dd>
                            <dt>{t("scrollDepthPct")}</dt>
                            <dd>{m.scrollDepthPct != null ? `${m.scrollDepthPct}%` : "—"}</dd>
                            {m.frozenAt ? (
                              <>
                                <dt>{t("impressionsAtClose")}</dt>
                                <dd>{m.impressionsAtClose ?? "—"}</dd>
                                <dt>{t("clicksAtClose")}</dt>
                                <dd>{m.clicksFirstPartyAtClose ?? "—"}</dd>
                              </>
                            ) : null}
                          </dl>
                        </div>
                      ) : (
                        <p className="muted small" style={{ marginBottom: "0.75rem" }}>
                          {t("noMetrics")}
                        </p>
                      )}

                      {/* Override form — desk can correct any metric */}
                      {!m?.frozenAt ? (
                        <details className="spec-details">
                          <summary>
                            {t("overrideLabel")}
                            <span className="muted small">{t("overrideHint")}</span>
                          </summary>
                          <form
                            action={async (fd: FormData) => {
                              "use server";
                              await saveBookingMetricOverride(booking.id, fd);
                            }}
                            className="product-form"
                          >
                            <div className="grid two" style={{ gap: "0.75rem" }}>
                              <div className="field">
                                <label htmlFor={`imp-${booking.id}`}>{t("impressions")}</label>
                                <input
                                  id={`imp-${booking.id}`}
                                  type="number"
                                  name="impressions"
                                  min="0"
                                  defaultValue={m?.impressions ?? ""}
                                  placeholder="0"
                                />
                              </div>
                              <div className="field">
                                <label htmlFor={`pv-${booking.id}`}>{t("pageViews")}</label>
                                <input
                                  id={`pv-${booking.id}`}
                                  type="number"
                                  name="pageViews"
                                  min="0"
                                  defaultValue={m?.pageViews ?? ""}
                                  placeholder="0"
                                />
                              </div>
                              <div className="field">
                                <label htmlFor={`clicks-${booking.id}`}>{t("publisherClicks")}</label>
                                <input
                                  id={`clicks-${booking.id}`}
                                  type="number"
                                  name="clicks"
                                  min="0"
                                  defaultValue={m?.publisherReportedClicks ?? ""}
                                  placeholder="0"
                                />
                              </div>
                              <div className="field">
                                <label htmlFor={`avgtime-${booking.id}`}>{t("avgTimeSec")}</label>
                                <input
                                  id={`avgtime-${booking.id}`}
                                  type="number"
                                  name="avgTimeSec"
                                  min="0"
                                  defaultValue={m?.avgTimeSec ?? ""}
                                  placeholder="0"
                                />
                              </div>
                              <div className="field">
                                <label htmlFor={`scroll-${booking.id}`}>{t("scrollDepthPct")}</label>
                                <input
                                  id={`scroll-${booking.id}`}
                                  type="number"
                                  name="scrollDepthPct"
                                  min="0"
                                  max="100"
                                  defaultValue={m?.scrollDepthPct ?? ""}
                                  placeholder="0"
                                />
                              </div>
                            </div>
                            <div className="actions">
                              <SubmitButton
                                label={t("saveOverride")}
                                pendingLabel={t("saving")}
                                className="btn small"
                              />
                            </div>
                          </form>
                        </details>
                      ) : (
                        <p className="muted small">{t("frozenNoEdit")}</p>
                      )}
                    </div>
                  );
                })}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
