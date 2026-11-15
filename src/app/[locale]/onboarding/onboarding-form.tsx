"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { saveOnboarding } from "@/app/onboarding-actions";
import { SubmitButton } from "@/components/submit-button";
import { INITIAL_ONBOARDING_STATE } from "@/lib/onboarding-form-state";

// First-time onboarding form. Errors come back as action state and are tied
// to their field (aria-invalid + aria-describedby); typed values are kept.
export function OnboardingForm({
  locale,
  next,
  markets,
  defaultMarket,
  defaultPhone,
}: {
  locale: string;
  next: string;
  markets: { value: string; label: string }[];
  defaultMarket: string;
  defaultPhone: string;
}) {
  const t = useTranslations("onboarding");
  const [state, formAction] = useActionState(saveOnboarding, INITIAL_ONBOARDING_STATE);
  const submitted = state !== INITIAL_ONBOARDING_STATE;
  const market = submitted ? state.values.market : defaultMarket;
  const phone = submitted ? state.values.phone : defaultPhone;

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor="market">{t("marketLabel")}</label>
        <select
          id="market"
          name="market"
          key={`market-${market}`}
          defaultValue={markets.some((m) => m.value === market) ? market : ""}
          required
          aria-invalid={state.errors.market ? true : undefined}
          aria-describedby={state.errors.market ? "market-err" : "market-hint"}
        >
          <option value="" disabled>
            {t("marketPlaceholder")}
          </option>
          {markets.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        {state.errors.market ? (
          <span className="err" id="market-err" role="alert">
            {t("marketError")}
          </span>
        ) : (
          <span className="hint" id="market-hint">
            {t("marketHint")}
          </span>
        )}
      </div>

      <div className="field">
        <label htmlFor="phone">{t("phoneLabel")}</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          key={`phone-${phone}`}
          defaultValue={phone}
          required
          placeholder={t("phonePlaceholder")}
          aria-invalid={state.errors.phone ? true : undefined}
          aria-describedby={state.errors.phone ? "phone-err" : "phone-hint"}
        />
        {state.errors.phone ? (
          <span className="err" id="phone-err" role="alert">
            {t("phoneError")}
          </span>
        ) : (
          <span className="hint" id="phone-hint">
            {t("phoneHint")}
          </span>
        )}
      </div>

      <div className="actions">
        <SubmitButton label={t("submit")} pendingLabel={t("submitting")} />
      </div>
    </form>
  );
}
