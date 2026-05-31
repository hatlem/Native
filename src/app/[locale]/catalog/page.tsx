import { getTranslations } from "next-intl/server";
import { MarketCode, ProductType, Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { indicativeFromRules, toRateRules, formatMoney, intlLocale } from "@/lib/money";
import { isProductPriceShown } from "@/lib/pricing-visibility";
import { EmptyState } from "@/app/empty-state";
import { LandingShell } from "@/app/landing-shell";
import { searchTitleIds } from "@/lib/catalog-search";
import { CatalogFilters } from "./_components/CatalogFilters";
import {
  CompareSelectionProvider,
  TitleSelector,
} from "./_components/CompareSelection";

export const dynamic = "force-dynamic";

const MARKET_CODES = Object.values(MarketCode);
const PRODUCT_TYPES = Object.values(ProductType);
// Catalog format filter highlights the buyable formats — research-only enum
// members (CONTEXTUAL, OTHER) intentionally don't show in the filter.
const FORMAT_KEYS: ProductType[] = [
  ProductType.NATIVE_ARTICLE,
  ProductType.ADVERTORIAL,
  ProductType.NATIVE_DISPLAY,
  ProductType.PACKAGE,
  ProductType.NATIVE_PLUS,
  ProductType.CONTENT_VIDEO,
];
const NATIVE_FIT_VALUES = ["High", "Medium", "Low"] as const;
const B2B_B2C_VALUES = ["B2B", "B2C"] as const;
const REACH_VALUES = ["National", "Regional", "Local", "Niche"] as const;
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
  const session = await auth();
  if (!session?.user) {
    return <CatalogMarketing locale={locale} />;
  }
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "catalog" });
  const tf = await getTranslations({ locale, namespace: "firm" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tMarket = await getTranslations({ locale, namespace: "market" });
  const tFit = await getTranslations({ locale, namespace: "nativeFit" });
  const tReach = await getTranslations({ locale, namespace: "reachTier" });
  const tv = await getTranslations({
    locale,
    namespace: "priceVisibility",
  });

  // `market` is multi-select (CSV). A single value still works — same param
  // shape as `types`. This lets tri-Nordic buyers run one query across NO·SE·DK
  // instead of three.
  const marketsRaw =
    typeof sp.market === "string" ? sp.market : "";
  const markets: MarketCode[] = marketsRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is MarketCode =>
      (MARKET_CODES as readonly string[]).includes(s),
    );
  // Legacy single-`market` consumers downstream — keep the first as a
  // convenience for things that only need one (e.g. SEO / breadcrumb).
  const market = markets[0];
  // `types` is the new multi-select param (CSV). Fall back to the legacy
  // single `type` param so older shared links keep working.
  const typesRaw =
    typeof sp.types === "string"
      ? sp.types
      : typeof sp.type === "string"
        ? sp.type
        : "";
  const types: ProductType[] = typesRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is ProductType =>
      (PRODUCT_TYPES as readonly string[]).includes(s),
    );
  const verticalsRaw = typeof sp.vertical === "string" ? sp.vertical : "";
  const verticals = verticalsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const regionsRaw = typeof sp.region === "string" ? sp.region : "";
  const regions = regionsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const nativeFit = asEnum(
    typeof sp.nativeFit === "string" ? sp.nativeFit : undefined,
    NATIVE_FIT_VALUES,
  );
  const b2bB2c = asEnum(
    typeof sp.b2bB2c === "string" ? sp.b2bB2c : undefined,
    B2B_B2C_VALUES,
  );
  const reach = asEnum(
    typeof sp.reach === "string" ? sp.reach : undefined,
    REACH_VALUES,
  );
  const onlyPriced =
    typeof sp.onlyPriced === "string" && sp.onlyPriced === "1";
  const compareMode =
    typeof sp.compareMode === "string" && sp.compareMode === "1";
  // Advanced section auto-opens only for the compare picker now — B2B/B2C
  // moved to the main filter row, so it no longer drives this.
  const advancedOpen = compareMode;
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
    ...(markets.length
      ? markets.length === 1
        ? { market: { code: markets[0] } }
        : { market: { code: { in: markets } } }
      : {}),
    ...(types.length
      ? { products: { some: { type: { in: types }, active: true } } }
      : {}),
    ...(verticals.length ? { vertical: { in: verticals } } : {}),
    ...(regions.length ? { region: { in: regions } } : {}),
    // "Priced titles only" = a buyer can actually see a € figure. Mirror
    // isProductPriceShown (src/lib/pricing/visibility.ts): an active,
    // sales-confirmed product AND both title + publisher prices public.
    // AND-wrapped so it composes with the type filter's own products.some.
    ...(onlyPriced
      ? {
          AND: [
            { products: { some: { active: true, confirmedAt: { not: null } } } },
            { pricesPublic: true },
            { publisher: { is: { pricesPublic: true } } },
          ],
        }
      : {}),
    ...(nativeFit ? { nativeFit } : {}),
    ...(b2bB2c ? { b2bB2c } : {}),
    ...(reach ? { reach } : {}),
    ...(matchedIds
      ? { id: { in: matchedIds } }
      : q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { category: { contains: q, mode: "insensitive" } },
              { vertical: { contains: q, mode: "insensitive" } },
              { tags: { contains: q, mode: "insensitive" } },
              { city: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
  };

  const verticalRows = await prisma.title.findMany({
    where: { active: true, vertical: { not: null } },
    select: { vertical: true },
    distinct: ["vertical"],
    orderBy: { vertical: "asc" },
  });
  const verticalOptions = verticalRows
    .map((r) => r.vertical!)
    .filter((v) => v.trim().length > 0);

  // Distinct regions present from the geo backfill — drives the region
  // multiselect. Null regions (national/unknown titles) don't appear.
  const regionRows = await prisma.title.findMany({
    where: { region: { not: null } },
    select: { region: true },
    distinct: ["region"],
    orderBy: { region: "asc" },
  });
  const regionOptions = regionRows
    .map((r) => r.region!)
    .filter((v) => v.trim().length > 0);

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
    if (markets.length) params.set("market", markets.join(","));
    if (types.length) params.set("types", types.join(","));
    if (verticals.length) params.set("vertical", verticals.join(","));
    if (nativeFit) params.set("nativeFit", nativeFit);
    if (b2bB2c) params.set("b2bB2c", b2bB2c);
    if (onlyPriced) params.set("onlyPriced", "1");
    if (compareMode) params.set("compareMode", "1");
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `?${s}` : "";
  };

  // Build "remove this one filter" hrefs. When the user clicks an active-
  // filter chip we want to keep every other filter intact and just drop
  // the one they clicked — page is reset to 1 because the result set
  // changes.
  type FilterKey =
    | "market"
    | "types"
    | "vertical"
    | "nativeFit"
    | "b2bB2c"
    | "onlyPriced"
    | "q";
  const filterHref = (
    except: FilterKey,
    extra?: { dropType?: ProductType; dropMarket?: MarketCode; dropVertical?: string },
  ) => {
    const params = new URLSearchParams();
    if (except !== "market") {
      const keep = extra?.dropMarket
        ? markets.filter((m) => m !== extra.dropMarket)
        : markets;
      if (keep.length) params.set("market", keep.join(","));
    }
    if (except !== "types") {
      const keep = extra?.dropType
        ? types.filter((t) => t !== extra.dropType)
        : types;
      if (keep.length) params.set("types", keep.join(","));
    }
    if (except !== "vertical") {
      const keep = extra?.dropVertical
        ? verticals.filter((v) => v !== extra.dropVertical)
        : verticals;
      if (keep.length) params.set("vertical", keep.join(","));
    }
    if (nativeFit && except !== "nativeFit") params.set("nativeFit", nativeFit);
    if (b2bB2c && except !== "b2bB2c") params.set("b2bB2c", b2bB2c);
    if (onlyPriced && except !== "onlyPriced") params.set("onlyPriced", "1");
    if (compareMode) params.set("compareMode", "1");
    if (q && except !== "q") params.set("q", q);
    const s = params.toString();
    return s ? `/catalog?${s}` : "/catalog";
  };

  const activeFilters: Array<{ key: string; label: string; href: string }> =
    [];
  for (const m of markets) {
    activeFilters.push({
      key: `market-${m}`,
      label: `${t("filters.market")}: ${tMarket(m)}`,
      href: filterHref("market", { dropMarket: m }),
    });
  }
  for (const tp of types) {
    activeFilters.push({
      key: `type-${tp}`,
      label: `${t("filters.type")}: ${tType(tp)}`,
      href: filterHref("types", { dropType: tp }),
    });
  }
  for (const v of verticals) {
    activeFilters.push({
      key: `vertical-${v}`,
      label: `${t("filters.category")}: ${v}`,
      href: filterHref("vertical", { dropVertical: v }),
    });
  }
  if (nativeFit)
    activeFilters.push({
      key: "nativeFit",
      label: `${t("filters.nativeFit")}: ${tFit(nativeFit)}`,
      href: filterHref("nativeFit"),
    });
  if (b2bB2c)
    activeFilters.push({
      key: "b2bB2c",
      label: `${t("filters.b2bB2c")}: ${b2bB2c}`,
      href: filterHref("b2bB2c"),
    });
  if (onlyPriced)
    activeFilters.push({
      key: "onlyPriced",
      label: t("filters.onlyPriced"),
      href: filterHref("onlyPriced"),
    });
  if (q)
    activeFilters.push({
      key: "q",
      label: `${t("filters.search")}: ${q}`,
      href: filterHref("q"),
    });

  return (
    <section>
      <h1>{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>

      <CatalogFilters
        markets={MARKET_CODES.map((m) => ({ value: m, label: tMarket(m) }))}
        formats={PRODUCT_TYPES.map((pt) => ({ value: pt, label: tType(pt) }))}
        nativeFits={NATIVE_FIT_VALUES.map((v) => ({ value: v, label: tFit(v) }))}
        b2bB2cs={B2B_B2C_VALUES.map((v) => ({ value: v, label: v }))}
        reaches={REACH_VALUES.map((v) => ({ value: v, label: tReach(v) }))}
        categories={verticalOptions.map((v) => ({ value: v, label: v }))}
        regions={regionOptions.map((v) => ({ value: v, label: v }))}
        initial={{
          q,
          markets,
          types,
          verticals,
          regions,
          nativeFit: nativeFit ?? "",
          b2bB2c: b2bB2c ?? "",
          reach: reach ?? "",
          onlyPriced,
          advancedOpen,
          compareMode,
        }}
      />

      {activeFilters.length > 0 ? (
        <div className="filter-chips" style={{ marginTop: 12 }}>
          {activeFilters.map((f) => (
            <Link key={f.key} href={f.href} className="filter-chip">
              {f.label}
              <span className="x" aria-label={t("removeFilter")}>
                ×
              </span>
            </Link>
          ))}
          {activeFilters.length >= 2 ? (
            <Link href="/catalog" className="filter-chip">
              {t("clearFilters")}
            </Link>
          ) : null}
        </div>
      ) : null}

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
        <CompareSelectionProvider enabled={compareMode}>
        <div className="grid">
          {titles.map((title) => {
            // Per-product visibility: active + confirmedAt + pricesPublic flags
            const visibleProducts = title.products.filter((p) =>
              isProductPriceShown(p, title),
            );
            const anyHidden = title.products.some(
              (p) => !isProductPriceShown(p, title),
            );
            const prices = visibleProducts.map((p) =>
              indicativeFromRules(
                Number(p.basePrice),
                toRateRules(p.priceRules),
              ),
            );
            const from = prices.length ? Math.min(...prices) : null;
            const currency = title.products[0]?.currency ?? title.market.currency;
            const needsQuote = title.products.length === 0;

            return (
              <article className="card catalog-card" key={title.id}>
                <TitleSelector id={title.id} />
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
                  {visibleProducts.some((p) => p.visibility === "FIRM") ? (
                    <span className="tag">⚡ {tf("badge")}</span>
                  ) : null}
                  {needsQuote ? (
                    <span className="tag">{t("card.requestQuote")}</span>
                  ) : null}
                  {anyHidden ? (
                    <span className="tag">{tv("requestPrice")}</span>
                  ) : null}
                  {title.nativeFit ? (
                    <span className="tag">
                      {t("card.nativeFit", { value: tFit(title.nativeFit as "High" | "Medium" | "Low") })}
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
                {title.digitalReach ? (
                  <div className="muted" style={{ marginTop: 10 }}>
                    {t("card.digitalReach")}:{" "}
                    {new Intl.NumberFormat().format(title.digitalReach)}
                  </div>
                ) : title.monthlyReach ? (
                  <div className="muted" style={{ marginTop: 10 }}>
                    {t("card.reach")}:{" "}
                    {new Intl.NumberFormat().format(title.monthlyReach)}
                  </div>
                ) : null}
                {from !== null ? (
                  <div className="price">
                    {t("card.from")} {formatMoney(from, currency, locale)}
                  </div>
                ) : anyHidden ? (
                  <div className="price muted">{tv("requestPrice")}</div>
                ) : null}
              </article>
            );
          })}
        </div>
        </CompareSelectionProvider>
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

async function CatalogMarketing({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "catalog" });
  const ta = await getTranslations({ locale, namespace: "advertisers" });
  const tMarket = await getTranslations({ locale, namespace: "market" });
  const tType = await getTranslations({ locale, namespace: "productType" });

  const [titleCount, productCount, distinctMarkets, featured] =
    await Promise.all([
      prisma.title.count({ where: { active: true } }),
      prisma.product.count({ where: { active: true } }),
      prisma.title
        .findMany({
          where: { active: true },
          select: { market: { select: { code: true } } },
          distinct: ["marketId"],
        })
        .then((rows) => rows.length),
      prisma.title.findMany({
        where: { active: true },
        orderBy: [{ monthlyReach: "desc" }, { name: "asc" }],
        take: 6,
        include: {
          publisher: { select: { name: true } },
          market: { select: { code: true } },
        },
      }),
    ]);

  return (
    <LandingShell locale={locale} screenLabel="Catalog gate" withFooter={true}>
      <section className="hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("gate.eyebrow")}</span>
          <h1>{t("gate.title", { count: titleCount })}</h1>
          <p className="lead">{t("gate.lead")}</p>
          <div className="hero-actions">
            <Link href="/signup" className="btn large">
              {t("gate.ctaPrimary")}
            </Link>
            <Link href="/signin" className="btn secondary large">
              {t("gate.ctaSecondary")}
            </Link>
          </div>
          <div className="hero-stats">
            <div className="hero-stat">
              <div className="value">{titleCount.toLocaleString(intlLocale(locale))}</div>
              <div className="label">{t("gate.statsTitles")}</div>
            </div>
            <div className="hero-stat">
              <div className="value">{productCount.toLocaleString(intlLocale(locale))}</div>
              <div className="label">{t("gate.statsProducts")}</div>
            </div>
            <div className="hero-stat">
              <div className="value">{distinctMarkets}</div>
              <div className="label">{t("gate.statsMarkets")}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="eyebrow accent">{ta("formatsEyebrow")}</span>
              <h2>{ta("formatsTitle")}</h2>
            </div>
            <p className="lead" style={{ margin: 0, maxWidth: "44ch" }}>
              {ta("formatsLead")}
            </p>
          </div>
          <div className="grid">
            {FORMAT_KEYS.map((k) => (
              <article className="card" key={k}>
                <h3>{tType(k)}</h3>
                <p className="muted">{tType(`desc${k}`)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="eyebrow">{t("gate.teaserEyebrow")}</span>
              <h2>{t("gate.teaserTitle")}</h2>
            </div>
            <Link href="/signup" className="link">
              {t("gate.teaserCta")} →
            </Link>
          </div>
          <div className="grid">
            {featured.map((title) => (
              <article className="card title-card" key={title.id}>
                <span className="tag">{tMarket(title.market.code)}</span>
                <h3>{title.name}</h3>
                <p className="muted">{title.publisher.name}</p>
                {title.category ? (
                  <p className="muted small">{title.category}</p>
                ) : null}
                <p className="muted small" style={{ marginTop: 12 }}>
                  🔒 {t("gate.cardLocked")}
                </p>
              </article>
            ))}
          </div>
          <p className="note" style={{ marginTop: 24 }}>
            {t("gate.teaserFoot", { total: titleCount })}{" "}
            <Link href="/signup" className="link">
              {t("gate.teaserLink")} →
            </Link>
          </p>
        </div>
      </section>

      <section className="section cta-block">
        <div className="wrap">
          <h2>{t("gate.ctaBlockTitle")}</h2>
          <p className="muted">{t("gate.ctaBlockBody")}</p>
          <div className="hero-actions">
            <Link href="/signup" className="btn large">
              {t("gate.ctaPrimary")}
            </Link>
            <Link href="/signin" className="btn secondary large">
              {t("gate.ctaSecondary")}
            </Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
