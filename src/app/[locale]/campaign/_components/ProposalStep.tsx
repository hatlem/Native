import { getTranslations } from "next-intl/server";
import { BusinessType } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { submitRequest } from "@/app/checkout-actions";
import { saveKyc } from "@/app/campaign-actions";
import { SubmitButton } from "@/components";
import type { ActiveList } from "@/lib/lists";
import { kycComplete, type KycFields } from "@/lib/campaign-kyc";

type KycValues = KycFields & { addressLine2: string | null };

type Props = {
  locale: string;
  items: ActiveList["items"];
  kyc: KycValues | null;
};

const BUSINESS_TYPES = Object.values(BusinessType);

// Build proposal: the final step. Reuses the existing submitRequest engine
// (firm-order vs desk-RFQ decided server-side from the shortlist) — we only
// gather the campaign framing the publishers/desk see. No new commerce code.
export async function ProposalStep({ locale, items, kyc }: Props) {
  const t = await getTranslations({ locale, namespace: "campaign" });
  const showKyc = kyc !== null && !kycComplete(kyc);

  if (items.length === 0) {
    return (
      <section className="card campaign-step-body">
        <p className="muted">{t("proposalEmpty")}</p>
        <Link href="/campaign?step=discover" className="btn small">
          {t("backToDiscover")}
        </Link>
      </section>
    );
  }

  return (
    <div className="proposal-step">
      {showKyc ? (
        <form action={saveKyc} className="kyc-panel card">
          <div className="kyc-panel-head">
            <strong>{t("kycTitle")}</strong>
            <span className="kyc-soft">{t("kycOptional")}</span>
          </div>
          <p className="muted small">{t("kycLead")}</p>
          <input type="hidden" name="locale" value={locale} />
          <div className="kyc-grid">
            <label className="proposal-field">
              <span className="label">{t("kycBusinessType")}</span>
              <select name="businessType" defaultValue={kyc?.businessType ?? ""}>
                <option value="">{t("kycChoose")}</option>
                {BUSINESS_TYPES.map((bt) => (
                  <option key={bt} value={bt}>
                    {t(`kycType_${bt}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="proposal-field">
              <span className="label">{t("kycLegalName")}</span>
              <input type="text" name="legalName" defaultValue={kyc?.legalName ?? ""} />
            </label>
            <label className="proposal-field">
              <span className="label">{t("kycBillingEmail")}</span>
              <input type="email" name="billingEmail" defaultValue={kyc?.billingEmail ?? ""} />
            </label>
            <label className="proposal-field">
              <span className="label">{t("kycAddress1")}</span>
              <input type="text" name="addressLine1" defaultValue={kyc?.addressLine1 ?? ""} />
            </label>
            <label className="proposal-field">
              <span className="label">{t("kycAddress2")}</span>
              <input type="text" name="addressLine2" defaultValue={kyc?.addressLine2 ?? ""} />
            </label>
            <label className="proposal-field">
              <span className="label">{t("kycPostal")}</span>
              <input type="text" name="postalCode" defaultValue={kyc?.postalCode ?? ""} />
            </label>
            <label className="proposal-field">
              <span className="label">{t("kycCity")}</span>
              <input type="text" name="city" defaultValue={kyc?.city ?? ""} />
            </label>
          </div>
          <button type="submit" className="btn small">
            {t("kycSave")}
          </button>
        </form>
      ) : null}

      <p className="muted">{t("proposalLead")}</p>
      <form action={submitRequest} className="proposal-form card">
        <input type="hidden" name="locale" value={locale} />
        <label className="proposal-field">
          <span className="label">{t("proposalName")}</span>
          <input type="text" name="goal" required placeholder={t("proposalNamePlaceholder")} />
        </label>
        <label className="proposal-field">
          <span className="label">{t("proposalBudget")}</span>
          <input type="number" name="budget" min="0" step="1000" placeholder={t("proposalBudgetPlaceholder")} />
        </label>
        <label className="proposal-field">
          <span className="label">{t("proposalMessage")}</span>
          <textarea name="brief" rows={4} maxLength={4000} placeholder={t("proposalMessagePlaceholder")} />
        </label>
        <p className="muted small">{t("proposalNote")}</p>
        <div className="proposal-actions">
          <Link href="/campaign?step=schedule" className="btn ghost small">
            {t("back")}
          </Link>
          <SubmitButton
            label={t("proposalSubmit")}
            pendingLabel={t("proposalSubmitting")}
            className="btn small"
          />
        </div>
      </form>
    </div>
  );
}
