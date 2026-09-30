import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { planPath } from "@/lib/plan-path";
import { MarketCode } from "@prisma/client";
import { auth } from "@/auth";
import { loadScope, canCommitOnOrg } from "@/lib/scope";
import { signinPath } from "@/lib/auth-gate";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { Link } from "@/i18n/navigation";
import { planBriefValues, timingOptions } from "@/lib/plan-brief";
import { readActiveListId, resolveActiveList } from "@/lib/lists";
import { isProductPriceShown } from "@/lib/pricing-visibility";
import { titleDisplayName } from "@/lib/title-display";
import { catalogVisibleTitleWhere } from "@/lib/catalog-visibility";
import type { Candidate, SupplementaryTitle } from "@/lib/recommend";
import { recommendForBrief } from "@/lib/campaign-recommend";
import { loadPricingDefaults } from "@/lib/content-fee";
import { timeAgo } from "@/lib/time-ago";
import { loadVerticalOptions, localizedVerticalOptions } from "@/lib/catalog-taxonomy";
import { PlanBanners } from "./PlanBanners";
import { PlanShare } from "./PlanShare";
import { approvalState, planVersion } from "@/lib/list-share";
import { PlanStart } from "./PlanStart";
import { PlanSteps, type PlanStep } from "./PlanSteps";
import { PlanTitleBlock } from "./PlanTitleBlock";
import { PlanTargeting } from "./PlanTargeting";
import { PlanLines, type PlanTitleLine } from "./PlanLines";
import { PlanSummary } from "./PlanSummary";
import { WhatHappensNext } from "./WhatHappensNext";
import { PlanProgramme, type ProgrammePacing } from "./PlanProgramme";
import { loadProgrammeForList, recommendCadence } from "@/lib/programme";
import { estimateListTotals, placementLineTotal, contentFeeFor } from "@/lib/plan-total";
import { scheduleOverlapWarnings, type ScheduleOverlapWarning } from "@/lib/programme-warnings";
import type { BookingUnit } from "@/lib/campaign-schedule";

const MARKET_CODES = Object.values(MarketCode);

// The plan page body, shared by /plan (no active list yet: start/empty states)
// and /plan/[listId] (the canonical, shareable address of one plan). The list
// rendered is the ACTIVE list from the cookie, which /plan/[listId] aligns with
// its address first (via /plan/open). Every form here posts that list's id and
// the actions act on it (lib/plan-target.ts), so another tab moving the cookie
// on afterwards can't make "Send" or a line edit land on a different plan.
export async function PlanView({
  locale,
  sp,
  expectedListId,
}: {
  locale: string;
  sp: Record<string, string | string[] | undefined>;
  // Set on /plan/[listId]: the list the address names. If the active list
  // resolves to anything else (archived meanwhile, access lost), go to /plan
  // rather than show a different plan under this list's address.
  expectedListId?: string;
}) {
  const t = await getTranslations({ locale, namespace: "plan" });

  const session = await auth();
  // Signed out: sign in first and come back here (middleware already does
  // this for a plain page load; this covers an expired session cookie).
  if (!session?.user) {
    redirect(signinPath(locale, expectedListId ? `/${locale}/plan/${expectedListId}` : `/${locale}/plan`));
  }

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

  // The plan now operates on the active SavedList (not the legacy cookie
  // basket). The switcher needs every non-archived list for this org.
  const lists = ws?.activeOrgId
    ? await prisma.savedList.findMany({
        where: { organizationId: ws.activeOrgId, archivedAt: null },
        orderBy: { updatedAt: "desc" },
        select: { id: true, name: true, _count: { select: { items: true } } },
      })
    : [];
  // The active list comes from the cookie, which /plan/[listId] has aligned
  // with its address (via /plan/open) before rendering. The page's forms post
  // this list's id, so what they act on is the plan shown here even if another
  // tab moves the cookie on afterwards (lib/plan-target.ts).
  const activeList = ws?.activeOrgId
    ? await resolveActiveList(ws.activeOrgId, await readActiveListId())
    : null;
  if (expectedListId && activeList?.id !== expectedListId) redirect(planPath(locale, null, sp));
  const listItems = activeList?.items ?? [];
  const verticalOptions = activeList ? localizedVerticalOptions(await loadVerticalOptions(), locale) : [];
  const targetVerticals = (activeList?.targetVerticals ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const tType = await getTranslations({ locale, namespace: "productType" });

  // Desk-owned fee + margin rules: the per-line figures, the summary total and
  // PlanLines' breakdown ("38 000 placement + 7 000 article") are all priced
  // from the same load the order uses, so /plan shows what the order charges.
  const pricing = await loadPricingDefaults();

  // PRODUCT lines: concrete placements. Same price logic as before, but
  // keyed on the SavedListItem id so edits target the row, not the product.
  // Display position of every line (listItems is already in sortOrder), so
  // product lines and title placeholders render interleaved in the buyer's order.
  const positionOf = new Map(listItems.map((i, index) => [i.id, index]));
  const allLines = listItems
    .map((i) => {
      if (!i.productId || !i.product) return null;
      const p = i.product;
      const priceVisible = isProductPriceShown(p, p.title);
      // The line total is what the order charges for this line: the placement
      // plus, for "We write it", the content fee (one article per line,
      // whatever the quantity: the same rule estimateListTotals and the order
      // apply), so the line figures add up to the plan total.
      const placementTotal = priceVisible ? placementLineTotal(p, i.quantity, pricing.marginRules) : 0;
      const contentFee =
        priceVisible && i.withContent ? contentFeeFor(p.type, p.title.market.code, pricing.feeRules) : 0;
      return {
        itemId: i.id,
        product: p,
        quantity: i.quantity,
        priceVisible,
        withContent: i.withContent,
        placementTotal,
        contentFee,
        lineTotal: placementTotal + contentFee,
        // A product deactivated since it was added: still shown, but flagged so
        // the buyer removes it (submit refuses while it's present — see E).
        unavailable: !p.active || !p.bookable,
        // Set only via the campaign flow's Schedule step — most buyers who
        // build a list straight from /plan never touch it, so PlanLines
        // falls back to the product's stated minimum run.
        scheduleStart: i.scheduleStart,
        scheduleUnits: i.scheduleUnits,
        notes: i.notes,
        isAlternative: i.isAlternative,
        position: positionOf.get(i.id) ?? 0,
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);
  // Recommended alternatives render in their own section and never feed the
  // totals, the firm-checkout decision or the submit (lib/lists.ts).
  const lines = allLines.filter((l) => !l.isAlternative);
  const altLines = allLines.filter((l) => l.isAlternative);

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
  const allTitleLines: PlanTitleLine[] = placeholderItems.map((i) => ({
    itemId: i.id,
    titleId: i.titleId as string,
    titleName: titleDisplayName(i.title!),
    publisherName: i.title!.publisher.name,
    quantity: i.quantity,
    placements: placementsByTitle.get(i.titleId as string) ?? [],
    notes: i.notes,
    isAlternative: i.isAlternative,
    position: positionOf.get(i.id) ?? 0,
  }));
  const titleLines = allTitleLines.filter((l) => !l.isAlternative);
  const altTitleLines = allTitleLines.filter((l) => l.isAlternative);

  const hasHiddenPrice = lines.some((l) => !l.priceVisible);

  // Sold-out / editorially closed periods, so the lines' inline date picker
  // disables them (same data the campaign flow's Schedule step reads).
  const blockedPeriods = new Set(
    lines.length
      ? (
          await prisma.availability.findMany({
            where: { productId: { in: lines.map((l) => l.product.id) }, blocked: true },
            select: { productId: true, year: true, month: true },
          })
        ).map((r) => `${r.productId}:${r.year}-${r.month}`)
      : [],
  );

  // Per-currency totals, content fees and VAT included — the amount the plan
  // commits to (lib/plan-total.ts, the order's own pricing engine). Locked-price
  // lines still register their currency so a tri-Nordic basket shows NOK + SEK
  // + DKK rows up front — even when only one of them has a visible total
  // today. Hiding the locked currencies entirely was the Erlend bug: the CFO
  // defense relies on seeing all three lines. Render order: visible-price
  // currencies first, so the "real number" lines lead.
  const totals = estimateListTotals(listItems, pricing).sort(
    (a, b) => Number(!a.hasVisible) - Number(!b.hasVisible),
  );

  // A line is instant-orderable only when it is firm-priced AND its price is
  // shown — the exact per-line test submitRequest applies (checkout-actions).
  // Counting FIRM alone claimed "1 of 2 available as instant order" on a plan
  // whose every line read "Contact for price".
  const instantOrderable = (l: (typeof lines)[number]) =>
    l.product.visibility === "FIRM" && l.priceVisible;

  // Any line that isn't instant-orderable — or any unresolved title
  // placeholder — forces the whole basket onto the RFQ path. We can't checkout
  // firm against a price the buyer hasn't seen, nor against a placement the
  // desk hasn't proposed.
  const allFirm = lines.length > 0 && titleLines.length === 0 && lines.every(instantOrderable);
  const firmLineCount = lines.filter(instantOrderable).length;

  // The instant path creates a confirmed order, so it needs ordering rights on
  // the active org (the same canCommitOnOrg gate submitRequest enforces).
  const canCommit = ws?.activeOrgId ? canCommitOnOrg(await loadScope(), ws.activeOrgId) : false;

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
      where: { listId: { in: programmeView.waves.map((w) => w.listId) }, isAlternative: false },
      select: {
        listId: true,
        productId: true,
        quantity: true,
        withContent: true,
        scheduleStart: true,
        scheduleUnits: true,
        product: {
          select: {
            type: true,
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
                market: { select: { code: true, vatRatePct: true } },
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
      totals: estimateListTotals(itemsByList.get(w.listId) ?? [], pricing)
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
  // A plan whose every line sits among the alternatives still has something
  // to show (and to move back) — only a truly empty list gets the start state.
  const hasLines = placementCount + altLines.length + altTitleLines.length > 0;
  const lastEdited = activeList ? timeAgo(activeList.updatedAt, locale) : "";

  return (
    <>
      {/* A named plan keeps its own title block (name, rename, "Switch plan")
          even while empty, so a buyer who just created one can see which plan
          is active and switch back. The generic header is for no plan at all. */}
      {activeList && !needsWorkspace ? null : (
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
        <>
          {activeList ? (
            <PlanTitleBlock
              locale={locale}
              planName={activeList.name}
              activeListId={activeList.id}
              placementCount={0}
              orgName={activeOrg?.name ?? null}
              lastEdited={lastEdited}
              lists={lists}
            />
          ) : null}
        <PlanStart
          locale={locale}
          listId={activeList?.id ?? null}
          recBriefRaw={recBriefRaw}
          recMarket={recMarket}
          recBudgetRaw={recBudgetRaw}
          homeMarket={homeMarket}
          rec={rec}
          recCurrency={recCurrency}
          briefMatched={briefMatched}
        />
        </>
      ) : (
        <>
          <PlanSteps locale={locale} currentStep={currentStep} instant={allFirm && canCommit} />
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
                listId={activeList!.id}
                lines={lines}
                titleLines={titleLines}
                altLines={altLines}
                altTitleLines={altTitleLines}
                hasHiddenPrice={hasHiddenPrice}
                blockedPeriods={blockedPeriods}
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
                listId={activeList!.id}
                totals={totals}
                hasHiddenPrice={hasHiddenPrice}
                allFirm={allFirm}
                canCommit={canCommit}
                firmLineCount={firmLineCount}
                lineCount={placementCount}
                needsClient={needsClient}
                activeOrg={activeOrg}
                brief={planBriefValues(activeList!)}
                timingOptions={timingOptions(new Date())}
              />
              <WhatHappensNext locale={locale} instant={allFirm && canCommit} />
              {activeList ? (
                <PlanShare
                  locale={locale}
                  listId={activeList.id}
                  shareToken={activeList.shareToken}
                  shareViewedAt={activeList.shareViewedAt}
                  shareViewCount={activeList.shareViewCount}
                  approval={approvalState(activeList, planVersion(activeList.items))}
                />
              ) : null}
            </div>
          </div>
        </>
      )}
    </>
  );
}
