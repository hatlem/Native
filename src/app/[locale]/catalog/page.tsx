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
const NATIVE_FIT_VALUES = ["High", "Medium", "Low"] as const;
const B2B_B2C_VALUES = ["B2B", "B2C"] as const;
const PAGE_SIZE = 60;

function asEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
) {
  return value && (allowed as readonly string[]).includes(value)
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
  const nativeFit = asEnum(
    typeof sp.nativeFit === "string" ? sp.nativeFit : undefined,
    NATIVE_FIT_VALUES,
  );
  const b2bB2c = asEnum(
    typeof sp.b2bB2c === "string" ? sp.b2bB2c : undefined,
    B2B_B2C_VALUES,
  );
  const onlyPriced =
    typeof sp.onlyPriced === "string" && sp.onlyPriced === "1";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const pageRaw = typeof sp.page === "string" ? parseInt(sp.page, 10) : 1;
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  // FTS-first: ask Postgres for Title ids matching the query, then
  // intersect with the rest of the filter. Falls back to ILIKE if FTS
  // can't form a valid query (e.g. only punctuation).
  const matchedIds = await searchTitleIds(q);
  const where: Prisma.TitleWhereInput = {
    // Show commerce-active titles AND unverified research-catalog rows;
    // hide titles the desk has verified as not offering native.
    OR: [{ active: true }, { lastVerifiedAt: null }],
    ...(market ? { market: { code: market } } : {}),
    ...(type ? { products: { some: { type, active: true } } } : {}),
    ...(onlyPriced ? { active: true } : {}),
    ...(nativeFit ? { nativeFit } : {}),
    ...(b2bB2c ? { b2bB2c } : {}),
    ...(matchedIds
      ? { id: { in: matchedIds } }
      : q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { category: { contains: q, mode: "insensitive" } },
              { vertical: { contains: q, mode: "insensitive" } },
              { tags: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
  };

  const [totalCount, titles] = await Promise.all([
    prisma.title.count({ where }),
    prisma.title.findMany({
      where,
      include: {
        publisher: true,
        market: true,
        products: {
          where: { active: true },
          include: { priceRules: true },
        },
      },
      // Commerce-active titles surface first, then research catalog by name.
      orderBy: [{ active: "desc" }, { name: "asc" }],
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const pageQuery = (p: number) => {
    const params = new URLSearchParams();
    if (market) params.set("market", market);
    if (type) params.set("type", type);
    if (nativeFit) params.set("nativeFit", nativeFit);
    if (b2bB2c) params.set("b2bB2c", b2bB2c);
    if (onlyPriced) params.set("onlyPriced", "1");
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `?${s}` : "";
  };

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
          <label htmlFor="nativeFit">{t("filters.nativeFit")}</label>
          <select id="nativeFit" name="nativeFit" defaultValue={nativeFit ?? ""}>
            <option value="">{t("filters.all")}</option>
            {NATIVE_FIT_VALUES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="b2bB2c">{t("filters.b2bB2c")}</label>
          <select id="b2bB2c" name="b2bB2c" defaultValue={b2bB2c ?? ""}>
            <option value="">{t("filters.all")}</option>
            {B2B_B2C_VALUES.map((v) => (
              <option key={v} value={v}>
                {v}
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
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            whiteSpace: "nowrap",
          }}
        >
          <input
            type="checkbox"
            name="onlyPriced"
            value="1"
            defaultChecked={onlyPriced}
          />
          {t("filters.onlyPriced")}
        </label>
        <button type="submit">{t("filters.apply")}</button>
      </form>

      <p className="muted" style={{ marginTop: 12 }}>
        {t("resultCount", { count: totalCount })}
      </p>

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
            const currency = title.products[0]?.currency ?? title.market.currency;
            const needsQuote = title.products.length === 0;

            return (
              <article className="card" key={title.id}>
                <h3>
                  <Link href={`/catalog/${title.slug}`}>{title.name}</Link>
                </h3>
                <div className="muted">
                  {title.publisher.name} · {tMarket(title.market.code)}
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
                  {needsQuote ? (
                    <span className="tag">{t("card.requestQuote")}</span>
                  ) : null}
                  {title.nativeFit ? (
                    <span className="tag">
                      {t("card.nativeFit", { value: title.nativeFit })}
                    </span>
                  ) : null}
                  {title.b2bB2c ? (
                    <span className="tag">{title.b2bB2c}</span>
                  ) : null}
                </div>
                {title.vertical ? (
                  <div className="muted" style={{ marginTop: 8 }}>
                    {title.vertical}
                  </div>
                ) : null}
                {title.monthlyReach ? (
                  <div className="muted" style={{ marginTop: 10 }}>
                    {t("card.reach")}:{" "}
                    {new Intl.NumberFormat().format(title.monthlyReach)}
                  </div>
                ) : title.circulation ? (
                  <div className="muted" style={{ marginTop: 10 }}>
                    {t("card.circulation")}:{" "}
                    {new Intl.NumberFormat().format(title.circulation)}
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

      {totalPages > 1 ? (
        <nav
          className="pagination"
          style={{
            marginTop: 24,
            display: "flex",
            gap: 12,
            alignItems: "center",
          }}
        >
          {page > 1 ? (
            <a href={pageQuery(page - 1) || "?"}>← {t("pagination.prev")}</a>
          ) : (
            <span className="muted">← {t("pagination.prev")}</span>
          )}
          <span className="muted">
            {t("pagination.page", { page, total: totalPages })}
          </span>
          {page < totalPages ? (
            <a href={pageQuery(page + 1)}>{t("pagination.next")} →</a>
          ) : (
            <span className="muted">{t("pagination.next")} →</span>
          )}
        </nav>
      ) : null}

      <p className="note">{t("indicativeNote")}</p>
    </section>
  );
}
