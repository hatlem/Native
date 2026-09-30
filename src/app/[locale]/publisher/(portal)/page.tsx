import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { updateProduct, updateSpec } from "@/app/publisher-actions";
import { SubmitButton } from "@/components";
import { formatMoney } from "@/lib/money";
import { isInstantOrderable } from "@/lib/pricing/visibility";
import { MAX_LEAD_TIME_DAYS, parseLeadTimeSaveStatus } from "@/lib/publisher-rates";

export const dynamic = "force-dynamic";

export default async function PublisherDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  // Result of the last lead-time save (publisher-actions updateProduct),
  // shown on that product's card only.
  const leadTimeStatus = parseLeadTimeSaveStatus(sp.leadTime);
  const leadTimeProduct = typeof sp.product === "string" ? sp.product : null;
  const t = await getTranslations({ locale, namespace: "publisher" });
  const tn = await getTranslations({ locale, namespace: "nav" });
  const tType = await getTranslations({ locale, namespace: "productType" });

  const session = await auth();
  const me = await prisma.user.findUnique({
    where: { id: session!.user.id },
    select: { publisherId: true },
  });
  if (!me?.publisherId) redirect(`/${locale}/signin`);

  const publisher = await prisma.publisher.findUnique({
    where: { id: me.publisherId },
    include: {
      titles: {
        orderBy: { name: "asc" },
        include: {
          products: { orderBy: { type: "asc" }, include: { spec: true } },
        },
      },
    },
  });
  if (!publisher) redirect(`/${locale}/signin`);

  const titleIds = publisher.titles.map((title) => title.id);
  const productIds = publisher.titles.flatMap((title) =>
    title.products.map((p) => p.id),
  );
  // "Instant order" means what the buyer's checkout means by it: a bookable
  // product (the plan only takes those) that isInstantOrderable — FIRM, active,
  // confirmed, with prices public on the title and the publisher. Counting
  // the bookable flag alone told a publisher "3 available as instant order"
  // while two of the three were indicative, quote-only formats.
  const instantOrderable = (
    p: (typeof publisher.titles)[number]["products"][number],
    title: (typeof publisher.titles)[number],
  ) =>
    p.bookable &&
    isInstantOrderable(p, { pricesPublic: title.pricesPublic, publisher: { pricesPublic: publisher.pricesPublic } });
  const instantProducts = publisher.titles.reduce(
    (n, title) => n + title.products.filter((p) => instantOrderable(p, title)).length,
    0,
  );
  const [activeProducts, ordersCount, blockedCount] =
    await Promise.all([
      prisma.product.count({
        where: { titleId: { in: titleIds }, active: true },
      }),
      prisma.orderLine.count({
        where: {
          productId: { in: productIds },
          order: {
            status: { in: ["CONFIRMED", "IN_PRODUCTION", "SCHEDULED", "LIVE"] },
          },
        },
      }),
      prisma.availability.count({
        where: { productId: { in: productIds } },
      }),
    ]);

  const activeTitleCount = publisher.titles.filter((titie) => titie.active).length;

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("dashboardTitle")}</h1>
        <p className="lead">
          {t("dashboardLead", { publisher: publisher.name })}
        </p>
      </header>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">{t("kpiActiveTitles")}</div>
          <div className="value">{activeTitleCount}</div>
          <div className="delta">{t("kpiActiveTitlesSub")}</div>
        </div>
        <div className="kpi">
          <div className="label">{t("kpiActiveProducts")}</div>
          <div className="value">{activeProducts}</div>
          <div className="delta">
            {t("kpiBookable", { count: instantProducts })}
          </div>
        </div>
        <div className="kpi">
          <div className="label">{t("kpiIncomingOrders")}</div>
          <div className="value">{ordersCount}</div>
          {ordersCount > 0 ? (
            <Link href="/publisher/orders" className="cta">
              {t("openOrders")} →
            </Link>
          ) : (
            <div className="delta">{t("kpiNoOrders")}</div>
          )}
        </div>
        <div className="kpi">
          <div className="label">{t("kpiBlockedMonths")}</div>
          <div className="value">{blockedCount}</div>
          <Link href="/publisher/availability" className="cta">
            {t("manageAvailability")} →
          </Link>
        </div>
      </div>

      <section className="section">
        <div className="grid two">
          <Link href="/publisher/orders" className="card hoverable quick-link">
            <h3>{t("orders")}</h3>
            <p className="muted">{t("ordersBlurb")}</p>
            <span className="link">{tn("orders")} →</span>
          </Link>
          <Link
            href="/publisher/availability"
            className="card hoverable quick-link"
          >
            <h3>{t("availability")}</h3>
            <p className="muted">{t("availabilityBlurb")}</p>
            <span className="link">{t("manageAvailability")} →</span>
          </Link>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("titlesEyebrow")}</span>
            <h2>{t("titlesHeading")}</h2>
          </div>
          <span className="muted">
            {t("titlesCount", { count: publisher.titles.length })}
          </span>
        </div>

        {publisher.titles.length === 0 ? (
          <p className="muted">{t("noTitles")}</p>
        ) : (
          <div className="stack-5">
            {publisher.titles.map((title) => (
              <article key={title.id} className="title-block">
                <header className="title-block-head">
                  <div>
                    <h3>{title.name}</h3>
                    {title.category ? (
                      <p className="muted small">{title.category}</p>
                    ) : null}
                  </div>
                  <span
                    className={`badge ${
                      title.active ? "badge-success" : "badge-neutral"
                    }`}
                  >
                    {title.active ? t("statusActive") : t("statusInactive")}
                  </span>
                </header>
                {title.products.length === 0 ? (
                  <p className="muted">{t("noProducts")}</p>
                ) : (
                  <div className="grid two tight">
                    {title.products.map((p) => (
                      <article key={p.id} id={`product-${p.id}`} className="card product-card">
                        <header className="product-head">
                          <div>
                            <h4>{tType(p.type)}</h4>
                            <p className="muted small">
                              {/* Same rule as the KPI: a FIRM price that isn't
                                  confirmed or public yet is still ordered
                                  through a request. */}
                              {instantOrderable(p, title)
                                ? t("firm")
                                : p.visibility === "FIRM"
                                  ? t("firmNotInstant")
                                  : t("indicative")}
                              {` · ${p.bookable ? t("bookable") : t("notBookable")}`}
                            </p>
                          </div>
                          <span
                            className={`badge ${
                              p.active ? "badge-success" : "badge-neutral"
                            } dotless`}
                          >
                            {p.currency}
                          </span>
                        </header>

                        {/* Price and catalog status are read-only here:
                            prices change on the rates page (provenance +
                            desk notification), and visibility/bookable are
                            the desk's call. Lead time is the publisher's. */}
                        <dl className="product-facts">
                          <div>
                            <dt>{t("basePrice")}</dt>
                            <dd>
                              {formatMoney(Number(p.basePrice), p.currency, locale)}{" "}
                              <Link href="/publisher/rates" className="small">
                                {t("changePriceOnRates")}
                              </Link>
                            </dd>
                          </div>
                        </dl>
                        <form action={updateProduct} className="product-form">
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="productId" value={p.id} />
                          {leadTimeProduct === p.id && leadTimeStatus === "saved" ? (
                            <div className="banner-success" role="status">
                              <span>
                                ✓ {t("leadTimeSaved", { days: p.leadTimeDays ?? 0 })}
                              </span>
                            </div>
                          ) : leadTimeProduct === p.id && leadTimeStatus === "unchanged" ? (
                            <div className="banner-info" role="status">
                              <span>{t("leadTimeUnchanged", { days: p.leadTimeDays ?? 0 })}</span>
                            </div>
                          ) : null}
                          <div className="field">
                            <label htmlFor={`lt-${p.id}`}>
                              {t("leadTime")}
                            </label>
                            <input
                              id={`lt-${p.id}`}
                              name="leadTimeDays"
                              type="number"
                              min="1"
                              max={MAX_LEAD_TIME_DAYS}
                              required
                              defaultValue={p.leadTimeDays ?? ""}
                              aria-invalid={
                                leadTimeProduct === p.id && leadTimeStatus === "invalid"
                                  ? true
                                  : undefined
                              }
                              aria-describedby={
                                leadTimeProduct === p.id && leadTimeStatus === "invalid"
                                  ? `lt-err-${p.id}`
                                  : undefined
                              }
                            />
                            {leadTimeProduct === p.id && leadTimeStatus === "invalid" ? (
                              <span className="err" id={`lt-err-${p.id}`} role="alert">
                                {t("leadTimeInvalid", { max: MAX_LEAD_TIME_DAYS })}
                              </span>
                            ) : null}
                            <span className="hint">{t("catalogStatusNote")}</span>
                          </div>
                          <div className="actions">
                            <SubmitButton
                              label={t("save")}
                              pendingLabel={t("saving")}
                              className="btn small"
                            />
                          </div>
                        </form>

                        <details className="spec-details">
                          <summary>
                            {t("specTitle")}
                            <span className="muted small">
                              {p.spec
                                ? t("specHas")
                                : t("specMissing")}
                            </span>
                          </summary>
                          <form action={updateSpec} className="product-form">
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="productId" value={p.id} />
                            <div className="grid-2">
                              <div className="field">
                                <label htmlFor={`wn-${p.id}`}>{t("wordMin")}</label>
                                <input
                                  id={`wn-${p.id}`}
                                  name="wordCountMin"
                                  type="number"
                                  min="0"
                                  defaultValue={p.spec?.wordCountMin ?? ""}
                                />
                              </div>
                              <div className="field">
                                <label htmlFor={`wx-${p.id}`}>{t("wordMax")}</label>
                                <input
                                  id={`wx-${p.id}`}
                                  name="wordCountMax"
                                  type="number"
                                  min="0"
                                  defaultValue={p.spec?.wordCountMax ?? ""}
                                />
                              </div>
                              <div className="field">
                                <label htmlFor={`im-${p.id}`}>{t("imagesMin")}</label>
                                <input
                                  id={`im-${p.id}`}
                                  name="imagesMin"
                                  type="number"
                                  min="0"
                                  defaultValue={p.spec?.imagesMin ?? ""}
                                />
                              </div>
                              <div className="field">
                                <label htmlFor={`dl-${p.id}`}>
                                  {t("disclosure")}
                                </label>
                                <input
                                  id={`dl-${p.id}`}
                                  name="disclosureLabel"
                                  defaultValue={p.spec?.disclosureLabel ?? ""}
                                />
                              </div>
                            </div>
                            <div className="field">
                              <label htmlFor={`ff-${p.id}`}>{t("fileFormats")}</label>
                              <input
                                id={`ff-${p.id}`}
                                name="fileFormats"
                                defaultValue={p.spec?.fileFormats ?? ""}
                              />
                            </div>
                            <div className="field">
                              <label htmlFor={`rq-${p.id}`}>{t("requirements")}</label>
                              <input
                                id={`rq-${p.id}`}
                                name="requirements"
                                defaultValue={p.spec?.requirements ?? ""}
                              />
                            </div>
                            <div className="actions">
                              <SubmitButton
                                label={t("saveSpec")}
                                pendingLabel={t("saving")}
                                className="btn small"
                              />
                            </div>
                          </form>
                        </details>
                      </article>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
