import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MarketCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatMoney, intlLocale } from "@/lib/money";
import { bandIncludesArticle, plannablePrice, productBand } from "@/lib/pricing/display-price";
import { bandLabel } from "@/lib/pricing/bands";
import { loadPricingDefaults } from "@/lib/content-fee";
import { localizeVertical } from "@/lib/taxonomy-i18n";
import type { AppLocale } from "@/i18n/routing";
import { EmptyState } from "@/app/empty-state";
import { recommendMix, type Candidate } from "@/lib/recommend";
import { addRecommendedPlan } from "@/app/plan-actions";
import { LandingShell } from "@/app/landing-shell";
import { SubmitButton } from "@/components";
import { SUPPORTED_MARKETS, isSupportedMarket } from "@/lib/markets";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "recommend" });
  return {
    title: t("title"),
  };
}

const MARKET_CODES = SUPPORTED_MARKETS;

export default async function RecommendPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "recommend" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tMarket = await getTranslations({ locale, namespace: "market" });
  const tm = await getTranslations({ locale, namespace: "marketing" });
  const tv = await getTranslations({ locale, namespace: "priceVisibility" });

  const marketCode =
    typeof sp.market === "string" &&
    isSupportedMarket(sp.market)
      ? (sp.market as MarketCode)
      : undefined;
  const budget = Math.trunc(Number(sp.budget)) || 0;
  const category =
    typeof sp.category === "string" && sp.category ? sp.category : undefined;

  const candidates: Candidate[] = [];
  let currency = "EUR";
  let categories: string[] = [];
  // Public page: every price shown is a band (display-price.ts), never the
  // figure. The exact customer price is used only to fit the budget.
  const bandByProduct = new Map<string, string>();
  // Products whose band includes the article ("incl. article", display-price.ts).
  const articleIncluded = new Set<string>();

  if (marketCode) {
    const market = await prisma.market.findUnique({
      where: { code: marketCode },
      select: { currency: true },
    });
    currency = market?.currency ?? "EUR";

    const [products, defaults] = await Promise.all([
      prisma.product.findMany({
        where: {
          active: true,
          bookable: true,
          confirmedAt: { not: null },
          title: { active: true, market: { code: marketCode } },
        },
        include: {
          title: {
            include: {
              publisher: { select: { pricesPublic: true } },
              market: { select: { code: true } },
            },
          },
          priceRules: true,
        },
      }),
      loadPricingDefaults(),
    ]);

    for (const p of products) {
      // FLAT, price-visible products only: a CPM/CPC rate is not a
      // placement price and can't be fitted into a budget.
      const unitPrice = plannablePrice(p, p.title, defaults);
      const band = productBand(p, p.title, defaults);
      if (unitPrice === null || !band) continue;
      bandByProduct.set(p.id, bandLabel(band, p.currency));
      if (bandIncludesArticle(p, p.title, defaults)) articleIncluded.add(p.id);
      candidates.push({
        productId: p.id,
        titleId: p.titleId,
        titleName: p.title.name,
        // `vertical` is the catalog's audience vocabulary (the same one the
        // catalog and plan filters use). `category` is free text from the
        // source sheets, in whichever language each sheet was written.
        category: p.title.vertical ?? "",
        type: p.type,
        reach: p.title.digitalReach ?? p.title.monthlyReach ?? 0,
        unitPrice,
      });
    }
    categories = [...new Set(candidates.map((c) => c.category))]
      .filter((c) => c.length > 0)
      .sort((a, b) =>
        localizeVertical(a, locale as AppLocale).localeCompare(
          localizeVertical(b, locale as AppLocale),
          intlLocale(locale),
        ),
      );
  }

  const result =
    marketCode && budget > 0
      ? recommendMix(candidates, budget, { category })
      : null;

  return (
    <LandingShell locale={locale} screenLabel="Recommend">
      <header className="page-hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="lead">{t("subtitle")}</p>
        </div>
      </header>

      <section className="section">
        <div className="wrap">
          <form method="get" className="filters">
            <div>
              <label htmlFor="market">{t("market")}</label>
              <select id="market" name="market" defaultValue={marketCode ?? ""}>
                <option value="" disabled>
                  {t("marketPlaceholder")}
                </option>
                {MARKET_CODES.map((m) => (
                  <option key={m} value={m}>
                    {tMarket(m)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="budget">{t("budget")}</label>
              <input
                id="budget"
                name="budget"
                type="number"
                min="0"
                placeholder="100000"
                defaultValue={budget || ""}
              />
            </div>
            <div>
              <label htmlFor="category">{t("category")}</label>
              <select
                id="category"
                name="category"
                defaultValue={category ?? ""}
              >
                <option value="">{t("anyCategory")}</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {localizeVertical(cat, locale as AppLocale)}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit">{t("suggest")}</button>
          </form>

          {result ? (
            result.picks.length === 0 ? (
              <EmptyState
                title={t("none")}
                primaryHref="/signup"
                primaryLabel={tm("createAccount")}
              />
            ) : (
              <>
                <div className="kpi-grid">
                  <div className="kpi">
                    <div className="label">{t("reach")}</div>
                    <div className="value">
                      {result.totalReach.toLocaleString(intlLocale(locale))}
                    </div>
                    <div className="delta">{t("reachSub")}</div>
                  </div>
                  <div className="kpi">
                    <div className="label">{t("titles")}</div>
                    <div className="value">{result.picks.length}</div>
                    <div className="delta">
                      {t("fitsBudget", {
                        budget: formatMoney(budget, currency, locale),
                      })}
                    </div>
                  </div>
                </div>
                <p className="muted small">{t("bandNote")}</p>

                <div className="section-head">
                  <div>
                    <span className="eyebrow">{t("mixEyebrow")}</span>
                    <h2>{t("mixHeading")}</h2>
                  </div>
                  <form action={addRecommendedPlan}>
                    <input type="hidden" name="locale" value={locale} />
                    <input
                      type="hidden"
                      name="productIds"
                      value={result.picks.map((p) => p.productId).join(",")}
                    />
                    <SubmitButton
                      label={`${t("addAll")} →`}
                      pendingLabel={t("addingAll")}
                      className="btn primary"
                    />
                  </form>
                </div>

                <div className="grid">
                  {result.picks.map((p) => (
                    <article className="card" key={p.productId}>
                      <span className="tag">{tType(p.type)}</span>
                      <h3>{p.titleName}</h3>
                      {p.category ? (
                        <p className="muted small">
                          {localizeVertical(p.category, locale as AppLocale)}
                        </p>
                      ) : null}
                      <p className="muted small">
                        {t("reach")}:{" "}
                        {p.reach > 0
                          ? p.reach.toLocaleString(intlLocale(locale))
                          : t("reachUnknown")}
                      </p>
                      <div className="price">
                        ≈ {bandByProduct.get(p.productId)}
                        {articleIncluded.has(p.productId) ? (
                          <>
                            {" "}
                            <span className="muted small">{tv("productionIncluded")}</span>
                          </>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )
          ) : (
            <div className="empty">
              <div className="empty-icon">✦</div>
              <h3 className="empty-title">{t("hintTitle")}</h3>
              <p>{t("hint")}</p>
            </div>
          )}
        </div>
      </section>
    </LandingShell>
  );
}
