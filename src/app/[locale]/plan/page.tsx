import { getTranslations } from "next-intl/server";
import { MarketCode } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { Link } from "@/i18n/navigation";
import { readBasket, readPlanBrief } from "@/lib/basket";
import { indicativeFromRules, toRateRules, formatMoney } from "@/lib/money";
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
import { removeFromPlan, setQuantity, addToPlan, setContentProduction } from "@/app/plan-actions";
import { submitRequest } from "@/app/checkout-actions";
import { AUDIENCE_SEGMENTS } from "@/lib/targeting/segments";
import { SubmitButton } from "@/components";

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
  const tf = await getTranslations({ locale, namespace: "firm" });
  const tr = await getTranslations({ locale, namespace: "rfq" });
  const tSeg = await getTranslations({ locale, namespace: "targetSegment" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const ta = await getTranslations({ locale, namespace: "auth" });
  const tNav = await getTranslations({ locale, namespace: "nav" });
  const tv = await getTranslations({
    locale,
    namespace: "priceVisibility",
  });
  const tMarket = await getTranslations({ locale, namespace: "market" });

  const session = await auth();

  const ws = await getWorkspace(session?.user?.id);
  const activeOrg = ws?.activeOrgId
    ? await prisma.organization.findUnique({
        where: { id: ws.activeOrgId },
        select: { name: true, marketCode: true },
      })
    : null;
  const needsClient = !!ws?.isAgency && !ws.activeOrgId;

  const basket = await readBasket();
  // Rehydrate the brief from the cookie submitRequest stashed before
  // the onboarding gate detour. Empty strings on the fresh path —
  // React leaves the input blank when defaultValue is "".
  const briefDraft = await readPlanBrief();
  const products = basket.length
    ? await prisma.product.findMany({
        where: { id: { in: basket.map((b) => b.productId) } },
        include: {
          title: { include: { publisher: true } },
          priceRules: true,
        },
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  const lines = basket
    .map((b) => {
      const p = byId.get(b.productId);
      if (!p) return null;
      const priceVisible = isProductPriceShown(p, p.title);
      const unit = priceVisible
        ? indicativeFromRules(
            Number(p.basePrice),
            toRateRules(p.priceRules),
            b.quantity,
          )
        : 0;
      return {
        product: p,
        quantity: b.quantity,
        priceVisible,
        withContent: b.withContent ?? false,
        lineTotal: unit * b.quantity,
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  const hasHiddenPrice = lines.some((l) => !l.priceVisible);

  // Per-currency rollup. Visible-price lines accumulate; locked-price
  // lines still register their currency so a tri-Nordic basket shows
  // NOK + SEK + DKK rows up front — even when only one of them has a
  // visible total today. Hiding the locked currencies entirely was the
  // Erlend bug: the CFO defense relies on seeing all three lines.
  type Rollup = { amount: number; hasVisible: boolean; hasHidden: boolean };
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

  // A hidden-price line forces the whole basket onto the RFQ path —
  // we can't checkout firm against a price the buyer hasn't seen.
  const allFirm =
    lines.length > 0 &&
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
  if (basket.length === 0 && recMarket) {
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

      {sp.error ? (
        <div className="banner-error" role="alert">
          <span>{t("error")}</span>
        </div>
      ) : null}

      {/* Surfaced by duplicatePlan (Maja R2 / "use as template") so the
          buyer knows how many items survived the rehydration. */}
      {typeof sp.duplicate === "string" ? (
        sp.duplicate === "ok" ? (
          <div className="banner-info" role="status">
            <span>{t("duplicateOk")}</span>
          </div>
        ) : sp.duplicate.startsWith("partial-") ? (
          <div className="banner-info" role="status">
            <span>
              {t("duplicatePartial", {
                dropped: sp.duplicate.slice("partial-".length),
              })}
            </span>
          </div>
        ) : sp.duplicate === "all-inactive" ? (
          <div className="banner-error" role="alert">
            <span>{t("duplicateAllInactive")}</span>
          </div>
        ) : null
      ) : null}

      {lines.length === 0 ? (
        <div className="plan-start">
          <form className="plan-start-form" method="get">
            <h2>{t("startTitle")}</h2>
            <p className="muted small">{t("startLead")}</p>
            <div className="field">
              <label htmlFor="recBrief">{t("briefLabel")}</label>
              <textarea
                id="recBrief"
                name="recBrief"
                rows={3}
                maxLength={2000}
                placeholder={t("briefPlaceholder")}
                defaultValue={recBriefRaw}
              />
              <span className="hint">{t("briefHint")}</span>
            </div>
            <div className="field">
              <label htmlFor="recMarket">{tr("market")}</label>
              <select id="recMarket" name="recMarket" defaultValue={recMarket || homeMarket || ""}>
                {MARKET_CODES.map((m) => (
                  <option key={m} value={m}>{tMarket(m)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="recBudget">{tr("budget")}</label>
              <input id="recBudget" name="recBudget" type="number" min="0" defaultValue={recBudgetRaw} />
            </div>
            <SubmitButton label={t("recommend")} pendingLabel={t("recommending")} />
            <Link href="/catalog" className="link small">{t("browse")}</Link>
          </form>

          {rec ? (
            <div className="plan-start-results">
              {rec.picks.length > 0 ? (
                <>
                  <h3>{briefMatched ? t("recForBrief") : t("recForBudget")}</h3>
                  <div className="action-list">
                    {rec.picks.map((p) => (
                      <div className="item" key={p.productId}>
                        <div>
                          <div className="title">{p.titleName}</div>
                          <div className="sub muted small">{tType(p.type)} · {tr("fromPrice", { price: formatMoney(p.unitPrice, recCurrency, locale) })} · {p.reach.toLocaleString(locale)} {t("reach")}</div>
                          {p.reasons && p.reasons.length > 0 ? (
                            <div className="cluster tight" style={{ marginTop: "0.35rem" }}>
                              {p.reasons.slice(0, 4).map((r) => (
                                <span className="tag" key={r}>{r}</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <form action={addToPlan}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="productId" value={p.productId} />
                          <button type="submit" className="btn small">{t("add")}</button>
                        </form>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
              {rec.supplementary.length > 0 ? (
                <>
                  <h3>{t("recAlsoConsider")}</h3>
                  <div className="action-list">
                    {rec.supplementary.map((s) => (
                      <div className="item" key={s.productId}>
                        <div>
                          <div className="title">{s.titleName}</div>
                          <div className="sub muted small">{tv("requestPrice")} · {s.reach.toLocaleString(locale)} {t("reach")}</div>
                        </div>
                        <form action={addToPlan}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="productId" value={s.productId} />
                          <button type="submit" className="btn small ghost">{t("add")}</button>
                        </form>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
              {rec.picks.length === 0 && rec.supplementary.length === 0 ? (
                <p className="muted small">{t("recNone")}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="split">
          <div>
            <div className="section-head">
              <div>
                <span className="eyebrow">{t("linesEyebrow")}</span>
                <h2>{t("linesHeading")}</h2>
              </div>
              <span className="muted small">
                {t("itemCount", { count: lines.length })}
              </span>
            </div>
            {hasHiddenPrice ? (
              <div className="banner-info" role="status">
                <span>{tv("planRfqOnly")}</span>
              </div>
            ) : null}
            <div className="action-list">
              {lines.map((l) => (
                <div className="item plan-item" key={l.product.id}>
                  <span className="tag">{tType(l.product.type)}</span>
                  <div>
                    <div className="title">{l.product.title.name}</div>
                    <div className="sub plan-qty">
                      <form action={setQuantity} className="plan-qty-step">
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="productId" value={l.product.id} />
                        <input type="hidden" name="quantity" value={l.quantity - 1} />
                        <button type="submit" className="btn small ghost" aria-label={t("decrement")} disabled={l.quantity <= 1}>−</button>
                      </form>
                      <span aria-live="polite">{t("qty")}: {l.quantity}</span>
                      <form action={setQuantity} className="plan-qty-step">
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="productId" value={l.product.id} />
                        <input type="hidden" name="quantity" value={l.quantity + 1} />
                        <button type="submit" className="btn small ghost" aria-label={t("increment")}>+</button>
                      </form>
                    </div>
                    <form action={setContentProduction} className="plan-content-toggle">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="productId" value={l.product.id} />
                      <input type="hidden" name="withContent" value={l.withContent ? "0" : "1"} />
                      <button
                        type="submit"
                        className={`btn small ${l.withContent ? "" : "ghost"}`}
                        aria-pressed={l.withContent}
                        title={t("contentProductionHint")}
                      >
                        {l.withContent ? `✓ ${t("contentProduction")}` : `+ ${t("contentProduction")}`}
                      </button>
                    </form>
                  </div>
                  <div className="cluster tight">
                    {l.priceVisible ? (
                      <span className="price plan-line-price">
                        {formatMoney(l.lineTotal, l.product.currency, locale)}
                      </span>
                    ) : (
                      <span className="muted small plan-line-price">
                        {tv("requestPrice")}
                      </span>
                    )}
                    <form action={removeFromPlan}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="productId" value={l.product.id} />
                      <button type="submit" className="btn small ghost">
                        {t("remove")}
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside className="plan-summary">
            <div className="plan-summary-head">
              <span className="muted small">{t("estTotal")}</span>
              <div className="plan-summary-total">
                {totals
                  .filter(([, r]) => r.hasVisible)
                  .map(([cur, r]) => (
                    <div className="price" key={cur}>
                      {formatMoney(r.amount, cur, locale)}
                      {r.hasHidden ? (
                        <span className="muted small"> + {tv("requestPrice")}</span>
                      ) : null}
                    </div>
                  ))}
                {hasHiddenPrice && !totals.some(([, r]) => r.hasVisible) ? (
                  <div className="muted small">{t("pricingOnRequest")}</div>
                ) : null}
              </div>
              {allFirm ? (
                <span className="badge badge-info dotless">
                  ⚡ {tf("badge")}
                </span>
              ) : null}
            </div>

            <h3>{allFirm ? tf("planTitle") : t("rfqTitle")}</h3>
            {allFirm ? <p className="muted small">{tf("planNote")}</p> : null}

            {needsClient ? (
              <p className="muted small">
                {tr("selectClient")}{" "}
                <Link href="/agency" className="link">
                  {tNav("agency")}
                </Link>
              </p>
            ) : activeOrg ? (
              <form action={submitRequest} className="product-form">
                <input type="hidden" name="locale" value={locale} />
                <p className="muted small">
                  {tr("requestingAs")}: <strong>{activeOrg.name}</strong>
                </p>
                <div className="field">
                  <label htmlFor="budget">{tr("budget")}</label>
                  <input
                    id="budget"
                    name="budget"
                    type="number"
                    min="0"
                    defaultValue={briefDraft.budget}
                  />
                </div>
                <div className="field">
                  <label htmlFor="audience">{tr("audience")}</label>
                  <input
                    id="audience"
                    name="audience"
                    defaultValue={briefDraft.audience}
                  />
                </div>
                <div className="field">
                  <label htmlFor="goal">{tr("goal")}</label>
                  <input
                    id="goal"
                    name="goal"
                    defaultValue={briefDraft.goal}
                  />
                </div>
                <div className="field">
                  <label>{tr("targetAudienceLabel")}</label>
                  <div className="checkbox-grid">
                    {AUDIENCE_SEGMENTS.map((s) => (
                      <label key={s} className="checkbox">
                        <input
                          type="checkbox"
                          name="targetAudience"
                          value={s}
                          defaultChecked={briefDraft.targetAudience
                            .split(",")
                            .includes(s)}
                        />
                        {tSeg(s)}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="targetGeo">{tr("targetGeoLabel")}</label>
                  <input
                    id="targetGeo"
                    name="targetGeo"
                    defaultValue={briefDraft.targetGeo}
                    placeholder={tr("targetGeoPlaceholder")}
                  />
                </div>
                <div className="field">
                  <label htmlFor="targetContext">{tr("targetContextLabel")}</label>
                  <input
                    id="targetContext"
                    name="targetContext"
                    defaultValue={briefDraft.targetContext}
                    placeholder={tr("targetContextPlaceholder")}
                  />
                </div>
                <div className="field">
                  <label htmlFor="brief">{tr("brief")}</label>
                  <textarea
                    id="brief"
                    name="brief"
                    rows={3}
                    defaultValue={briefDraft.brief}
                  />
                </div>
                <SubmitButton
                  label={allFirm ? tf("planSubmit") : tr("submit")}
                  pendingLabel={
                    allFirm ? tf("planSubmitting") : tr("submitting")
                  }
                  className="btn block"
                />
              </form>
            ) : (
              <div className="auth-fallback">
                <p className="muted small">{tr("loginRequired")}</p>
                <div className="cluster">
                  <Link href="/signin" className="btn small secondary">
                    {ta("signin")}
                  </Link>
                  <Link href="/signup" className="btn small">
                    {ta("signup")}
                  </Link>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
