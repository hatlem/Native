import { getTranslations } from "next-intl/server";
import { MarketCode, ProductType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { indicativeFromRules, toRateRules, formatMoney } from "@/lib/money";
import { EmptyState } from "@/app/empty-state";
import { searchTitleIds } from "@/lib/catalog-search";

export const dynamic = "force-dynamic";

const MARKET_CODES = Object.values(MarketCode);
const PRODUCT_TYPES = Object.values(ProductType);

function asEnum<T extends string>(value: string | undefined, allowed: T[]) {
  return value && (allowed as string[]).includes(value)
    ? (value as T)
    : undefined;
}

export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "catalog" });
  const tf = await getTranslations({ locale, namespace: "firm" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tMarket = await getTranslations({ locale, namespace: "market" });

  const market = asEnum(
    typeof sp.market === "string" ? sp.market : undefined,
    MARKET_CODES,
  );
  const type = asEnum(
    typeof sp.type === "string" ? sp.type : undefined,
    PRODUCT_TYPES,
  );
  const q = typeof sp.q === "string" ? sp.q.trim() : "";

  // FTS-first: ask Postgres for Title ids matching the query, then
  // intersect with the rest of the filter. Falls back to ILIKE if FTS
  // can't form a valid query (e.g. only punctuation).
  const matchedIds = await searchTitleIds(q);
  const where: Prisma.TitleWhereInput = {
    active: true,
    ...(market ? { market: { code: market } } : {}),
    ...(type ? { products: { some: { type, active: true } } } : {}),
    ...(matchedIds
      ? { id: { in: matchedIds } }
      : q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { category: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
  };

  const titles = await prisma.title.findMany({
    where,
    include: {
      publisher: true,
      market: true,
      products: {
        where: { active: true },
        include: { priceRules: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <section>
      <h1>{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>

      <form className="filters" method="get">
        <div>
          <label htmlFor="market">{t("filters.market")}</label>
          <select id="market" name="market" defaultValue={market ?? ""}>
            <option value="">{t("filters.all")}</option>
            {MARKET_CODES.map((m) => (
              <option key={m} value={m}>
                {tMarket(m)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="type">{t("filters.type")}</label>
          <select id="type" name="type" defaultValue={type ?? ""}>
            <option value="">{t("filters.all")}</option>
            {PRODUCT_TYPES.map((pt) => (
              <option key={pt} value={pt}>
                {tType(pt)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="q">{t("filters.search")}</label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder={t("filters.searchPlaceholder")}
          />
        </div>
        <button type="submit">{t("filters.apply")}</button>
      </form>

      {titles.length === 0 ? (
        <EmptyState
          title={t("noResults")}
          primaryHref="/catalog"
          primaryLabel={t("clearFilters")}
        />
      ) : (
        <>
          {titles.length >= 2 ? (
            <p className="note" style={{ marginTop: 10 }}>
              <Link
                href={`/catalog/compare?ids=${titles
                  .slice(0, 6)
                  .map((t) => t.id)
                  .join(",")}`}
              >
                {t("compareTop")} →
              </Link>
            </p>
          ) : null}
        <div className="grid">
          {titles.map((title) => {
            const prices = title.products.map((p) =>
              indicativeFromRules(Number(p.basePrice), toRateRules(p.priceRules)),
            );
            const from = prices.length ? Math.min(...prices) : null;
            const currency =
              title.products[0]?.currency ?? title.market?.currency ?? "";

            return (
              <article className="card" key={title.id}>
                <h3>
                  <Link href={`/catalog/${title.slug}`}>{title.name}</Link>
                </h3>
                <div className="muted">
                  {title.publisher.name} · {tMarket(title.countryCode)}
                </div>
                <div>
                  <span className="tag">{title.category}</span>
                  {title.products.map((p) => (
                    <span className="tag" key={p.id}>
                      {tType(p.type)}
                    </span>
                  ))}
                  {title.products.some((p) => p.visibility === "FIRM") ? (
                    <span className="tag">⚡ {tf("badge")}</span>
                  ) : null}
                </div>
                {title.monthlyReach ? (
                  <div className="muted" style={{ marginTop: 10 }}>
                    {t("card.reach")}:{" "}
                    {new Intl.NumberFormat().format(title.monthlyReach)}
                  </div>
                ) : null}
                {from !== null ? (
                  <div className="price">
                    {t("card.from")} {formatMoney(from, currency, locale)}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
        </>
      )}

      <p className="note">{t("indicativeNote")}</p>
    </section>
  );
}
