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
import { loadPricingDefaults } from "@/lib/content-fee";
import { timeAgo } from "@/lib/time-ago";
import { loadVerticalOptions } from "@/lib/catalog-taxonomy";
import { PlanBanners } from "./_components/PlanBanners";
import { PlanShare } from "./_components/PlanShare";
import { PlanStart } from "./_components/PlanStart";
import { PlanSteps, type PlanStep } from "./_components/PlanSteps";
import { PlanTitleBlock } from "./_components/PlanTitleBlock";
import { PlanTargeting } from "./_components/PlanTargeting";
import { PlanLines, type PlanTitleLine } from "./_components/PlanLines";
import { PlanSummary, type Rollup } from "./_components/PlanSummary";
import { WhatHappensNext } from "./_components/WhatHappensNext";
import { PlanProgramme, type ProgrammePacing } from "./_components/PlanProgramme";
import { loadProgrammeForList, recommendCadence } from "@/lib/programme";
import { estimateListTotals } from "@/lib/plan-total";
import { scheduleOverlapWarnings, type ScheduleOverlapWarning } from "@/lib/programme-warnings";
import type { BookingUnit } from "@/lib/campaign-schedule";

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
  // The active list comes from the cookie ONLY. Deep links that need to switch
  // it (the placement-ready notification) go through /plan/open, which writes
  // the cookie and redirects here — so what this page renders and what the
  // submit button acts on (submitRequest reads the same cookie) can never
  // disagree.
  const activeList = ws?.activeOrgId
    ? await resolveActiveList(ws.activeOrgId, await readActiveListId())
    : null;
  const listItems = activeList?.items ?? [];
  const verticalOptions = activeList ? await loadVerticalOptions() : [];
  const targetVerticals = (activeList?.targetVerticals ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

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
      itemCount: 0,
    };
    r.itemCount += 1;
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

  const firmLineCount = lines.filter((l) => l.product.visibility === "FIRM").length;

  // Content-fee rules for PlanLines' per-line price breakdown ("38 000
  // placement + 7 000 article") — same load as the catalog/quote surfaces
  // so the indicative figure agrees with what the formal quote will charge.
  const pricing = await loadPricingDefaults();

  // Step rail: "Find titles" is always done by the time there are lines on
  // /plan. The remaining three steps come from the most recent Request this
  // list has been submitted as (none yet = still building), its latest
  // Quote, and whether that quote has an Order (accepted).
  const submittedRequest = activeList
    ? await prisma.request.findFirst({
        where: { sourceListId: activeList.id },
        orderBy: { createdAt: "desc" },
        select: {
          quotes: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { order: { select: { id: true } } },
          },
        },
      })
    : null;
  const hasOrder = !!submittedRequest?.quotes[0]?.order;
  const currentStep: PlanStep = hasOrder ? 4 : submittedRequest ? 3 : 2;

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

  // Programme panel inputs: the wave strip when this list is a wave, else the
  // recommended cadence for the titles on it (booking units + goal drive the
  // rules) and wave 1's anchor = the earliest scheduled line.
  const programmeView = activeList ? await loadProgrammeForList(activeList.id) : null;

  // Budget pacing + overlap warnings across the programme's waves. One lean
  // query for all (≤4) wave lists: only the fields estimateListTotals and
  // scheduleOverlapWarnings need — never the full ITEM_INCLUDE hydration.
  let pacing: ProgrammePacing | null = null;
  let overlapWarnings: ScheduleOverlapWarning[] = [];
  if (programmeView) {
    const waveItems = await prisma.savedListItem.findMany({
      where: { listId: { in: programmeView.waves.map((w) => w.listId) } },
      select: {
        listId: true,
        productId: true,
        quantity: true,
        scheduleStart: true,
        scheduleUnits: true,
        product: {
          select: {
            currency: true,
            basePrice: true,
            active: true,
            confirmedAt: true,
            bookingUnit: true,
            titleId: true,
            priceRules: { select: { marginPct: true, seasonalMultiplier: true, minVolume: true } },
            title: {
              select: {
                name: true,
                pricesPublic: true,
                publisher: { select: { pricesPublic: true } },
              },
            },
          },
        },
      },
    });
    const itemsByList = new Map<string, typeof waveItems>();
    for (const i of waveItems) {
      const arr = itemsByList.get(i.listId) ?? [];
      arr.push(i);
      itemsByList.set(i.listId, arr);
    }
    // Per-wave indicative totals; only priced lines produce an amount, so a
    // wave of hidden-price titles shows no figure rather than a misleading 0.
    const perWave = programmeView.waves.map((w) => ({
      listId: w.listId,
      totals: estimateListTotals(itemsByList.get(w.listId) ?? [])
        .filter((tot) => tot.amount > 0)
        .map((tot) => ({ currency: tot.currency, amount: tot.amount })),
    }));
    const programmeByCurrency = new Map<string, number>();
    for (const w of perWave) {
      for (const tot of w.totals) {
        programmeByCurrency.set(tot.currency, (programmeByCurrency.get(tot.currency) ?? 0) + tot.amount);
      }
    }
    const budgetAmount = activeList?.budget != null ? Number(activeList.budget) : 0;
    pacing = {
      perWave,
      programmeTotals: [...programmeByCurrency.entries()].map(([currency, amount]) => ({
        currency,
        amount,
      })),
      // A list budget is per plan — i.e. per wave — so the comparison line
      // reads "vs your budget of X per wave", not "X for the programme".
      budget:
        budgetAmount > 0 && activeList?.currency
          ? { amount: budgetAmount, currency: activeList.currency }
          : null,
    };
    overlapWarnings = scheduleOverlapWarnings(
      programmeView.waves.map((w) => ({
        waveNumber: w.waveNumber,
        items: (itemsByList.get(w.listId) ?? []).map((i) => ({
          titleId: i.product?.titleId ?? null,
          titleName: i.product?.title.name ?? "",
          scheduleStart: i.scheduleStart,
          scheduleUnits: i.scheduleUnits,
          bookingUnit: (i.product?.bookingUnit ?? "MONTH") as BookingUnit,
        })),
      })),
    );
  }
  const bookingUnits = lines.map((l) => l.product.bookingUnit as BookingUnit);
  const cadence = recommendCadence({ goal: activeList?.goal ?? null, bookingUnits });
  let firstStart: Date | null = null;
  for (const l of lines) {
    if (l.scheduleStart && (!firstStart || l.scheduleStart < firstStart)) firstStart = l.scheduleStart;
  }
  // The grid the preview snaps to: MONTH if any monthly title (the coarser grid wins).
  const previewUnit: BookingUnit = bookingUnits.includes("MONTH") ? "MONTH" : "WEEK";

  const placementCount = lines.length + titleLines.length;
  const hasLines = placementCount > 0;
  const lastEdited = activeList ? timeAgo(activeList.updatedAt, locale) : "";

  return (
    <>
      {hasLines && !needsWorkspace ? null : (
        <header className="page-header">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead")}</p>
        </header>
      )}

      {/* When we render the tailored no-workspace empty state below, it IS the
          explanation — suppress the generic (and, for non-agencies, misleading
          "pick a client") error banner so the two don't fight. Other errors,
          which only occur once an org is active, still surface normally. */}
      <PlanBanners
        locale={locale}
        error={needsWorkspace ? undefined : sp.error}
        duplicate={sp.duplicate}
      />

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
      ) : !hasLines ? (
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
        <>
          <PlanSteps locale={locale} currentStep={currentStep} />
          <PlanTitleBlock
            locale={locale}
            planName={activeList?.name ?? t("title")}
            activeListId={activeList?.id}
            placementCount={placementCount}
            orgName={activeOrg?.name ?? null}
            lastEdited={lastEdited}
            lists={lists}
          />
          <PlanTargeting
            locale={locale}
            activeListId={activeList?.id}
            verticalOptions={verticalOptions}
            selected={targetVerticals}
          />
          {activeList ? (
            <PlanProgramme
              locale={locale}
              listId={activeList.id}
              view={programmeView}
              cadence={cadence}
              firstStart={firstStart}
              unit={previewUnit}
              pacing={pacing}
              warnings={overlapWarnings}
            />
          ) : null}
          <div className="split">
            <div>
              <PlanLines
                locale={locale}
                lines={lines}
                titleLines={titleLines}
                hasHiddenPrice={hasHiddenPrice}
                feeRules={pricing.feeRules}
              />
              {favoriteCount > 0 ? (
                <div className="plan-favorites-bridge">
                  <span>{t("favoritesStripTitle", { count: favoriteCount })}</span>
                  <Link href="/favorites" className="btn small secondary">
                    {t("reviewFavorites")}
                  </Link>
                </div>
              ) : null}
            </div>
            <div className="plan-summary-col">
              <PlanSummary
                locale={locale}
                totals={totals}
                hasHiddenPrice={hasHiddenPrice}
                allFirm={allFirm}
                firmLineCount={firmLineCount}
                lineCount={lines.length}
                needsClient={needsClient}
                activeOrg={activeOrg}
                briefDraft={briefDraft}
              />
              <WhatHappensNext locale={locale} />
              {activeList ? (
                <PlanShare
                  locale={locale}
                  listId={activeList.id}
                  shareToken={activeList.shareToken}
                  shareViewedAt={activeList.shareViewedAt}
                  shareViewCount={activeList.shareViewCount}
                  clientApprovedAt={activeList.clientApprovedAt}
                />
              ) : null}
            </div>
          </div>
        </>
      )}
    </>
  );
}
