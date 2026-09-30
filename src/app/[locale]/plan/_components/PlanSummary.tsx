import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { PlanBriefValues, TimingOption } from "@/lib/plan-brief";
import { formatMoney } from "@/lib/money";
import { hasFigure, type ListTotal } from "@/lib/plan-total";
import { totalFloor, totalLabel } from "@/lib/pricing/total-label";
import { submitRequest } from "@/app/checkout-actions";
import { SubmitButton } from "@/components";
import { PlanBriefFields } from "./PlanBriefFields";

// Right column, top card: per-currency totals, the instant-book split, and
// the brief form that submits the basket as a firm plan or RFQ. The
// "What happens next" card is a sibling, rendered by page.tsx — this
// component owns only the summary + form.
//
// `totals` come from estimateListTotals — the same engine the order prices
// with, content fees included. Instant-orderable lines add up exactly; every
// other priced line adds its price band, so a mixed plan reads
// "45 000 kr + ≈ 40–60k NOK" (lib/pricing/total-label.ts). Shown excluding VAT
// (how the desk quotes and the catalog lists prices), with the VAT-inclusive
// figure of the exact part beside it; on the instant path (every line exact)
// the VAT-inclusive amount is repeated at the button, because that click is
// the commitment.
export async function PlanSummary({
  locale,
  listId,
  totals,
  hasHiddenPrice,
  allFirm,
  canCommit,
  firmLineCount,
  lineCount,
  needsClient,
  activeOrg,
  brief,
  timingOptions,
  readOnly = false,
}: {
  locale: string;
  // The plan this page shows. Submit acts on it, never on the active-list
  // cookie, which may name a plan another tab opened since (lib/plan-target.ts).
  listId: string;
  totals: ListTotal[];
  hasHiddenPrice: boolean;
  allFirm: boolean;
  // Whether the viewer may commit the active org to an order (canCommitOnOrg).
  // A member without it gets the RFQ path for an all-firm plan instead of a
  // "Confirm order" button the server would refuse.
  canCommit: boolean;
  firmLineCount: number;
  lineCount: number;
  needsClient: boolean;
  activeOrg: { name: string } | null;
  brief: PlanBriefValues;
  timingOptions: TimingOption[];
  // View-only seat: the totals are shown, the brief form and the send/order
  // button are not (submitRequest refuses a view-only seat anyway).
  readOnly?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "plan" });
  const tf = await getTranslations({ locale, namespace: "firm" });
  const tr = await getTranslations({ locale, namespace: "rfq" });
  const ta = await getTranslations({ locale, namespace: "auth" });
  const tNav = await getTranslations({ locale, namespace: "nav" });
  const tv = await getTranslations({ locale, namespace: "priceVisibility" });

  // Submitting instantly creates a confirmed order — only when every line is
  // instant-orderable AND the viewer holds ordering rights.
  const instant = allFirm && canCommit;
  // An all-firm plan the viewer can't commit: sent as an RFQ (mode=rfq) so an
  // admin accepts the desk's quote — the server honours the same flag.
  const rfqInstead = allFirm && !canCommit;

  // Only compare the budget field against a single-currency total — a
  // mixed-currency basket has no one number to warn against.
  const visibleTotals = totals.filter(hasFigure);
  const singleTotal = visibleTotals.length === 1 ? visibleTotals[0] : null;
  const money = (amount: number, currency: string) => formatMoney(amount, currency, locale);
  // Exact part and/or band range, the one format every plan surface uses.
  const label = (r: ListTotal) => totalLabel(r, locale) ?? "";

  // "25 741 kr" or, across currencies, "SEK 95 565 for 4 titles + €92 for 1 title".
  const joinTotals = (format: (r: ListTotal) => string) =>
    visibleTotals.length > 1
      ? visibleTotals
          .map((r) => t("totalForItems", { amount: format(r), count: r.itemCount }))
          .join(" + ")
      : visibleTotals.length === 1
        ? format(visibleTotals[0])
        : null;
  // The instant path only exists when every line is exact, so the commitment
  // is always an exact, VAT-inclusive figure.
  const commitAmount = instant ? joinTotals((r) => money(r.totalInclVat, r.currency)) : null;
  const anyEstimate = visibleTotals.some((r) => r.estimate !== null);

  const submitLabel = instant ? tf("planSubmit") : rfqInstead ? tf("sendAsRfq") : tr("submit");
  const reassurance = instant ? tf("reassurance") : t("reassurance");
  // A plan whose every line sits among the alternatives has nothing to send:
  // say so at the button instead of letting the submit bounce.
  const nothingToSend = lineCount === 0;

  return (
    <>
    <aside className="plan-summary">
      <div className="plan-summary-head">
        <span className="muted small">{instant ? tf("orderTotal") : t("estTotal")}</span>
        {firmLineCount > 0 && firmLineCount < lineCount ? (
          <span className="badge badge-info dotless plan-summary-firm-pill">
            {t("firmOfTotal", { firm: firmLineCount, total: lineCount })}
          </span>
        ) : allFirm ? (
          <span className="badge badge-info dotless">⚡ {tf("badge")}</span>
        ) : null}
      </div>
      <div className="plan-summary-total">
        {visibleTotals.map((r) => (
          <div key={r.currency}>
            <div className="price">
              {label(r)} <span className="muted small">{t("exVat")}</span>
              {r.hasOnRequest ? <span className="muted small"> + {tv("requestPrice")}</span> : null}
            </div>
            {/* The content-fee split and the VAT-inclusive figure are exact
                arithmetic, so they only describe the exact (instant-orderable)
                part; a band has no exact VAT to add. */}
            {r.hasExact && !r.estimate && r.contentFees > 0 ? (
              <p className="plan-summary-note">
                {t("includesContentFees", { amount: money(r.contentFees, r.currency) })}
              </p>
            ) : null}
            {r.hasExact ? (
              <p className="plan-summary-note">
                {r.estimate
                  ? t("inclVatFirmPart", { amount: money(r.totalInclVat, r.currency) })
                  : t("inclVatLine", { amount: money(r.totalInclVat, r.currency) })}
              </p>
            ) : null}
          </div>
        ))}
        {anyEstimate ? <p className="plan-summary-note">{t("estimateNote")}</p> : null}
        {visibleTotals.length > 1 ? (
          <p className="plan-summary-note">{t("multiCurrencyNote")}</p>
        ) : null}
        {hasHiddenPrice && visibleTotals.length === 0 ? (
          <div className="muted small">{t("pricingOnRequest")}</div>
        ) : null}
      </div>
      {hasHiddenPrice ? <p className="plan-summary-note">{t("plusDeskPriced")}</p> : null}

      {readOnly ? null : (
      <>
      <div className="plan-summary-divider" />

      <h3>{instant ? tf("planTitle") : t("rfqTitle")}</h3>
      {instant ? <p className="muted small">{tf("planNote")}</p> : null}
      {rfqInstead ? (
        <p className="muted small" role="note">
          {tf("noCommitNote")}
        </p>
      ) : null}

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
          <input type="hidden" name="listId" value={listId} />
          {rfqInstead ? <input type="hidden" name="mode" value="rfq" /> : null}
          <p className="muted small">
            {tr("requestingAs")}: <strong>{activeOrg.name}</strong>
          </p>
          <PlanBriefFields
            locale={locale}
            listId={listId}
            initial={brief}
            timingOptions={timingOptions}
            currency={singleTotal ? singleTotal.currency : null}
            totalFloor={singleTotal ? totalFloor(singleTotal) : 0}
            totalLabel={singleTotal ? label(singleTotal) : ""}
          />
          {commitAmount ? (
            <p className="plan-summary-commit">{tf("commitAmount", { amount: commitAmount })}</p>
          ) : null}
          {/* Mobile-only submit lives in the sticky bottom bar below (same
              form, via the form="" attribute) — this one stays for desktop,
              where there's no fixed bottom bar to duplicate it into. */}
          <SubmitButton
            label={submitLabel}
            pendingLabel={instant ? tf("planSubmitting") : tr("submitting")}
            className="btn block plan-summary-submit-desktop"
            disabled={nothingToSend}
          />
          <p className="plan-summary-reassurance">{nothingToSend ? t("nothingToSend") : reassurance}</p>
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
      </>
      )}
    </aside>

    {!needsClient && activeOrg && !readOnly ? (
      <div className="plan-mobile-submit-bar">
        <div className="plan-mobile-submit-bar__total">
          <span className="plan-mobile-submit-bar__label">
            {instant ? tf("orderTotal") : t("estTotal")}
          </span>
          <span className="plan-mobile-submit-bar__amount">
            {instant
              ? t("inclVatLine", { amount: commitAmount ?? "" })
              : visibleTotals.length > 0
                ? `${joinTotals(label)} ${t("exVat")}`
                : t("pricingOnRequest")}
          </span>
        </div>
        <button type="submit" form="plan-request-form" className="btn block" disabled={nothingToSend}>
          {submitLabel}
        </button>
        <p className="plan-mobile-submit-bar__reassurance">{nothingToSend ? t("nothingToSend") : reassurance}</p>
      </div>
    ) : null}
    </>
  );
}
