import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { planPath } from "@/lib/plan-path";
import { auth } from "@/auth";
import { loadScope, canCommitOnOrg } from "@/lib/scope";
import { signinPath } from "@/lib/auth-gate";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { Link } from "@/i18n/navigation";
import { planBriefValues, timingOptions } from "@/lib/plan-brief";
import { readActiveListId, resolveActiveList } from "@/lib/lists";
import { titleDisplayName } from "@/lib/title-display";
import { intlLocale } from "@/lib/money";
import { bandLabel } from "@/lib/pricing/bands";
import { bandIncludesArticle, productBand, unitRate } from "@/lib/pricing/display-price";
import { productDisplayNames } from "@/lib/pricing/display-name";
import type { ProductInclusions } from "@/lib/pricing/inclusions";
import { catalogVisibleTitleWhere } from "@/lib/catalog-visibility";
import type { Candidate, SupplementaryTitle } from "@/lib/recommend";
import { recommendForBrief } from "@/lib/campaign-recommend";
import { loadExtraWorkRates, loadPricingDefaults } from "@/lib/content-fee";
import { timeAgo } from "@/lib/time-ago";
import { loadVerticalOptions, localizedVerticalOptions } from "@/lib/catalog-taxonomy";
import { ViewOnlyNote } from "@/components/view-only-note";
import { PlanDownload } from "@/components/plan-download";
import { publisherCanWrite } from "@/lib/authorship";
import { liveOrderForList } from "@/lib/commerce/list-commit";
import { PlanBanners } from "./PlanBanners";
import { PlanShare } from "./PlanShare";
import { displayTimeZone } from "@/lib/time-zone";
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
import {
  estimateListTotals,
  hasFigure,
  hasUnpricedLines,
  lineDisplay,
  sumTotalFigures,
} from "@/lib/plan-total";
import { scheduleOverlapWarnings, type ScheduleOverlapWarning } from "@/lib/programme-warnings";
import type { BookingUnit } from "@/lib/campaign-schedule";
import { SUPPORTED_MARKETS } from "@/lib/markets";

const MARKET_CODES = SUPPORTED_MARKETS;

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
  if (expectedListId && activeList?.id !== expectedListId) {
    redirect(planPath(locale, null, { ...sp, notice: "plan-unavailable" }));
  }
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
  // The per-currency hourly rate the article-scope list quotes.
  const extraWorkRates = await loadExtraWorkRates();

  // PRODUCT lines: concrete placements. Same price logic as before, but
  // keyed on the SavedListItem id so edits target the row, not the product.
  // Display position of every line (listItems is already in sortOrder), so
  // product lines and title placeholders render interleaved in the buyer's order.
  const positionOf = new Map(listItems.map((i, index) => [i.id, index]));
  const allLines = listItems
    .map((i) => {
      if (!i.productId || !i.product) return null;
      const p = i.product;
      // Exact figure or band, by the one rule the summary total adds up
      // (lib/plan-total.ts lineDisplay): a "We write it" line includes its
      // content fee, so the line and the total can never disagree.
      const display = lineDisplay(i, pricing);
      return {
        itemId: i.id,
        product: p,
        quantity: i.quantity,
        display,
        withContent: i.withContent,
        publisherCanWrite: publisherCanWrite(p),
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
        orderBy: [{ type: "asc" }, { basePrice: "asc" }],
        select: {
          id: true,
          type: true,
          titleId: true,
          active: true,
          confirmedAt: true,
          basePrice: true,
          currency: true,
          pricingModel: true,
          productionFee: true,
          inclusions: true,
          priceRules: { select: { marginPct: true, seasonalMultiplier: true, minVolume: true } },
          title: {
            select: {
              pricesPublic: true,
              productionFeeDefault: true,
              publisher: { select: { pricesPublic: true } },
              market: { select: { code: true } },
            },
          },
        },
      })
    : [];
  // Options must be tellable apart: "Native-artikkel, Native-artikkel,
  // Advertorial, Advertorial" gave the buyer nothing to choose on. Same
  // generated names as the title page's format cards (type + inclusions,
  // never the raw publisher offer text) plus the band — never an exact
  // figure before a quote.
  const tDetail = await getTranslations({ locale, namespace: "titleDetail" });
  const tv = await getTranslations({ locale, namespace: "priceVisibility" });
  const numberFormat = new Intl.NumberFormat(intlLocale(locale));
  const placementsByTitle = new Map<string, { id: string; label: string }[]>();
  for (const titleId of placeholderTitleIds) {
    const products = placementProducts.filter((p) => p.titleId === titleId);
    const names = productDisplayNames(
      products.map((p) => ({ typeLabel: tType(p.type), inclusions: p.inclusions as ProductInclusions | null })),
      (n) => numberFormat.format(n),
      tDetail,
    );
    const labels = products.map((p, i) => {
      const band = productBand(p, p.title, pricing);
      const rate = band ? null : unitRate(p, p.title, pricing);
      const price = band
        ? `≈ ${bandLabel(band, p.currency)}${
            bandIncludesArticle(p, p.title, pricing) ? ` ${tv("productionIncluded")}` : ""
          }`
        : rate
          ? `≈ ${rate.rate} ${p.currency} ${rate.unit}`
          : tv("priceOnRequest");
      return `${names[i]} · ${price}`;
    });
    // Still identical (same type, no inclusions, same band)? Number them so
    // the choice is at least stable and nameable.
    const seen = new Map<string, number>();
    const total = new Map<string, number>();
    for (const l of labels) total.set(l, (total.get(l) ?? 0) + 1);
    placementsByTitle.set(
      titleId,
      products.map((p, i) => {
        const n = (seen.get(labels[i]) ?? 0) + 1;
        seen.set(labels[i], n);
        return { id: p.id, label: (total.get(labels[i]) ?? 1) > 1 ? `${labels[i]} (${n})` : labels[i] };
      }),
    );
  }
  const allTitleLines: PlanTitleLine[] = placeholderItems.map((i) => ({
    itemId: i.id,
    titleId: i.titleId as string,
    titleName: titleDisplayName(i.title!),
    publisherName: i.title!.publisher.name,
    quantity: i.quantity,
    withContent: i.withContent,
    placements: placementsByTitle.get(i.titleId as string) ?? [],
    notes: i.notes,
    isAlternative: i.isAlternative,
    position: positionOf.get(i.id) ?? 0,
  }));
  const titleLines = allTitleLines.filter((l) => !l.isAlternative);
  const altTitleLines = allTitleLines.filter((l) => l.isAlternative);

  const hasHiddenPrice = lines.some((l) => l.display.kind === "onRequest");

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

  // Per-currency totals, content fees included: the exact sum of the
  // instant-orderable lines plus the band range of the rest (lib/plan-total.ts,
  // the order's own pricing engine). Locked-price lines still register their
  // currency so a tri-Nordic basket shows NOK + SEK + DKK rows up front — even
  // when only one of them has a figure today. Hiding the locked currencies
  // entirely was the Erlend bug: the CFO defense relies on seeing all three
  // lines. Render order: currencies with a figure first.
  const totals = estimateListTotals(listItems, pricing).sort(
    (a, b) => Number(!hasFigure(a)) - Number(!hasFigure(b)),
  );

  // A line is instant-orderable only when it is firm-priced AND its price is
  // shown — isInstantOrderable, the per-line test submitRequest applies
  // (checkout-actions), which lineDisplay reports as its "exact" kind.
  // Counting FIRM alone claimed "1 of 2 available as instant order" on a plan
  // whose every line read "Price on request".
  const instantOrderable = (l: (typeof lines)[number]) => l.display.kind === "exact";

  // Any line that isn't instant-orderable — or any unresolved title
  // placeholder — forces the whole basket onto the RFQ path. We can't checkout
  // firm against a price the buyer hasn't seen, nor against a placement the
  // desk hasn't proposed.
  const allFirm = lines.length > 0 && titleLines.length === 0 && lines.every(instantOrderable);
  const firmLineCount = lines.filter(instantOrderable).length;

  // The instant path creates a confirmed order, so it needs ordering rights on
  // the active org (the same canCommitOnOrg gate submitRequest enforces).
  const canCommit = ws?.activeOrgId ? canCommitOnOrg(await loadScope(), ws.activeOrgId) : false;
  // A view-only (RESTRICTED) seat in the active org sees the plan as a
  // read-out: every editing control is left out and the view-only note says
  // why. The server refuses those writes regardless (lib/scope canEditOnOrg).
  const readOnly = !!ws?.activeOrgId && !ws.activeCanEdit;

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
  // The live order this plan already has, by either path: an ordered plan is
  // spent, so the summary shows it instead of the send/order form
  // (lib/commerce/list-commit.ts).
  const ordered = activeList ? await liveOrderForList(prisma, activeList.id) : null;
  const hasOrder = !!ordered || !!submittedRequest?.quotes[0]?.order;
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
            visibility: true,
            pricingModel: true,
            productionFee: true,
            inclusions: true,
            bookingUnit: true,
            titleId: true,
            priceRules: { select: { marginPct: true, seasonalMultiplier: true, minVolume: true } },
            title: {
              select: {
                name: true,
                pricesPublic: true,
                productionFeeDefault: true,
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
    // Per-wave indicative totals (exact part + band range, like the plan
    // summary); only priced lines produce a figure, so a wave of hidden-price
    // titles shows none rather than a misleading 0.
    const perWave = programmeView.waves.map((w) => ({
      listId: w.listId,
      totals: estimateListTotals(itemsByList.get(w.listId) ?? [], pricing).filter(hasFigure),
    }));
    const budgetAmount = activeList?.budget != null ? Number(activeList.budget) : 0;
    pacing = {
      perWave,
      programmeTotals: sumTotalFigures(perWave.map((w) => w.totals)),
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
        notice={sp.notice}
      />
      {readOnly ? <ViewOnlyNote locale={locale} /> : null}

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
              readOnly={readOnly}
            />
          ) : null}
        {/* The start screen is a recommender whose every result is an "Add":
            nothing a view-only seat can use. */}
        {readOnly ? null : (
          <PlanStart
            locale={locale}
            listId={activeList?.id ?? null}
            recBriefRaw={recBriefRaw}
            recMarket={recMarket}
            recBudgetRaw={recBudgetRaw}
            homeMarket={homeMarket}
            rec={rec}
            briefMatched={briefMatched}
          />
        )}
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
            readOnly={readOnly}
          />
          <PlanTargeting
            locale={locale}
            activeListId={activeList?.id}
            verticalOptions={verticalOptions}
            selected={targetVerticals}
            readOnly={readOnly}
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
              readOnly={readOnly}
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
                readOnly={readOnly}
                extraWorkRates={extraWorkRates}
              />
              {favoriteCount > 0 && !readOnly ? (
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
                hasUnpriced={hasUnpricedLines(listItems, totals)}
                allFirm={allFirm}
                canCommit={canCommit}
                firmLineCount={firmLineCount}
                lineCount={placementCount}
                needsClient={needsClient}
                activeOrg={activeOrg}
                brief={planBriefValues(activeList!)}
                timingOptions={timingOptions(new Date())}
                ordered={ordered}
                timeZone={displayTimeZone({ marketCode: activeOrg?.marketCode, locale })}
                readOnly={readOnly}
              />
              {readOnly || ordered ? null : <WhatHappensNext locale={locale} instant={allFirm && canCommit} />}
              {/* A copy to pass around the team, view-only seats included (it
                  is a read-out, like this page for them). Only a seat that can
                  create the client link below is pointed at it. */}
              {activeList ? (
                <PlanDownload
                  locale={locale}
                  basePath={`/api/export/plan/${encodeURIComponent(activeList.id)}`}
                  variant="plan"
                  showLiveHint={!readOnly}
                />
              ) : null}
              {/* Sharing mints/kills a client link — a change a view-only seat
                  can't make, so the whole control is left out. */}
              {activeList && !readOnly ? (
                <PlanShare
                  locale={locale}
                  listId={activeList.id}
                  shareToken={activeList.shareToken}
                  shareViewedAt={activeList.shareViewedAt}
                  shareViewCount={activeList.shareViewCount}
                  timeZone={displayTimeZone({ marketCode: activeOrg?.marketCode, locale })}
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
