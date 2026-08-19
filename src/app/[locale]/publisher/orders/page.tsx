import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { BookingStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { updateBooking, rejectAsset, submitBookingImpressions } from "@/app/publisher-actions";
import { StatusBadge } from "@/app/status-badge";
import { EmptyState } from "@/app/empty-state";
import { SubmitButton } from "@/components";

export const dynamic = "force-dynamic";

const BOOKING_STATUSES = Object.values(BookingStatus);

export default async function PublisherOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const vetoError = typeof sp.veto === "string" ? sp.veto : undefined;
  const t = await getTranslations({ locale, namespace: "publisher" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tp = await getTranslations({ locale, namespace: "production" });
  const tt = await getTranslations({ locale, namespace: "performance" });

  const session = await auth();
  const me = await prisma.user.findUnique({
    where: { id: session!.user.id },
    select: { publisherId: true },
  });
  if (!me?.publisherId) redirect(`/${locale}/signin`);

  const titles = await prisma.title.findMany({
    where: { publisherId: me.publisherId },
    include: { products: { select: { id: true, type: true, name: true } } },
  });
  const productMap = new Map(
    titles.flatMap((title) =>
      title.products.map((p) => [
        p.id,
        { titleName: title.name, type: p.type },
      ]),
    ),
  );
  const productIds = [...productMap.keys()];

  const lines = productIds.length
    ? await prisma.orderLine.findMany({
        where: { productId: { in: productIds } },
        orderBy: { id: "desc" },
        include: {
          order: true,
          booking: { include: { metrics: true } },
          articlePlacement: {
            select: {
              id: true,
              articleId: true,
              retractedAt: true,
              retractionNote: true,
              article: {
                select: {
                  versions: { orderBy: { version: "desc" }, take: 1 },
                  _count: { select: { placements: true } },
                },
              },
            },
          },
        },
      })
    : [];

  const inProductionCount = lines.filter(
    (l) => l.order.status === "IN_PRODUCTION",
  ).length;
  const liveCount = lines.filter((l) => l.order.status === "LIVE").length;
  const scheduledCount = lines.filter((l) => l.order.status === "SCHEDULED").length;

  return (
    <>
      <nav className="breadcrumb">
        <Link href="/publisher" className="small-link">
          ← {t("title")}
        </Link>
      </nav>

      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("ordersTitle")}</h1>
        <p className="lead">{t("ordersLead")}</p>
      </header>

      {lines.length > 0 ? (
        <div className="kpi-grid">
          <div className="kpi">
            <div className="label">{t("kpiInProduction")}</div>
            <div className="value">{inProductionCount}</div>
            <div className="delta">{t("kpiInProductionSub")}</div>
          </div>
          <div className="kpi">
            <div className="label">{t("kpiScheduled")}</div>
            <div className="value">{scheduledCount}</div>
            <div className="delta">{t("kpiScheduledSub")}</div>
          </div>
          <div className={`kpi ${liveCount > 0 ? "kpi-warn" : ""}`}>
            <div className="label">{t("kpiLive")}</div>
            <div className="value">{liveCount}</div>
            <div className="delta">{t("kpiLiveSub")}</div>
          </div>
        </div>
      ) : null}

      {vetoError ? (
        <div className="banner-error" role="alert">
          <strong>{tp("vetoError")}:</strong> {vetoError}
        </div>
      ) : null}

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("orderLinesEyebrow")}</span>
            <h2>{t("orderLinesHeading")}</h2>
          </div>
        </div>

        {lines.length === 0 ? (
          <EmptyState
            title={t("noOrders")}
            primaryHref="/publisher"
            primaryLabel={t("title")}
          />
        ) : (
          <div className="grid two">
            {lines.map((line) => {
              const meta = line.productId
                ? productMap.get(line.productId)
                : undefined;
              return (
                <article className="card booking-card" key={line.id}>
                  <div className="booking-head">
                    <div>
                      <h3>{meta?.titleName ?? line.productId}</h3>
                      <p className="muted small">
                        {meta ? tType(meta.type) : ""}
                      </p>
                    </div>
                    <StatusBadge value={line.order.status} />
                  </div>
                  {line.booking ? (
                    <form action={updateBooking} className="product-form">
                      <input type="hidden" name="locale" value={locale} />
                      <input
                        type="hidden"
                        name="bookingId"
                        value={line.booking.id}
                      />
                      <div className="field">
                        <label htmlFor={`bs-${line.id}`}>{t("booking")}</label>
                        <select
                          id={`bs-${line.id}`}
                          name="status"
                          defaultValue={line.booking.status}
                        >
                          {BOOKING_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={`lu-${line.id}`}>{t("liveUrl")}</label>
                        <input
                          id={`lu-${line.id}`}
                          name="liveUrl"
                          type="url"
                          placeholder="https://…"
                          defaultValue={line.booking.liveUrl ?? ""}
                        />
                      </div>
                      <div className="actions">
                        <SubmitButton
                          label={t("save")}
                          pendingLabel={t("saving")}
                          className="btn small"
                        />
                      </div>
                    </form>
                  ) : (
                    <p className="muted">{t("noBooking")}</p>
                  )}

                  {line.booking ? (
                    <form action={submitBookingImpressions} className="product-form">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="bookingId" value={line.booking.id} />
                      <div className="field">
                        <label htmlFor={`imp-${line.id}`}>{tt("impressionsLabel")}</label>
                        <input
                          id={`imp-${line.id}`}
                          name="impressions"
                          type="number"
                          min="0"
                          defaultValue={line.booking.metrics?.impressions ?? ""}
                        />
                      </div>
                      <div className="actions">
                        <SubmitButton
                          label={tt("impressionsSave")}
                          pendingLabel={t("saving")}
                          className="btn small ghost"
                        />
                      </div>
                    </form>
                  ) : null}

                  {/* Editorial-veto control — only renders if a draft
                      exists and is in a state the publisher is still
                      allowed to retract. Distinct from the desk-side
                      "request changes" soft path: this is a hard
                      rejection that flips ContentAsset → RETRACTED. */}
                  {line.articlePlacement?.article.versions[0] && !line.articlePlacement.retractedAt ? (
                    <details className="spec-details veto-block">
                      <summary>
                        <span className="btn small ghost">
                          {tp("vetoButton")}
                        </span>
                      </summary>
                      <form action={rejectAsset} className="product-form">
                        <input type="hidden" name="locale" value={locale} />
                        <input
                          type="hidden"
                          name="placementId"
                          value={line.articlePlacement.id}
                        />
                        <h4 style={{ margin: "12px 0 4px" }}>
                          {tp("vetoTitle")}
                        </h4>
                        <p className="muted small">{tp("vetoHint")}</p>
                        {(line.articlePlacement?.article._count.placements ?? 0) > 1 ? (
                          <p className="muted small">
                            {tp("vetoSharedWarning", { count: (line.articlePlacement!.article._count.placements - 1) })}
                          </p>
                        ) : null}
                        <div className="field">
                          <label htmlFor={`veto-${line.id}`}>
                            {tp("vetoReasonLabel")}
                          </label>
                          <textarea
                            id={`veto-${line.id}`}
                            name="reason"
                            rows={4}
                            required
                            placeholder={tp("vetoReasonPlaceholder")}
                          />
                        </div>
                        <div className="actions">
                          <SubmitButton
                            label={tp("vetoSubmit")}
                            pendingLabel={tp("vetoSubmitting")}
                            className="btn small"
                          />
                        </div>
                      </form>
                    </details>
                  ) : line.articlePlacement?.retractedAt ? (
                    <p className="muted small">
                      <strong>{tp("retractedLabel")}:</strong>{" "}
                      {line.articlePlacement.retractionNote ?? ""}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
