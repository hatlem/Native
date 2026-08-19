import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { intlLocale, formatMoney } from "@/lib/money";
import { loadPublisherRateCard, MAX_BASE_PRICE } from "@/lib/publisher-rates";
import { confirmPrice, savePrice } from "@/app/publisher-rates-actions";
import { SubmitButton } from "@/components";

export const dynamic = "force-dynamic";

export default async function PublisherRatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "publisher" });
  const tType = await getTranslations({ locale, namespace: "productType" });

  const session = await auth();
  const me = await prisma.user.findUnique({
    where: { id: session!.user.id },
    select: { publisherId: true },
  });
  if (!me?.publisherId) redirect(`/${locale}/signin`);

  const titles = await loadPublisherRateCard(me.publisherId);

  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const unitLabel = (unit: "WEEK" | "MONTH") =>
    unit === "WEEK" ? t("ratesUnitWeek") : t("ratesUnitMonth");

  return (
    <>
      <nav className="breadcrumb">
        <Link href="/publisher" className="small-link">
          ← {t("title")}
        </Link>
      </nav>

      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("ratesTitle")}</h1>
        <p className="lead">{t("ratesLead")}</p>
      </header>

      {titles.length === 0 ? (
        <p className="muted">{t("noTitles")}</p>
      ) : (
        titles.map((title) => (
          <section className="section" key={title.id}>
            <div className="section-head">
              <div>
                <span className="eyebrow">{t("titlesEyebrow")}</span>
                <h2>{title.name}</h2>
              </div>
              <span
                className={`badge ${title.active ? "badge-success" : "badge-neutral"}`}
              >
                {title.active ? t("statusActive") : t("statusInactive")}
              </span>
            </div>

            {title.products.length === 0 ? (
              <p className="muted">{t("noProducts")}</p>
            ) : (
              <div className="table-wrap responsive">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t("ratesColProduct")}</th>
                      <th>{t("ratesColPrice")}</th>
                      <th>{t("ratesColUnit")}</th>
                      <th>{t("ratesColConfirmed")}</th>
                      <th className="actions-col">{t("ratesColUpdate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {title.products.map((p) => (
                      <tr key={p.id}>
                        <td data-label={t("ratesColProduct")}>
                          <strong>{p.name}</strong>
                          <div className="muted small">
                            {tType(p.type)}
                            {p.active ? "" : ` · ${t("ratesInactive")}`}
                          </div>
                        </td>
                        <td data-label={t("ratesColPrice")} className="num">
                          {formatMoney(p.basePrice, p.currency, locale)}
                        </td>
                        <td data-label={t("ratesColUnit")}>
                          {unitLabel(p.bookingUnit)}
                          {p.minDurationUnits ? (
                            <div className="muted small">
                              {t("ratesMinUnits", { count: p.minDurationUnits })}
                            </div>
                          ) : null}
                        </td>
                        <td data-label={t("ratesColConfirmed")}>
                          {p.confirmedAt ? (
                            t("ratesConfirmedOn", {
                              date: dateFmt.format(p.confirmedAt),
                            })
                          ) : (
                            <span className="muted">
                              {t("ratesNeverConfirmed")}
                            </span>
                          )}
                        </td>
                        <td data-label={t("ratesColUpdate")}>
                          <div className="rates-actions">
                            <form action={savePrice} className="rates-save">
                              <input type="hidden" name="locale" value={locale} />
                              <input type="hidden" name="productId" value={p.id} />
                              <label
                                className="sr-only"
                                htmlFor={`rate-${p.id}`}
                              >
                                {t("ratesColPrice")}
                              </label>
                              <input
                                id={`rate-${p.id}`}
                                name="basePrice"
                                type="number"
                                min="1"
                                max={MAX_BASE_PRICE}
                                step="any"
                                defaultValue={p.basePrice}
                                required
                              />
                              <SubmitButton
                                label={t("save")}
                                pendingLabel={t("saving")}
                                className="btn small"
                              />
                            </form>
                            <form action={confirmPrice}>
                              <input type="hidden" name="locale" value={locale} />
                              <input type="hidden" name="productId" value={p.id} />
                              <SubmitButton
                                label={t("ratesConfirm")}
                                pendingLabel={t("ratesConfirming")}
                                className="btn small ghost"
                              />
                            </form>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))
      )}

      <p className="muted small">{t("ratesPriceOnlyNote")}</p>
    </>
  );
}
