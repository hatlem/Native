import { getTranslations } from "next-intl/server";
import { MarketCode, ProductType, Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { searchTitleIds } from "@/lib/catalog-search";
import { CatalogFilters } from "./_components/CatalogFilters";
import { CatalogMarketing } from "./_components/CatalogMarketing";
import { CatalogResults } from "./_components/CatalogResults";
import { CatalogPagination } from "./_components/CatalogPagination";
import { ActiveFilterChips } from "./_components/ActiveFilterChips";
import {
  MARKET_CODES,
  PRODUCT_TYPES,
  NATIVE_FIT_VALUES,
  B2B_B2C_VALUES,
  REACH_VALUES,
  PAGE_SIZE,
  parseCatalogParams,
} from "./filters";

export const dynamic = "force-dynamic";

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
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tMarket = await getTranslations({ locale, namespace: "market" });
  const tFit = await getTranslations({ locale, namespace: "nativeFit" });
  const tReach = await getTranslations({ locale, namespace: "reachTier" });

  const {
    markets,
    types,
    verticals,
    regions,
    nativeFit,
    b2bB2c,
    reach,
    onlyPriced,
    compareMode,
    advancedOpen,
    q,
    page,
  } = parseCatalogParams(sp);

  // FTS-first: ask Postgres for Title ids matching the query, then
  // intersect with the rest of the filter. Falls back to ILIKE if FTS
  // can't form a valid query (e.g. only punctuation).
  const matchedIds = await searchTitleIds(q);
  const where: Prisma.TitleWhereInput = {
    // Show commerce-active titles AND unverified research-catalog rows;
    // hide titles the desk has verified as not offering native.
    OR: [{ active: true }, { lastVerifiedAt: null }],
    // Never surface titles marked discontinued (nedlagt/duplikat), even if
    // they're still unverified research rows.
    discontinuedAt: null,
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

      <ActiveFilterChips locale={locale} filters={activeFilters} />

      <p className="muted" style={{ marginTop: 12 }}>
        {t("resultCount", { count: totalCount })}
      </p>

      <CatalogResults locale={locale} titles={titles} compareMode={compareMode} />

      <CatalogPagination
        locale={locale}
        page={page}
        totalPages={totalPages}
        pageQuery={pageQuery}
      />

      <p className="note">{t("indicativeNote")}</p>
    </section>
  );
}
