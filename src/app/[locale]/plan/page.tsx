import { getTranslations } from "next-intl/server";
import { MarketCode } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { Link } from "@/i18n/navigation";
import { readPlanBrief } from "@/lib/basket";
import { readActiveListId, resolveActiveList } from "@/lib/lists";
import { indicativeFromRules, toRateRules } from "@/lib/money";
import { isProductPriceShown } from "@/lib/pricing-visibility";
import { titleDisplayName } from "@/lib/title-display";
import { catalogVisibleTitleWhere } from "@/lib/catalog-visibility";
import type { Candidate, SupplementaryTitle } from "@/lib/recommend";
import { recommendForBrief } from "@/lib/campaign-recommend";
import { addAllFavoritesToList } from "@/app/list-actions";
import { PlanBanners } from "./_components/PlanBanners";
import { PlanStart } from "./_components/PlanStart";
import { PlanLines, type PlanTitleLine } from "./_components/PlanLines";
import { PlanListBar } from "./_components/PlanListBar";
import { PlanSummary, type Rollup } from "./_components/PlanSummary";

const MARKET_CODES = Object.values(MarketCode);

export const dynamic = "force-dynamic";

export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "plan" });

  const session = await auth();

  // A missing buyer workspace on /plan almost always means a staff/internal
  // account (desk, superadmin, publisher, writer) wandered in — real buyers
  // get an org + admin membership at signup. Tell those accounts the truth
  // (this flow is for advertisers) and point them back to their console,
  // instead of the misleading "we'll set one up" buyer-provisioning copy.
  const role = session?.user?.role;
  const isStaffAccount =
    role === "DESK" || role === "SUPERADMIN" || role === "PUBLISHER" || role === "CONTENT";
  const consoleHref =
    role === "PUBLISHER" ? "/publisher" : role === "CONTENT" ? "/writer" : "/desk";

  const ws = await getWorkspace(session?.user?.id);
  const activeOrg = ws?.activeOrgId
    ? await prisma.organization.findUnique({
        where: { id: ws.activeOrgId },
        select: { name: true, marketCode: true },
      })
    : null;
  const needsClient = !!ws?.isAgency && !ws.activeOrgId;
  // requireActiveOrg() bounces ANY "Add to plan" with no active org back here
  // as ?error=client — not just agencies. A buyer always has a home org, so a
  // missing org means an internal/unprovisioned account (desk, publisher,
  // writer, superadmin) that wandered into the buyer flow. Both cases need an
  // actionable empty state instead of a bare error banner with no way forward.
  const needsWorkspace = !ws?.activeOrgId;

  // Rehydrate the brief from the cookie submitRequest stashed before
  // the onboarding gate detour. Empty strings on the fresh path —
  // React leaves the input blank when defaultValue is "".
  const briefDraft = await readPlanBrief();

  // The plan now operates on the active SavedList (not the legacy cookie
  // basket). The switcher needs every non-archived list for this org.
  const lists = ws?.activeOrgId
    ? await prisma.savedList.findMany({
        where: { organizationId: ws.activeOrgId, archivedAt: null },
        orderBy: { updatedAt: "desc" },
        select: { id: true, name: true, _count: { select: { items: true } } },
      })
    : [];
  const activeList = ws?.activeOrgId
    ? await resolveActiveList(ws.activeOrgId, await readActiveListId())
    : null;
  const listItems = activeList?.items ?? [];

  const tType = await getTranslations({ locale, namespace: "productType" });

  // PRODUCT lines: concrete placements. Same price logic as before, but
  // keyed on the SavedListItem id so edits target the row, not the product.
  const lines = listItems
    .map((i) => {
      if (!i.productId || !i.product) return null;
      const p = i.product;
      const priceVisible = isProductPriceShown(p, p.title);
      const unit = priceVisible
        ? indicativeFromRules(
            Number(p.basePrice),
            toRateRules(p.priceRules),
            i.quantity,
          )
        : 0;
      return {
        itemId: i.id,
        product: p,
        quantity: i.quantity,
        priceVisible,
        withContent: i.withContent,
        lineTotal: unit * i.quantity,
        // A product deactivated since it was added: still shown, but flagged so
        // the buyer removes it (submit refuses while it's present — see E).
        unavailable: !p.active || !p.bookable,
        // Set only via the campaign flow's Schedule step — most buyers who
        // build a list straight from /plan never touch it, so PlanLines
        // falls back to the product's stated minimum run.
        scheduleStart: i.scheduleStart,
        scheduleUnits: i.scheduleUnits,
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  // PLACEHOLDER lines: a title with no product yet. Offer the title's
  // active+bookable products so the buyer can resolve the line in place.
  const placeholderItems = listItems.filter((i) => !i.productId && i.titleId && i.title);
  const placeholderTitleIds = [
    ...new Set(placeholderItems.map((i) => i.titleId as string)),
  ];
  const placementProducts = placeholderTitleIds.length
    ? await prisma.product.findMany({
        where: { titleId: { in: placeholderTitleIds }, active: true, bookable: true },
        select: { id: true, type: true, titleId: true },
      })
    : [];
  const placementsByTitle = new Map<string, { id: string; label: string }[]>();
  for (const p of placementProducts) {
    const arr = placementsByTitle.get(p.titleId) ?? [];
    arr.push({ id: p.id, label: tType(p.type) });
    placementsByTitle.set(p.titleId, arr);
  }
  const titleLines: PlanTitleLine[] = placeholderItems.map((i) => ({
    itemId: i.id,
    titleId: i.titleId as string,
    titleName: titleDisplayName(i.title!),
    quantity: i.quantity,
    placements: placementsByTitle.get(i.titleId as string) ?? [],
  }));

  const hasHiddenPrice = lines.some((l) => !l.priceVisible);

  // Per-currency rollup. Visible-price lines accumulate; locked-price
  // lines still register their currency so a tri-Nordic basket shows
  // NOK + SEK + DKK rows up front — even when only one of them has a
  // visible total today. Hiding the locked currencies entirely was the
  // Erlend bug: the CFO defense relies on seeing all three lines.
  const totalsByCurrency = new Map<string, Rollup>();
  for (const l of lines) {
    const cur = l.product.currency;
    const r = totalsByCurrency.get(cur) ?? {
      amount: 0,
      hasVisible: false,
      hasHidden: false,
    };
    if (l.priceVisible) {
      r.amount += l.lineTotal;
      r.hasVisible = true;
    } else {
      r.hasHidden = true;
    }
    totalsByCurrency.set(cur, r);
  }
  // Render order: visible-only first, then mixed, then hidden-only —
  // so the "real number" lines lead and "from desk" lines follow.
  const totals = [...totalsByCurrency.entries()].sort(([, a], [, b]) => {
    const score = (r: Rollup) => (r.hasVisible ? 0 : 1);
    return score(a) - score(b);
  });

  // A hidden-price line — or any unresolved title placeholder — forces the
  // whole basket onto the RFQ path. We can't checkout firm against a price
  // the buyer hasn't seen, nor against a placement the desk hasn't proposed.
  const allFirm =
    lines.length > 0 &&
    titleLines.length === 0 &&
    !hasHiddenPrice &&
    lines.every((l) => l.product.visibility === "FIRM");

  // Empty-state recommendation: budget + market → tiered title suggestions.
  const recMarketRaw = typeof sp.recMarket === "string" ? sp.recMarket : "";
  const recBudgetRaw = typeof sp.recBudget === "string" ? sp.recBudget : "";
  const recMarket = (MARKET_CODES as readonly string[]).includes(recMarketRaw)
    ? recMarketRaw
    : "";
  const recBudget = Number(recBudgetRaw) > 0 ? Number(recBudgetRaw) : 0;
  const recBriefRaw = typeof sp.recBrief === "string" ? sp.recBrief.slice(0, 2000) : "";
  const homeMarket = activeOrg?.marketCode ?? null;

  let rec: { picks: Candidate[]; supplementary: SupplementaryTitle[] } | null = null;
  let recCurrency = "EUR";
  // True when the results were ranked by the brief (drives the heading +
  // reason chips); false = plain budget recommender.
  let briefMatched = false;
  // Same catalog-grounded matcher the campaign Discover step uses — one
  // source of truth for dedup-by-title, taxonomy matching and the optional
  // LLM rerank, instead of a parallel hand-rolled copy on this page.
  if (listItems.length === 0 && recMarket) {
    const result = await recommendForBrief({
      market: recMarket,
      budget: recBudget,
      brief: recBriefRaw,
      locale,
    });
    rec = { picks: result.picks, supplementary: result.supplementary };
    recCurrency = result.currency;
    briefMatched = result.briefMatched;
  }

  // Hearts→lists bridge: count titles the buyer has favorited that aren't
  // already a line on the active list, so the strip only shows when it has
  // something to offer.
  const listTitleIds = new Set<string>();
  for (const l of lines) listTitleIds.add(l.product.titleId);
  for (const tl of titleLines) listTitleIds.add(tl.titleId);
  const favoriteCount = session?.user?.id
    ? await prisma.favorite.count({
        where: {
          userId: session.user.id,
          title: catalogVisibleTitleWhere,
          titleId: { notIn: [...listTitleIds] },
        },
      })
    : 0;

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </header>

      {/* When we render the tailored no-workspace empty state below, it IS the
          explanation — suppress the generic (and, for non-agencies, misleading
          "pick a client") error banner so the two don't fight. Other errors,
          which only occur once an org is active, still surface normally. */}
      <PlanBanners
        locale={locale}
        error={needsWorkspace ? undefined : sp.error}
        duplicate={sp.duplicate}
      />

      {lists.length > 0 ? (
        <PlanListBar
          locale={locale}
          lists={lists}
          activeListId={activeList?.id}
          activeListName={activeList?.name}
        />
      ) : null}

      {/* Hearts→lists bridge: hearted titles live in a separate personal
          favorites pool (see catalog "Legg til i en liste"); this bulk-adopts
          every one not already on the active list, in one submit. */}
      {!needsWorkspace && favoriteCount > 0 ? (
        <div className="banner-info plan-favorites-strip" role="status" style={{ justifyContent: "space-between" }}>
          <span>{t("favoritesStripTitle", { count: favoriteCount })}</span>
          <form action={addAllFavoritesToList}>
            <input type="hidden" name="locale" value={locale} />
            <button type="submit" className="btn small ghost">
              {t("addFavorites")}
            </button>
          </form>
        </div>
      ) : null}

      {needsWorkspace ? (
        // No active org → requireActiveOrg bounced an "Add to plan" here.
        // Never drop them into the recommender (every "Add" would loop back) —
        // give an actionable path. Agencies pick/create a client; everyone
        // else has no buyer workspace at all and needs to get set up.
        needsClient ? (
          <div className="empty-state">
            <h2>{t("needsClientTitle")}</h2>
            <p className="muted">{t("needsClientBody")}</p>
            <Link href="/agency" className="btn">
              {t("needsClientCta")}
            </Link>
          </div>
        ) : isStaffAccount ? (
          <div className="empty-state">
            <h2>{t("needsStaffTitle")}</h2>
            <p className="muted">{t("needsStaffBody")}</p>
            <Link href={consoleHref} className="btn">
              {t("needsStaffCta")}
            </Link>
          </div>
        ) : (
          <div className="empty-state">
            <h2>{t("needsWorkspaceTitle")}</h2>
            <p className="muted">{t("needsWorkspaceBody")}</p>
            <Link href="/contact" className="btn">
              {t("needsWorkspaceCta")}
            </Link>
          </div>
        )
      ) : lines.length === 0 && titleLines.length === 0 ? (
        <PlanStart
          locale={locale}
          recBriefRaw={recBriefRaw}
          recMarket={recMarket}
          recBudgetRaw={recBudgetRaw}
          homeMarket={homeMarket}
          rec={rec}
          recCurrency={recCurrency}
          briefMatched={briefMatched}
        />
      ) : (
        <div className="split">
          <PlanLines locale={locale} lines={lines} titleLines={titleLines} hasHiddenPrice={hasHiddenPrice} />
          <PlanSummary
            locale={locale}
            totals={totals}
            hasHiddenPrice={hasHiddenPrice}
            allFirm={allFirm}
            needsClient={needsClient}
            activeOrg={activeOrg}
            briefDraft={briefDraft}
          />
        </div>
      )}
    </>
  );
}
