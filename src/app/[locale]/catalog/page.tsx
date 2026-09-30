import { getTranslations } from "next-intl/server";
import { MarketCode, ProductType, Prisma } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getFavoritedTitleIds } from "@/lib/favorites";
import { resolveCatalogSearch } from "@/lib/catalog-search";
import { redirect } from "next/navigation";
import { catalogVisibleTitleWhere } from "@/lib/catalog-visibility";
import { savedListMembershipMap } from "@/lib/saved-list-membership";
import { loadScope } from "@/lib/scope";
import { loadRelevanceSignals } from "@/lib/catalog-relevance";
import { loadVerticalOptions, localizedVerticalOptions } from "@/lib/catalog-taxonomy";
import { localizeVertical } from "@/lib/taxonomy-i18n";
import { safeLocale } from "@/i18n/routing";
import { readActiveListId, resolveActiveList } from "@/lib/lists";
import { barTotals, planLineCount } from "@/lib/plan-total";
import { loadPricingDefaults } from "@/lib/content-fee";
import { titleDisplayName } from "@/lib/title-display";
import { CatalogRail } from "./_components/CatalogRail";
import { CatalogMobileBar } from "./_components/CatalogMobileBar";
import { CatalogSort } from "./_components/CatalogSort";
import { CatalogDensityToggle } from "./_components/CatalogDensityToggle";
import { ShortlistProvider } from "./_components/Shortlist";
import { CatalogMarketing } from "./_components/CatalogMarketing";
import { CatalogResults, type Density } from "./_components/CatalogResults";
import { CatalogPagination } from "./_components/CatalogPagination";
import { ActiveFilterChips } from "./_components/ActiveFilterChips";
import {
  MARKET_CODES,
  FORMAT_KEYS,
  NATIVE_FIT_VALUES,
  B2B_B2C_VALUES,
  REACH_VALUES,
  PAGE_SIZE,
  parseCatalogParams,
  catalogFilterParams,
} from "./filters";
import { buildCatalogWhere, catalogOrderBy } from "./catalog-where";
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

  const filters = parseCatalogParams(sp);
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
  } = filters;

  // FTS-first: titles matching every word of the query (FTS, then ILIKE),
  // widened to titles matching any word only when none match them all
  // (lib/catalog-search.ts resolveCatalogSearch).
  const search = await resolveCatalogSearch(q);

  // Shared with the CSV export so "download" holds exactly these titles.
  const where = buildCatalogWhere(filters, search);

  const scope = await loadScope();
  const orgId = scope.workspace?.activeOrgId ?? null;
  const activeList = orgId ? await resolveActiveList(orgId, await readActiveListId()) : null;

  // The buyable formats for the rail's format filter (?types=).
  const formatOptions = FORMAT_KEYS.map((k) => ({ value: k, label: tType(k) }));

  // Labels in the buyer's language; values stay the stored taxonomy terms.
  const verticalOptions = localizedVerticalOptions(await loadVerticalOptions(), locale);

  // Distinct regions present from the geo backfill — drives the region
  // multiselect. Null regions (national/unknown titles) don't appear.
  // Coverage is sparse and uneven (a handful of UK/Belgian sub-national
  // titles, one Norwegian one, etc.), so the raw region name alone reads
  // as an arbitrary grab-bag — pairing each with its country disambiguates
  // it. distinct(["region"]) + ordering by countryCode picks one country
  // deterministically per region even in the (currently nonexistent) case
  // of a region name shared across markets.
  const regionRows = await prisma.title.findMany({
    where: { region: { not: null } },
    select: { region: true, countryCode: true },
    distinct: ["region"],
    orderBy: [{ region: "asc" }, { countryCode: "asc" }],
  });
  const regionOptions = regionRows
    .filter((r) => r.region && r.region.trim().length > 0)
    .map((r) => ({ value: r.region!, country: r.countryCode as MarketCode }));

  // Resolve the publisher-filter chip label (name, not cuid). Invalid id
  // simply matches nothing — no error path needed.
  const publisherRow = publisher
    ? await prisma.publisher.findUnique({
        where: { id: publisher },
        select: { name: true },
      })
    : null;

  const titleInclude = {
    publisher: true,
    market: true,
    products: {
      where: { active: true },
      include: { priceRules: true },
    },
  } satisfies Prisma.TitleInclude;

  // Commerce-active titles surface first, always; the buyer's sort choice
  // only decides the tiebreak within that split (catalog-where.ts). The
  // personalization happens one level up, in which tier a title lands in,
  // not in this ordering.
  const orderBy = catalogOrderBy(sort);

  const skip = (page - 1) * PAGE_SIZE;

  // Within the personalized tier, lead with reach rather than the
  // alphabet — "relevant to you" should also mean "worth looking at,"
  // not just first in the dictionary. The non-personalized tier and every
  // explicit sort keep the plain `orderBy` above, untouched.
  const relevantOrderBy: Prisma.TitleOrderByWithRelationInput[] = [
    { active: "desc" },
    { digitalReach: { sort: "desc", nulls: "last" } },
    { monthlyReach: { sort: "desc", nulls: "last" } },
    { name: "asc" },
  ];

  // "Relevance" (no explicit sort) is personalized — but not just an echo
  // of what the org already saved. When the active plan has explicit
  // targeting (SavedList.targetVerticals — set from /plan), THAT wins
  // outright, so an org running several plans for different profiles gets
  // each one ranked for its own profile. Otherwise, signals blend the org's
  // billing market, its own favorited/planned verticals, AND what similar
  // buyers in the same market are actively favoriting/planning right now,
  // so browsing surfaces genuine discovery, not only a mirror of past
  // picks. Matching titles land in their own ordered tier ahead of
  // everything else. No signal (guest activity, brand-new org) falls
  // straight through to the plain query below, unchanged from before this
  // existed.
  const explicitVerticals = (activeList?.targetVerticals ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const relevance =
    sort === undefined && orgId
      ? await loadRelevanceSignals(orgId, explicitVerticals)
      : null;
  // Explicit per-plan targeting is a request to narrow, not broaden: OR-ing
  // in a country match here would let every same-market title back in
  // (a national tabloid has nothing to do with a trucking-only plan just
  // because both happen to be Swedish), diluting the one signal the buyer
  // actually set. Country only qualifies the tier in the implicit/blended
  // case, where the goal is a wide discovery net.
  const relevanceOr: Prisma.TitleWhereInput[] = [];
  if (explicitVerticals.length > 0) {
    if (relevance?.affinityVerticals.length) {
      relevanceOr.push({ vertical: { in: relevance.affinityVerticals } });
    }
  } else {
    if (relevance?.marketCode) relevanceOr.push({ countryCode: relevance.marketCode });
    if (relevance?.affinityVerticals.length) {
      relevanceOr.push({ vertical: { in: relevance.affinityVerticals } });
    }
  }

  let totalCount: number;
  let titles: Prisma.TitleGetPayload<{ include: typeof titleInclude }>[];

  if (relevanceOr.length > 0) {
    const whereRelevant: Prisma.TitleWhereInput = { AND: [where, { OR: relevanceOr }] };
    const whereRest: Prisma.TitleWhereInput = { AND: [where, { NOT: { OR: relevanceOr } }] };
    const [countRelevant, countRest] = await Promise.all([
      prisma.title.count({ where: whereRelevant }),
      prisma.title.count({ where: whereRest }),
    ]);
    totalCount = countRelevant + countRest;

    const rows: Prisma.TitleGetPayload<{ include: typeof titleInclude }>[] = [];
    if (skip < countRelevant) {
      rows.push(
        ...(await prisma.title.findMany({
          where: whereRelevant,
          include: titleInclude,
          orderBy: relevantOrderBy,
          take: Math.min(PAGE_SIZE, countRelevant - skip),
          skip,
        })),
      );
    }
    const remaining = PAGE_SIZE - rows.length;
    if (remaining > 0) {
      rows.push(
        ...(await prisma.title.findMany({
          where: whereRest,
          include: titleInclude,
          orderBy,
          take: remaining,
          skip: Math.max(0, skip - countRelevant),
        })),
      );
    }
    titles = rows;
  } else {
    [totalCount, titles] = await Promise.all([
      prisma.title.count({ where }),
      prisma.title.findMany({ where, include: titleInclude, orderBy, take: PAGE_SIZE, skip }),
    ]);
  }
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  // Filters that narrow the catalog (search included): with any of them a
  // zero count means "no match", not "the catalog is empty".
  const narrowed =
    !!q ||
    markets.length > 0 ||
    types.length > 0 ||
    verticals.length > 0 ||
    regions.length > 0 ||
    !!publisher ||
    !!nativeFit ||
    !!b2bB2c ||
    !!reach ||
    onlyPriced ||
    producedForYou ||
    guaranteedReach ||
    newsletterIncluded ||
    videoIncluded;

  // Favorites: which of this page's titles the buyer has hearted (filled vs
  // empty heart). The "add to list" dropdown, however, is the buyer's real
  // SavedList set — the same lists /plan and /lists work from — not the
  // separate (and for most buyers empty) FavoriteList model. session.user is
  // guaranteed here — the marketing splash returns above for guests.
  const userId = session.user.id;
  const titleIds = titles.map((tt) => tt.id);
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
  // A view-only (RESTRICTED) seat browses the catalog like anyone, but gets no
  // "Add to plan" or list checklist: both change the org's plans.
  const readOnly = !!orgId && !scope.workspace?.activeCanEdit;
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
  // (activeList itself was already resolved above, ahead of the relevance query.)
  const shortlistProductIds = (activeList?.items ?? [])
    .map((i) => i.productId)
    .filter((id): id is string => id !== null);
  // Every line the plan shows (placeholders included), priced server-side —
  // the same count and totals the "Add to plan" action returns.
  const shortlistCount = planLineCount(activeList?.items ?? []);
  const shortlistTotals = activeList ? barTotals(activeList.items, await loadPricingDefaults()) : [];
  const planName = activeList?.name ?? t("shortlist.untitledPlan");

  // "42 more titles without published pricing" — only meaningful once
  // onlyPriced is actually narrowing the list; same query with that one
  // condition dropped tells us how many.
  let unpricedCount: number | null = null;
  if (onlyPriced) {
    const broaderCount = await prisma.title.count({ where: buildCatalogWhere(filters, search, { includeOnlyPriced: false }) });
    unpricedCount = Math.max(0, broaderCount - totalCount);
  }

  const density: Density = sp.density === "cards" ? "cards" : "list";
  // A single selected market earns a mention in the H1 ("… run native in
  // Norway"); multiple markets or none fall back to the market-less count.
  const marketLabel = markets.length === 1 ? tMarket(markets[0]) : null;

  // The export link carries the result set's params (not the view's).
  const exportParams = catalogFilterParams(filters);
  // Any filter or search beyond the market narrows the file below "the
  // catalog in <market>", so the link says it's the filtered set.
  const filtersNarrow = [...exportParams.keys()].some((k) => k !== "market");
  if (sort) exportParams.set("sort", sort);
  const exportHref = `/api/export/catalog.csv${exportParams.size ? `?${exportParams}` : ""}`;

  const pageQuery = (p: number) => {
    const params = catalogFilterParams(filters);
    if (sort) params.set("sort", sort);
    if (compareMode) params.set("compareMode", "1");
    if (density === "cards") params.set("density", "cards");
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `?${s}` : "";
  };

  // A page past the end (a stale bookmark, ?page=999, a filter that shrank the
  // results) goes to the last page instead of showing "1 065 titles" above an
  // empty list. The pagination links are plain <a>s, so this is always a full
  // navigation, never the same-route soft navigation that breaks in prod.
  if (page > totalPages && totalCount > 0) redirect(`/${locale}/catalog${pageQuery(totalPages)}`);

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
    if (density === "cards") params.set("density", "cards");
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
      label: `${t("filters.category")}: ${localizeVertical(v, safeLocale(locale))}`,
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
      initialCount={shortlistCount}
      initialProductIds={shortlistProductIds}
      initialTotals={shortlistTotals}
      readOnly={readOnly}
    >
      <section className="catalog-page">
        {showBookingBanner ? <CatalogBookCallBanner /> : null}

        <CatalogMobileBar
          markets={MARKET_CODES.map((m) => ({ value: m, label: tMarket(m) }))}
          formats={formatOptions}
          nativeFits={NATIVE_FIT_VALUES.map((v) => ({ value: v, label: tFit(v) }))}
          b2bB2cs={B2B_B2C_VALUES.map((v) => ({ value: v, label: v }))}
          reaches={REACH_VALUES.map((v) => ({ value: v, label: tReach(v) }))}
          categories={verticalOptions}
          regions={regionOptions.map((r) => ({ value: r.value, label: `${r.value} (${tMarket(r.country)})` }))}
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

        <div className="catalog-layout">
          <CatalogRail
            markets={MARKET_CODES.map((m) => ({ value: m, label: tMarket(m) }))}
            formats={formatOptions}
            nativeFits={NATIVE_FIT_VALUES.map((v) => ({ value: v, label: tFit(v) }))}
            b2bB2cs={B2B_B2C_VALUES.map((v) => ({ value: v, label: v }))}
            reaches={REACH_VALUES.map((v) => ({ value: v, label: tReach(v) }))}
            categories={verticalOptions}
            regions={regionOptions.map((r) => ({ value: r.value, label: `${r.value} (${tMarket(r.country)})` }))}
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
                  {totalCount === 0 && narrowed
                    ? t("noMatchHeading")
                    : marketLabel
                      ? t("resultsHeadingInMarket", { count: totalCount, market: marketLabel })
                      : t("resultsHeading", { count: totalCount })}
                </h1>
                <p className="catalog-results-sub">
                  {search?.match === "some" && totalCount > 0
                    ? t("searchSomeWords", { q })
                    : t("resultsSubline")}
                </p>
              </div>
              <div className="catalog-results-controls">
                <CatalogSort initial={sort ?? ""} />
                <CatalogDensityToggle initial={density} />
                {/* The CSV export (bands only, like the page) holds exactly
                    the titles on screen: same filters, search and sort, all
                    pages. Plain <a download>: it's a file, not a page. */}
                <a className="small-link" href={exportHref} download>
                  {filtersNarrow
                    ? t("exportCsvFiltered", { count: totalCount })
                    : markets.length === 1
                      ? t("exportCsvMarket", { market: tMarket(markets[0]) })
                      : t("exportCsv")}
                </a>
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
              readOnly={readOnly}
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
