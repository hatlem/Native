import { getTranslations } from "next-intl/server";
import { MarketCode, ProductType, Prisma } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getFavoritedTitleIds } from "@/lib/favorites";
import { searchTitleIds, searchWhereFor } from "@/lib/catalog-search";
import { catalogVisibleTitleWhere } from "@/lib/catalog-visibility";
import { savedListMembershipMap } from "@/lib/saved-list-membership";
import { loadScope } from "@/lib/scope";
import { readActiveListId, resolveActiveList } from "@/lib/lists";
import { estimateListTotals } from "@/lib/plan-total";
import { titleDisplayName } from "@/lib/title-display";
import { CatalogRail } from "./_components/CatalogRail";
import { CatalogSort } from "./_components/CatalogSort";
import { CatalogDensityToggle } from "./_components/CatalogDensityToggle";
import { ShortlistProvider } from "./_components/Shortlist";
import { CatalogMarketing } from "./_components/CatalogMarketing";
import { CatalogResults, type Density } from "./_components/CatalogResults";
import { CatalogPagination } from "./_components/CatalogPagination";
import { ActiveFilterChips } from "./_components/ActiveFilterChips";
import {
  MARKET_CODES,
  NATIVE_FIT_VALUES,
  B2B_B2C_VALUES,
  REACH_VALUES,
  PAGE_SIZE,
  parseCatalogParams,
} from "./filters";
import { audienceFor } from "@/lib/nav";
import { shouldShowBookingBanner } from "@/lib/booking-prompt";
import { CatalogBookCallBanner } from "./_components/CatalogBookCallBanner";

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
    sort,
    onlyPriced,
    publisher,
    producedForYou,
    guaranteedReach,
    newsletterIncluded,
    videoIncluded,
    compareMode,
    q,
    page,
  } = parseCatalogParams(sp);

  // FTS-first: ask Postgres for Title ids matching the query, then
  // intersect with the rest of the filter. Falls back to ILIKE if FTS
  // can't form a valid query (e.g. only punctuation).
  const matchedIds = await searchTitleIds(q);

  // "Priced titles only" = a buyer can actually see a € figure. Mirror
  // isProductPriceShown (src/lib/pricing/visibility.ts): an active,
  // sales-confirmed product AND both title + publisher prices public.
  // Kept separate from the other AND-composed conditions (rather than
  // pushed straight into one array) so the rail's "N more titles without
  // published pricing" note can build the exact same where, minus just
  // this condition, without fragile structural filtering after the fact.
  const onlyPricedConditions: Prisma.TitleWhereInput[] = [
    { products: { some: { active: true, confirmedAt: { not: null } } } },
    { pricesPublic: true },
    { publisher: { is: { pricesPublic: true } } },
  ];

  // Semantic-deliverable filters read curated Product.inclusions (Json).
  // Prisma JSON `path` filters on Postgres only match when the key exists
  // and the value compares — verified against the local atnative DB.
  const semanticConditions: Prisma.TitleWhereInput[] = [];
  if (producedForYou) {
    // Publisher's editorial desk writes the content for the advertiser.
    semanticConditions.push({
      products: {
        some: {
          active: true,
          inclusions: { path: ["production"], equals: "PUBLISHER" },
        },
      },
    });
  }
  if (guaranteedReach) {
    // Any committed reach number counts. `gt: 0` doubles as a key-existence
    // check: a missing path never satisfies a numeric comparison.
    semanticConditions.push({
      products: {
        some: {
          active: true,
          OR: [
            { inclusions: { path: ["viewsPerWeek"], gt: 0 } },
            { inclusions: { path: ["viewsPerMonth"], gt: 0 } },
            { inclusions: { path: ["viewsTotal"], gt: 0 } },
            { inclusions: { path: ["readsTotal"], gt: 0 } },
          ],
        },
      },
    });
  }
  if (newsletterIncluded) {
    semanticConditions.push({
      products: {
        some: { active: true, inclusions: { path: ["newsletter"], equals: true } },
      },
    });
  }
  if (videoIncluded) {
    semanticConditions.push({
      products: {
        some: { active: true, inclusions: { path: ["video"], equals: true } },
      },
    });
  }

  function buildWhere(includeOnlyPriced: boolean): Prisma.TitleWhereInput {
    return {
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
      ...(publisher ? { publisherId: publisher } : {}),
      ...(nativeFit ? { nativeFit } : {}),
      ...(b2bB2c ? { b2bB2c } : {}),
      ...(reach ? { reach } : {}),
      // AND-composed rather than spread: catalogVisibleTitleWhere and the
      // search fallback (buildIlikeFallbackWhere) can each independently
      // produce a top-level `OR` key. Spreading them into the same object
      // literal would let the later one silently clobber the earlier one
      // (object spread: last key wins) — dropping the visibility guard
      // whenever a search falls through to the ILIKE fallback. Combining
      // them as separate AND members keeps both `OR`s intact and composes
      // correctly with the type filter's own products.some above.
      AND: [
        // Show commerce-active titles AND unverified research-catalog rows;
        // hide titles the desk has verified as not offering native, and
        // never surface titles marked discontinued (nedlagt/duplikat).
        // Shared with favorites.ts/list-actions.ts so the guards can't
        // drift apart.
        catalogVisibleTitleWhere,
        // A non-empty FTS hit list wins outright; an empty-or-absent FTS
        // result (including a valid tsquery that simply matched nothing)
        // falls through to the synonym-aware ILIKE fallback instead of
        // pinning `id IN ()`.
        searchWhereFor(q, matchedIds),
        ...(includeOnlyPriced && onlyPriced ? onlyPricedConditions : []),
        ...semanticConditions,
      ],
    };
  }

  const where = buildWhere(true);

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

  // Resolve the publisher-filter chip label (name, not cuid). Invalid id
  // simply matches nothing — no error path needed.
  const publisherRow = publisher
    ? await prisma.publisher.findUnique({
        where: { id: publisher },
        select: { name: true },
      })
    : null;

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
      // Commerce-active titles surface first, always; the buyer's sort
      // choice only decides the tiebreak within that split. "reach" ranks
      // by digital reach first, monthly (print/legacy) reach as fallback
      // for titles with no digital figure — not a true coalesce, but Prisma
      // has no cross-column coalesce in orderBy, and digital is the primary
      // metric for native anyway. nulls: "last" on both is required —
      // Postgres defaults DESC to NULLS FIRST, which would rank reach-less
      // titles above titles with a real number. "newest" surfaces recently
      // touched rows.
      orderBy:
        sort === "reach"
          ? [
              { active: "desc" as const },
              { digitalReach: { sort: "desc" as const, nulls: "last" as const } },
              { monthlyReach: { sort: "desc" as const, nulls: "last" as const } },
              { name: "asc" as const },
            ]
          : sort === "newest"
            ? [{ active: "desc" as const }, { updatedAt: "desc" as const }]
            : [{ active: "desc" as const }, { name: "asc" as const }],
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Favorites: which of this page's titles the buyer has hearted (filled vs
  // empty heart). The "add to list" dropdown, however, is the buyer's real
  // SavedList set — the same lists /plan and /lists work from — not the
  // separate (and for most buyers empty) FavoriteList model. session.user is
  // guaranteed here — the marketing splash returns above for guests.
  const userId = session.user.id;
  const titleIds = titles.map((tt) => tt.id);
  const scope = await loadScope();
  const orgId = scope.workspace?.activeOrgId ?? null;
  const [favoritedIds, savedLists, membershipRows, bookingUserRow] =
    await Promise.all([
      getFavoritedTitleIds(userId, titleIds),
      orgId
        ? prisma.savedList.findMany({
            where: { organizationId: orgId, archivedAt: null },
            orderBy: { updatedAt: "desc" },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      orgId && titleIds.length
        ? prisma.savedListItem.findMany({
            where: {
              list: { organizationId: orgId, archivedAt: null },
              OR: [
                { titleId: { in: titleIds } },
                { product: { titleId: { in: titleIds } } },
              ],
            },
            select: {
              listId: true,
              titleId: true,
              product: { select: { titleId: true } },
            },
          })
        : Promise.resolve([]),
      prisma.user.findUnique({
        where: { id: userId },
        select: { bookingPromptDismissedAt: true },
      }),
    ]);
  const favoriteLists = savedLists;
  // An agency session with no client selected has no org to scope lists to —
  // show a "choose a client first" hint instead of the misleading "no lists".
  const noOrg = !orgId;
  const membershipMap = savedListMembershipMap(membershipRows);
  const listMembership: Record<string, string[]> = Object.fromEntries(membershipMap);
  const dismissedAt = bookingUserRow?.bookingPromptDismissedAt ?? null;
  const showBookingBanner = shouldShowBookingBanner({
    audience: audienceFor(session),
    dismissedAt,
  });

  // Sticky shortlist bar's starting state: the active list's current
  // product ids + total, so the bar (and each row's "on plan" state)
  // reflects what's really on the plan before any optimistic click.
  const activeList = orgId ? await resolveActiveList(orgId, await readActiveListId()) : null;
  const shortlistProductIds = (activeList?.items ?? [])
    .map((i) => i.productId)
    .filter((id): id is string => id !== null);
  const shortlistTotals = activeList ? estimateListTotals(activeList.items) : [];
  const planName = activeList?.name ?? t("shortlist.untitledPlan");

  // "42 more titles without published pricing" — only meaningful once
  // onlyPriced is actually narrowing the list; same query with that one
  // condition dropped tells us how many.
  let unpricedCount: number | null = null;
  if (onlyPriced) {
    const broaderCount = await prisma.title.count({ where: buildWhere(false) });
    unpricedCount = Math.max(0, broaderCount - totalCount);
  }

  const density: Density = sp.density === "cards" ? "cards" : "list";
  // A single selected market earns a mention in the H1 ("… run native in
  // Norway"); multiple markets or none fall back to the market-less count.
  const marketLabel = markets.length === 1 ? tMarket(markets[0]) : null;

  const pageQuery = (p: number) => {
    const params = new URLSearchParams();
    if (markets.length) params.set("market", markets.join(","));
    if (types.length) params.set("types", types.join(","));
    if (verticals.length) params.set("vertical", verticals.join(","));
    // region/reach were parsed but never threaded through pageQuery —
    // paginating (or removing an unrelated filter chip) silently dropped
    // them. Same bug, same fix, for both.
    if (regions.length) params.set("region", regions.join(","));
    if (nativeFit) params.set("nativeFit", nativeFit);
    if (b2bB2c) params.set("b2bB2c", b2bB2c);
    if (reach) params.set("reach", reach);
    if (sort) params.set("sort", sort);
    if (onlyPriced) params.set("onlyPriced", "1");
    if (publisher) params.set("publisher", publisher);
    if (producedForYou) params.set("producedForYou", "1");
    if (guaranteedReach) params.set("guaranteedReach", "1");
    if (newsletterIncluded) params.set("newsletterIncluded", "1");
    if (videoIncluded) params.set("videoIncluded", "1");
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
    | "publisher"
    | "producedForYou"
    | "guaranteedReach"
    | "newsletterIncluded"
    | "videoIncluded"
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
    if (publisher && except !== "publisher") params.set("publisher", publisher);
    if (producedForYou && except !== "producedForYou")
      params.set("producedForYou", "1");
    if (guaranteedReach && except !== "guaranteedReach")
      params.set("guaranteedReach", "1");
    if (newsletterIncluded && except !== "newsletterIncluded")
      params.set("newsletterIncluded", "1");
    if (videoIncluded && except !== "videoIncluded")
      params.set("videoIncluded", "1");
    // No removable chip exists for these (yet), so — same as compareMode
    // just above — they're never the `except` target: always keep them.
    if (regions.length) params.set("region", regions.join(","));
    if (reach) params.set("reach", reach);
    if (sort) params.set("sort", sort);
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
  if (publisher)
    activeFilters.push({
      key: "publisher",
      label: `${t("filters.publisher")}: ${publisherRow?.name ?? publisher}`,
      href: filterHref("publisher"),
    });
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
  if (producedForYou)
    activeFilters.push({
      key: "producedForYou",
      label: t("filters.producedForYou"),
      href: filterHref("producedForYou"),
    });
  if (guaranteedReach)
    activeFilters.push({
      key: "guaranteedReach",
      label: t("filters.guaranteedReach"),
      href: filterHref("guaranteedReach"),
    });
  if (newsletterIncluded)
    activeFilters.push({
      key: "newsletterIncluded",
      label: t("filters.newsletterIncluded"),
      href: filterHref("newsletterIncluded"),
    });
  if (videoIncluded)
    activeFilters.push({
      key: "videoIncluded",
      label: t("filters.videoIncluded"),
      href: filterHref("videoIncluded"),
    });
  if (q)
    activeFilters.push({
      key: "q",
      label: `${t("filters.search")}: ${q}`,
      href: filterHref("q"),
    });

  // First-run nudge: a buyer who hasn't started a list yet, landing on a
  // clean catalog (no search/filter), gets a 3-step "what to do next" guide.
  // Returning/active buyers (any saved list, or any active query) don't see it.
  const showStartGuide =
    favoriteLists.length === 0 && !q && page === 1 && activeFilters.length === 0;

  return (
    <ShortlistProvider
      locale={locale}
      planName={planName}
      initialCount={shortlistProductIds.length}
      initialProductIds={shortlistProductIds}
      initialTotals={shortlistTotals}
    >
      <section className="catalog-page">
        {showBookingBanner ? <CatalogBookCallBanner /> : null}

        <div className="catalog-layout">
          <CatalogRail
            markets={MARKET_CODES.map((m) => ({ value: m, label: tMarket(m) }))}
            nativeFits={NATIVE_FIT_VALUES.map((v) => ({ value: v, label: tFit(v) }))}
            b2bB2cs={B2B_B2C_VALUES.map((v) => ({ value: v, label: v }))}
            reaches={REACH_VALUES.map((v) => ({ value: v, label: tReach(v) }))}
            categories={verticalOptions.map((v) => ({ value: v, label: v }))}
            regions={regionOptions.map((v) => ({ value: v, label: v }))}
            unpricedCount={unpricedCount}
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
              producedForYou,
              guaranteedReach,
              newsletterIncluded,
              videoIncluded,
              compareMode,
            }}
          />

          <div className="catalog-results-col">
            {showStartGuide ? (
              <div className="catalog-start" role="note">
                <strong>{t("startHeading")}</strong>
                <ol>
                  <li>{t("startS1")}</li>
                  <li>{t("startS2")}</li>
                  <li>{t("startS3")}</li>
                </ol>
              </div>
            ) : null}

            <div className="catalog-results-head">
              <div>
                <h1>
                  {marketLabel
                    ? t("resultsHeadingInMarket", { count: totalCount, market: marketLabel })
                    : t("resultsHeading", { count: totalCount })}
                </h1>
                <p className="catalog-results-sub">{t("resultsSubline")}</p>
              </div>
              <div className="catalog-results-controls">
                <CatalogSort initial={sort ?? ""} />
                <CatalogDensityToggle initial={density} />
              </div>
            </div>

            <ActiveFilterChips locale={locale} filters={activeFilters} />

            <CatalogResults
              locale={locale}
              titles={titles}
              density={density}
              compareMode={compareMode}
              favoritedIds={favoritedIds}
              favoriteLists={favoriteLists}
              listMembership={listMembership}
              noOrg={noOrg}
            />

            <CatalogPagination
              locale={locale}
              page={page}
              totalPages={totalPages}
              pageQuery={pageQuery}
            />

            <div className="catalog-prompt">
              <div>
                <strong>{t("notSureHeading")}</strong>
                <p>{t("notSureBody")}</p>
              </div>
              <Link href="/recommend" className="btn secondary">
                {t("notSureCta")}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </ShortlistProvider>
  );
}
