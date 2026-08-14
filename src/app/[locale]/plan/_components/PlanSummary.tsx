import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { PlanBrief } from "@/lib/basket";
import { formatMoney } from "@/lib/money";
import { submitRequest } from "@/app/checkout-actions";
import { SubmitButton } from "@/components";
import { PlanBriefFields } from "./PlanBriefFields";

// Per-currency rollup computed in page.tsx — visible-price lines
// accumulate an amount, locked-price lines only flag their currency.
// itemCount is what turns "SEK 95,565 + €92" from a puzzle (is that a
// choice of currency to pay in?) into a plain fact: two currencies, each
// tied to the titles actually priced in it, both due.
export type Rollup = { amount: number; hasVisible: boolean; hasHidden: boolean; itemCount: number };

// Right column, top card: per-currency totals, the instant-book split, and
// the brief form that submits the basket as a firm plan or RFQ. The
// "What happens next" card is a sibling, rendered by page.tsx — this
// component owns only the summary + form.
export async function PlanSummary({
  locale,
  totals,
  hasHiddenPrice,
  allFirm,
  firmLineCount,
  lineCount,
  needsClient,
  activeOrg,
  briefDraft,
}: {
  locale: string;
  totals: [string, Rollup][];
  hasHiddenPrice: boolean;
  allFirm: boolean;
  firmLineCount: number;
  lineCount: number;
  needsClient: boolean;
  activeOrg: { name: string } | null;
  briefDraft: PlanBrief;
}) {
  const t = await getTranslations({ locale, namespace: "plan" });
  const tf = await getTranslations({ locale, namespace: "firm" });
  const tr = await getTranslations({ locale, namespace: "rfq" });
  const ta = await getTranslations({ locale, namespace: "auth" });
  const tNav = await getTranslations({ locale, namespace: "nav" });
  const tv = await getTranslations({ locale, namespace: "priceVisibility" });

  // Only compare the budget field against a single-currency total — a
  // mixed-currency basket has no one number to warn against.
  const visibleTotals = totals.filter(([, r]) => r.hasVisible);
  const singleTotal = visibleTotals.length === 1 ? visibleTotals[0] : null;

  return (
    <>
    <aside className="plan-summary">
      <div className="plan-summary-head">
        <span className="muted small">{t("estTotal")}</span>
        {firmLineCount > 0 && firmLineCount < lineCount ? (
          <span className="badge badge-info dotless plan-summary-firm-pill">
            ⚡ {t("firmOfTotal", { firm: firmLineCount, total: lineCount })}
          </span>
        ) : allFirm ? (
          <span className="badge badge-info dotless">⚡ {tf("badge")}</span>
        ) : null}
      </div>
      <div className="plan-summary-total">
        {totals
          .filter(([, r]) => r.hasVisible)
          .map(([cur, r]) => (
            <div className="price" key={cur}>
              {formatMoney(r.amount, cur, locale)}
              {r.hasHidden ? <span className="muted small"> + {tv("requestPrice")}</span> : null}
            </div>
          ))}
        {visibleTotals.length > 1 ? (
          <p className="plan-summary-note">{t("multiCurrencyNote")}</p>
        ) : null}
        {hasHiddenPrice && !totals.some(([, r]) => r.hasVisible) ? (
          <div className="muted small">{t("pricingOnRequest")}</div>
        ) : null}
      </div>
      {hasHiddenPrice ? <p className="plan-summary-note">{t("plusDeskPriced")}</p> : null}

      <div className="plan-summary-divider" />

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
        <form id="plan-request-form" action={submitRequest} className="product-form">
          <input type="hidden" name="locale" value={locale} />
          <p className="muted small">
            {tr("requestingAs")}: <strong>{activeOrg.name}</strong>
          </p>
          <PlanBriefFields
            locale={locale}
            briefDraft={briefDraft}
            currency={singleTotal ? singleTotal[0] : null}
            total={singleTotal ? singleTotal[1].amount : 0}
          />
          {/* Mobile-only submit lives in the sticky bottom bar below (same
              form, via the form="" attribute) — this one stays for desktop,
              where there's no fixed bottom bar to duplicate it into. */}
          <SubmitButton
            label={allFirm ? tf("planSubmit") : tr("submit")}
            pendingLabel={allFirm ? tf("planSubmitting") : tr("submitting")}
            className="btn block plan-summary-submit-desktop"
          />
          <p className="plan-summary-reassurance">{t("reassurance")}</p>
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

    {!needsClient && activeOrg ? (
      <div className="plan-mobile-submit-bar">
        <div className="plan-mobile-submit-bar__total">
          <span className="plan-mobile-submit-bar__label">{t("estTotal")}</span>
          <span className="plan-mobile-submit-bar__amount">
            {visibleTotals.length > 0
              ? visibleTotals.length > 1
                ? visibleTotals
                    .map(([cur, r]) =>
                      t("totalForItems", { amount: formatMoney(r.amount, cur, locale), count: r.itemCount }),
                    )
                    .join(" + ")
                : formatMoney(visibleTotals[0][1].amount, visibleTotals[0][0], locale)
              : t("pricingOnRequest")}
          </span>
        </div>
        <button type="submit" form="plan-request-form" className="btn block">
          {allFirm ? tf("planSubmit") : tr("submit")}
        </button>
        <p className="plan-mobile-submit-bar__reassurance">{t("reassurance")}</p>
      </div>
    ) : null}
    </>
  );
}
