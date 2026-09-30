"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { addProductToActiveList } from "@/app/list-actions";
import type { PlanBarSummary } from "@/lib/plan-total";

type LineTotal = PlanBarSummary["totals"][number];

type ShortlistItem = {
  productId: string;
  titleName: string;
};

type Ctx = {
  isOnPlan: (productId: string) => boolean;
  isPending: (productId: string) => boolean;
  add: (item: ShortlistItem, withContent: boolean) => Promise<boolean>;
};

const ShortlistCtx = createContext<Ctx | null>(null);

export function useShortlist(): Ctx {
  const ctx = useContext(ShortlistCtx);
  if (!ctx) throw new Error("useShortlist must be used inside ShortlistProvider");
  return ctx;
}

// Optimistic cross-row state for "Add to plan": a row's CTA flips to added
// and the sticky bar's count goes up in the same tick, while
// addProductToActiveList runs in the background — same architecture as
// CompareSelectionProvider (a client Context + a bar the provider renders
// itself), but this one calls a real server action, so it needs a revert path
// on failure.
//
// Money is never computed here. The bar's total is the server's
// (planBarSummary: the plan's own pricing, as /plan shows it), from the page
// render or from the add action's result. Adding a product's price in the
// browser used its NET base price (a margin leak) and, once the page
// re-rendered with the new line, counted it twice.
export function ShortlistProvider({
  locale,
  planName,
  initialPlan,
  children,
}: {
  locale: string;
  planName: string;
  initialPlan: PlanBarSummary;
  children: ReactNode;
}) {
  const t = useTranslations("catalog.shortlist");
  // The plan as the server last described it: the page's render, replaced by
  // each successful add's result (whichever is newer).
  const [plan, setPlan] = useState<PlanBarSummary>(initialPlan);
  useEffect(() => setPlan(initialPlan), [initialPlan]);
  // Adds still in flight: counted optimistically, not yet priced.
  const [inFlight, setInFlight] = useState<ShortlistItem[]>([]);
  // Titles added on this page, most recent last (the bar's chips).
  const [recent, setRecent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const onPlanIds = useMemo(() => new Set(plan.productIds), [plan]);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 5500);
    return () => clearTimeout(id);
  }, [error]);

  const isPending = useCallback(
    (productId: string) => inFlight.some((i) => i.productId === productId),
    [inFlight],
  );
  const isOnPlan = useCallback(
    (productId: string) => onPlanIds.has(productId) || isPending(productId),
    [onPlanIds, isPending],
  );

  const add = useCallback(
    async (item: ShortlistItem, withContent: boolean) => {
      setInFlight((f) => [...f, item]);
      const result = await addProductToActiveList(item.productId, withContent, locale).catch(() => null);
      setInFlight((f) => f.filter((i) => i.productId !== item.productId));
      if (!result?.ok) {
        setError(result?.reason === "no-client" ? t("errorNoClient") : t("errorGeneric"));
        return false;
      }
      setPlan(result.plan);
      setRecent((r) => [...r, item.titleName]);
      return true;
    },
    [locale, t],
  );

  const value = useMemo<Ctx>(() => ({ isOnPlan, isPending, add }), [isOnPlan, isPending, add]);

  // An in-flight add of a product already on the plan (a re-add bumps the
  // quantity) isn't a new line.
  const count = plan.count + inFlight.filter((i) => !onPlanIds.has(i.productId)).length;

  return (
    <ShortlistCtx.Provider value={value}>
      {children}
      {count > 0 ? (
        <ShortlistBar
          locale={locale}
          planName={planName}
          count={count}
          totals={plan.totals}
          pricing={inFlight.length > 0}
          recentTitles={[...recent, ...inFlight.map((i) => i.titleName)]}
        />
      ) : null}
      {error ? (
        <div className="toast toast-danger" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label={t("dismiss")}>
            ×
          </button>
        </div>
      ) : null}
    </ShortlistCtx.Provider>
  );
}

function ShortlistBar({
  locale,
  planName,
  count,
  totals,
  pricing,
  recentTitles,
}: {
  locale: string;
  planName: string;
  count: number;
  totals: LineTotal[];
  // An add is still on its way: the total shown is the one before it.
  pricing: boolean;
  recentTitles: string[];
}) {
  const t = useTranslations("catalog.shortlist");
  const tPlan = useTranslations("plan");
  // "up to four title chips" — most-recently-added first reads as
  // confirmation of what you just did, not an arbitrary slice.
  const chips = recentTitles.slice(-4).reverse();

  return (
    <div className="shortlist-bar" role="region" aria-label={t("barLabel")}>
      <div className="shortlist-bar__left">
        <span className="shortlist-bar__count">{count}</span>
        <span className="shortlist-bar__summary">
          {t("summaryCount", { count })} <strong>{planName}</strong>
        </span>
        {chips.length ? (
          <div className="shortlist-bar__chips">
            {chips.map((name, i) => (
              <span className="shortlist-bar__chip" key={`${name}-${i}`}>
                {name}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="shortlist-bar__right">
        <div className="shortlist-bar__total">
          <span className="shortlist-bar__total-label">{t("totalLabel")}</span>
          <span className="shortlist-bar__total-amount" aria-busy={pricing}>
            {totals.length
              ? totals.length > 1
                ? totals
                    .map((line) =>
                      tPlan("totalForItems", {
                        amount: formatMoney(line.amount, line.currency, locale),
                        count: line.itemCount,
                      }),
                    )
                    .join(" + ")
                : formatMoney(totals[0].amount, totals[0].currency, locale)
              : t("totalPending")}
          </span>
        </div>
        <Link href="/plan" className="btn shortlist-bar__cta">
          {t("reviewPlan")} →
        </Link>
      </div>
    </div>
  );
}

export function ShortlistButton({
  productId,
  titleName,
  withContent,
  hasPrice,
  addLabel,
  addedLabel,
  askLabel,
}: {
  productId: string;
  titleName: string;
  withContent: boolean;
  hasPrice: boolean;
  addLabel: string;
  addedLabel: string;
  askLabel: string;
}) {
  const { isOnPlan, isPending, add } = useShortlist();
  const onPlan = isOnPlan(productId);
  const pending = isPending(productId);

  return (
    <button
      type="button"
      className={`btn small catalog-row__cta${onPlan ? " is-added" : ""}`}
      disabled={onPlan || pending}
      aria-busy={pending}
      onClick={() => add({ productId, titleName }, withContent)}
    >
      {onPlan ? `✓ ${addedLabel}` : hasPrice ? addLabel : askLabel}
    </button>
  );
}
