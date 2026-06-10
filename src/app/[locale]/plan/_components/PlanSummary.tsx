import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { PlanBrief } from "@/lib/basket";
import { formatMoney } from "@/lib/money";
import { submitRequest } from "@/app/checkout-actions";
import { AUDIENCE_SEGMENTS } from "@/lib/targeting/segments";
import { SubmitButton } from "@/components";

// Per-currency rollup computed in page.tsx — visible-price lines
// accumulate an amount, locked-price lines only flag their currency.
export type Rollup = { amount: number; hasVisible: boolean; hasHidden: boolean };

// Right column of the split: per-currency totals plus the brief form
// that submits the basket as a firm plan or RFQ.
export async function PlanSummary({
  locale,
  totals,
  hasHiddenPrice,
  allFirm,
  needsClient,
  activeOrg,
  briefDraft,
}: {
  locale: string;
  totals: [string, Rollup][];
  hasHiddenPrice: boolean;
  allFirm: boolean;
  needsClient: boolean;
  activeOrg: { name: string } | null;
  briefDraft: PlanBrief;
}) {
  const t = await getTranslations({ locale, namespace: "plan" });
  const tf = await getTranslations({ locale, namespace: "firm" });
  const tr = await getTranslations({ locale, namespace: "rfq" });
  const tSeg = await getTranslations({ locale, namespace: "targetSegment" });
  const ta = await getTranslations({ locale, namespace: "auth" });
  const tNav = await getTranslations({ locale, namespace: "nav" });
  const tv = await getTranslations({
    locale,
    namespace: "priceVisibility",
  });

  return (
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
  );
}
