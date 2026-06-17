import { getTranslations } from "next-intl/server";
import { MarketCode } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { readPlanBrief } from "@/lib/basket";
import { readActiveListId, resolveActiveList } from "@/lib/lists";
import { indicativeFromRules, toRateRules } from "@/lib/money";
import { isProductPriceShown } from "@/lib/pricing-visibility";
import { recommendTiered, type Candidate, type SupplementaryTitle } from "@/lib/recommend";
import {
  extractFacets,
  mergeFacets,
  matchTitles,
  facetsAreEmpty,
  type MatchableTitle,
} from "@/lib/brief-match";
import { enrichBriefWithLLM, llmEnrichmentAvailable } from "@/lib/brief-match-llm";
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

  const ws = await getWorkspace(session?.user?.id);
  const activeOrg = ws?.activeOrgId
    ? await prisma.organization.findUnique({
        where: { id: ws.activeOrgId },
        select: { name: true, marketCode: true },
      })
    : null;
  const needsClient = !!ws?.isAgency && !ws.activeOrgId;

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
    titleName: i.title!.name,
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
  if (listItems.length === 0 && recMarket) {
    const recProducts = await prisma.product.findMany({
      where: {
        active: true,
        bookable: true,
        title: { active: true, market: { code: recMarket as MarketCode } },
      },
      include: {
        title: {
          include: {
            publisher: { select: { pricesPublic: true } },
            market: { select: { currency: true } },
          },
        },
        priceRules: true,
      },
    });
    recCurrency = recProducts[0]?.currency ?? "EUR";
    const priced: Candidate[] = [];
    const unpricedByTitle = new Map<string, SupplementaryTitle>();
    for (const p of recProducts) {
      const reach = p.title.digitalReach ?? p.title.monthlyReach ?? 0;
      const currency = p.currency ?? p.title.market?.currency ?? "EUR";
      // Tier 1 only when the buyer would actually see a € figure — active,
      // sales-confirmed, prices public (same gate as the catalog + /recommend).
      // Unconfirmed-but-public-price products fall through to Tier 2 "Request
      // price", never a fabricated indicative figure.
      if (isProductPriceShown(p, p.title)) {
        priced.push({
          productId: p.id,
          titleId: p.titleId,
          titleName: p.title.name,
          category: p.title.category,
          type: p.type,
          reach,
          unitPrice: indicativeFromRules(Number(p.basePrice), toRateRules(p.priceRules)),
        });
      } else if (!unpricedByTitle.has(p.titleId)) {
        unpricedByTitle.set(p.titleId, {
          titleId: p.titleId,
          titleName: p.title.name,
          productId: p.id,
          reach,
          currency,
        });
      }
    }
    // Brief-driven matching: rank/filter the same candidates by how well
    // each title fits the buyer's free-text brief (hybrid: deterministic
    // taxonomy + optional LLM enrichment). Falls back to the budget
    // recommender when the brief yields no usable signal.
    let facets = recBriefRaw ? extractFacets(recBriefRaw) : null;
    if (facets && llmEnrichmentAvailable()) {
      facets = mergeFacets(facets, await enrichBriefWithLLM(recBriefRaw));
    }

    if (facets && !facetsAreEmpty(facets)) {
      const matchables = new Map<string, MatchableTitle>();
      for (const p of recProducts) {
        if (matchables.has(p.titleId)) continue;
        matchables.set(p.titleId, {
          id: p.titleId,
          name: p.title.name,
          b2bB2c: p.title.b2bB2c,
          vertical: p.title.vertical,
          audience: p.title.audience,
          category: p.title.category,
          reach: p.title.reach,
          nativeFit: p.title.nativeFit,
          tags: p.title.tags,
          locationNote: p.title.locationNote,
          digitalReach: p.title.digitalReach,
          monthlyReach: p.title.monthlyReach,
        });
      }
      const matches = matchTitles([...matchables.values()], facets);
      const rank = new Map(matches.map((m, i) => [m.title.id, i]));
      const reasonsByTitle = new Map(matches.map((m) => [m.title.id, m.reasons]));

      const matchedPriced = priced
        .filter((c) => rank.has(c.titleId))
        .sort((a, b) => (rank.get(a.titleId)! - rank.get(b.titleId)!))
        .map((c) => ({ ...c, reasons: reasonsByTitle.get(c.titleId) ?? [] }));

      // Greedy budget cap (one product per title already); no budget = all.
      // Cap the list to the strongest matches so a broad brief doesn't dump
      // hundreds of rows.
      const MAX_PICKS = 12;
      const cap = recBudget > 0 ? recBudget : Number.MAX_SAFE_INTEGER;
      const picks: Candidate[] = [];
      let spend = 0;
      for (const c of matchedPriced) {
        if (picks.length >= MAX_PICKS) break;
        if (spend + c.unitPrice > cap) continue;
        picks.push(c);
        spend += c.unitPrice;
      }

      const supplementary = [...unpricedByTitle.values()]
        .filter((s) => rank.has(s.titleId))
        .sort((a, b) => (rank.get(a.titleId)! - rank.get(b.titleId)!))
        .slice(0, 6);

      rec = { picks, supplementary };
      briefMatched = true;
    } else {
      rec = recommendTiered(
        priced,
        [...unpricedByTitle.values()],
        recBudget > 0 ? recBudget : Number.MAX_SAFE_INTEGER,
      );
    }
  }

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </header>

      <PlanBanners locale={locale} error={sp.error} duplicate={sp.duplicate} />

      {lists.length > 0 ? (
        <PlanListBar
          locale={locale}
          lists={lists}
          activeListId={activeList?.id}
          activeListName={activeList?.name}
        />
      ) : null}

      {lines.length === 0 && titleLines.length === 0 ? (
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
