import { getTranslations } from "next-intl/server";
import { MarketCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { indicativeFromRules, toRateRules, formatMoney, intlLocale } from "@/lib/money";
import { arePricesVisible } from "@/lib/pricing/visibility";
import { EmptyState } from "@/app/empty-state";
import { recommendMix, type Candidate } from "@/lib/recommend";
import { addRecommendedPlan } from "@/app/actions";
import { LandingShell } from "@/app/landing-shell";
import { SubmitButton } from "@/components";

export const dynamic = "force-dynamic";

const MARKET_CODES = Object.values(MarketCode);

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

  const marketCode =
    typeof sp.market === "string" &&
    (MARKET_CODES as string[]).includes(sp.market)
      ? (sp.market as MarketCode)
      : undefined;
  const budget = Math.trunc(Number(sp.budget)) || 0;
  const category =
    typeof sp.category === "string" && sp.category ? sp.category : undefined;

  let candidates: Candidate[] = [];
  let currency = "EUR";
  let categories: string[] = [];

  if (marketCode) {
    const market = await prisma.market.findUnique({
      where: { code: marketCode },
      select: { currency: true },
    });
    currency = market?.currency ?? "EUR";

    const products = await prisma.product.findMany({
      where: {
        active: true,
        bookable: true,
        confirmedAt: { not: null },
        title: { active: true, market: { code: marketCode } },
      },
      include: {
        title: { include: { publisher: { select: { pricesPublic: true } } } },
        priceRules: true,
      },
    });

    candidates = products
      .filter((p) => arePricesVisible(p.title))
      .map((p) => ({
        productId: p.id,
        titleId: p.titleId,
        titleName: p.title.name,
        category: p.title.category,
        type: p.type,
        reach: p.title.monthlyReach ?? 0,
        unitPrice: indicativeFromRules(
          Number(p.basePrice),
          toRateRules(p.priceRules),
        ),
      }));
    categories = [...new Set(candidates.map((c) => c.category))].sort();
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
                    {cat}
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
                    <div className="label">{t("cost")}</div>
                    <div className="value">
                      {formatMoney(result.totalCost, currency, locale)}
                    </div>
                    <div className="delta">
                      {t("ofBudget", {
                        budget: formatMoney(budget, currency, locale),
                      })}
                    </div>
                  </div>
                  <div className="kpi">
                    <div className="label">{t("remaining")}</div>
                    <div className="value">
                      {formatMoney(result.remaining, currency, locale)}
                    </div>
                    <div className="delta">{t("remainingSub")}</div>
                  </div>
                </div>

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
                      <p className="muted small">{p.category}</p>
                      <p className="muted small">
                        {t("reach")}: {p.reach.toLocaleString(intlLocale(locale))}
                      </p>
                      <div className="price">
                        {formatMoney(p.unitPrice, currency, locale)}
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
