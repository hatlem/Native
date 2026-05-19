import { getTranslations } from "next-intl/server";
import { MarketCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { indicativeFromRules, toRateRules, formatMoney } from "@/lib/money";
import { recommendMix, type Candidate } from "@/lib/recommend";
import { addRecommendedPlan } from "@/app/actions";

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
        title: { active: true, market: { code: marketCode } },
      },
      include: { title: true, priceRules: true },
    });

    candidates = products.map((p) => ({
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
    <section>
      <h1>{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>

      <form method="get" className="filters">
        <div>
          <label htmlFor="market">{t("market")}</label>
          <select id="market" name="market" defaultValue={marketCode ?? ""}>
            <option value="" disabled>
              —
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
          <p className="note">{t("none")}</p>
        ) : (
          <>
            <p className="note">
              {t("reach")}: {result.totalReach.toLocaleString(locale)} ·{" "}
              {t("cost")}: {formatMoney(result.totalCost, currency, locale)}{" "}
              · {t("remaining")}:{" "}
              {formatMoney(result.remaining, currency, locale)}
            </p>
            <div className="grid">
              {result.picks.map((p) => (
                <article className="card" key={p.productId}>
                  <h3>{p.titleName}</h3>
                  <div className="muted">{tType(p.type)}</div>
                  <div className="muted">
                    {t("reach")}: {p.reach.toLocaleString(locale)}
                  </div>
                  <div className="price">
                    {formatMoney(p.unitPrice, currency, locale)}
                  </div>
                </article>
              ))}
            </div>
            <form action={addRecommendedPlan} style={{ marginTop: 16 }}>
              <input type="hidden" name="locale" value={locale} />
              <input
                type="hidden"
                name="productIds"
                value={result.picks.map((p) => p.productId).join(",")}
              />
              <button type="submit" className="btn">
                {t("addAll")}
              </button>
            </form>
          </>
        )
      ) : (
        <p className="note">
          {t("hint")} <Link href="/catalog">{t("browse")}</Link>
        </p>
      )}
    </section>
  );
}
