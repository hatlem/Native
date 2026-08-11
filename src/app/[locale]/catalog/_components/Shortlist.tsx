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

type LineTotal = { currency: string; amount: number };

type ShortlistItem = {
  productId: string;
  titleName: string;
  amount: number | null;
  currency: string | null;
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
// immediately and the sticky bar's count/total increment in the same tick,
// while addProductToActiveList runs in the background — same architecture
// as CompareSelectionProvider (a client Context + a bar the provider
// renders itself), but this one calls a real server action instead of only
// touching local/localStorage state, so it needs a revert path on failure.
export function ShortlistProvider({
  locale,
  planName,
  initialCount,
  initialProductIds,
  initialTotals,
  children,
}: {
  locale: string;
  planName: string;
  initialCount: number;
  initialProductIds: string[];
  initialTotals: LineTotal[];
  children: ReactNode;
}) {
  const t = useTranslations("catalog.shortlist");
  const [added, setAdded] = useState<ShortlistItem[]>([]);
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const initialIds = useMemo(() => new Set(initialProductIds), [initialProductIds]);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 5500);
    return () => clearTimeout(id);
  }, [error]);

  const isOnPlan = useCallback(
    (productId: string) => initialIds.has(productId) || addedIds.has(productId),
    [initialIds, addedIds],
  );
  const isPending = useCallback((productId: string) => pendingIds.has(productId), [pendingIds]);

  const add = useCallback(
    async (item: ShortlistItem, withContent: boolean) => {
      setPendingIds((p) => new Set(p).add(item.productId));
      setAddedIds((s) => new Set(s).add(item.productId));
      setAdded((a) => [...a, item]);

      const result = await addProductToActiveList(item.productId, withContent, locale);

      setPendingIds((p) => {
        const next = new Set(p);
        next.delete(item.productId);
        return next;
      });

      if (!result.ok) {
        setAddedIds((s) => {
          const next = new Set(s);
          next.delete(item.productId);
          return next;
        });
        setAdded((a) => a.filter((i) => i.productId !== item.productId));
        setError(result.reason === "no-client" ? t("errorNoClient") : t("errorGeneric"));
        return false;
      }
      return true;
    },
    [locale, t],
  );

  const value = useMemo<Ctx>(() => ({ isOnPlan, isPending, add }), [isOnPlan, isPending, add]);

  const count = initialCount + added.length;
  const totals = useMemo(() => {
    const byCurrency = new Map<string, number>();
    for (const line of initialTotals) {
      byCurrency.set(line.currency, (byCurrency.get(line.currency) ?? 0) + line.amount);
    }
    for (const item of added) {
      if (item.amount != null && item.currency) {
        byCurrency.set(item.currency, (byCurrency.get(item.currency) ?? 0) + item.amount);
      }
    }
    return Array.from(byCurrency, ([currency, amount]) => ({ currency, amount }));
  }, [initialTotals, added]);

  return (
    <ShortlistCtx.Provider value={value}>
      {children}
      {count > 0 ? (
        <ShortlistBar
          locale={locale}
          planName={planName}
          count={count}
          totals={totals}
          recentTitles={added.map((a) => a.titleName)}
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
  recentTitles,
}: {
  locale: string;
  planName: string;
  count: number;
  totals: LineTotal[];
  recentTitles: string[];
}) {
  const t = useTranslations("catalog.shortlist");
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
          <span className="shortlist-bar__total-amount">
            {totals.length
              ? totals.map((line) => formatMoney(line.amount, line.currency, locale)).join(" · ")
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
  amount,
  currency,
  withContent,
  hasPrice,
  addLabel,
  addedLabel,
  askLabel,
}: {
  productId: string;
  titleName: string;
  amount: number | null;
  currency: string | null;
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
      onClick={() => add({ productId, titleName, amount, currency }, withContent)}
    >
      {onPlan ? `✓ ${addedLabel}` : hasPrice ? addLabel : askLabel}
    </button>
  );
}
