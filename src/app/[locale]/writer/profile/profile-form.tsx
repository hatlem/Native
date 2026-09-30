"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { updateWriterProfile } from "@/app/writer-profile-actions";
import {
  MAX_ACTIVE_ASSIGNMENTS_LIMIT,
  PROFILE_CURRENCIES,
  WRITER_PROFILE_IDLE,
  type ProfileField,
  type ProfileFormValues,
} from "@/lib/writers/profile";

const LANGUAGES = ["NO", "SV", "DA", "FI", "DE", "EN"] as const;
const PROFICIENCIES = ["NATIVE", "FLUENT", "WORKING"] as const;
const TOPICS = [
  "FINANCE",
  "HEALTH",
  "TECH",
  "LIFESTYLE",
  "B2B",
  "TRAVEL",
  "FOOD",
  "CULTURE",
  "SUSTAINABILITY",
  "OTHER",
] as const;

export function WriterProfileForm({
  locale,
  values: saved,
}: {
  locale: string;
  values: ProfileFormValues;
}) {
  const t = useTranslations("writer.profile");
  const tEnum = useTranslations("writerEnums");
  const [state, action, pending] = useActionState(updateWriterProfile, WRITER_PROFILE_IDLE);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  };
  // After a rejected save, show what the writer typed, not the saved row.
  const values = state.status === "error" ? state.values : saved;
  const invalid = (f: ProfileField) => state.status === "error" && state.fields.includes(f);
  const errorFor = (f: ProfileField) =>
    invalid(f) ? (
      <span className="err" id={`err-${f}`} role="alert">
        {t(`errors.${f}`)}
      </span>
    ) : null;
  const a11y = (f: ProfileField) =>
    invalid(f) ? { "aria-invalid": true, "aria-describedby": `err-${f}` } : {};

  return (
    // Dispatched from onSubmit instead of letting <form action> run it:
    // React resets a form after an action-attribute submit, and a reset
    // <select> snaps back to the options it was first rendered with — so
    // a rejected save would silently wipe the language levels just chosen
    // (and a later save would store that). `action` stays as the no-JS
    // fallback.
    <form action={action} onSubmit={submit} className="product-form stack-4" noValidate>
      <input type="hidden" name="locale" value={locale} />

      <div aria-live="polite">
        {state.status === "saved" ? (
          <div className="banner-success" role="status">
            <span>{t("saved")}</span>
          </div>
        ) : state.status === "error" ? (
          <div className="banner-error" role="alert">
            <span>{t("fixErrors")}</span>
          </div>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="profile-bio">{t("bio")}</label>
        <textarea
          id="profile-bio"
          name="bio"
          rows={4}
          maxLength={2000}
          defaultValue={values.bio}
          placeholder={t("bioPlaceholder")}
          {...a11y("bio")}
        />
        {errorFor("bio")}
      </div>

      <fieldset className="field" {...a11y("languages")}>
        <legend>{t("languages")}</legend>
        <span className="hint">{t("languagesHint")}</span>
        <div className="grid two">
          {LANGUAGES.map((lang) => (
            <label key={lang} className="field" style={{ margin: 0 }}>
              <span>{tEnum(`language.${lang}`)}</span>
              <select name={`lang_${lang}`} defaultValue={values.languages[lang] ?? ""}>
                <option value="">{t("languageNone")}</option>
                {PROFICIENCIES.map((p) => (
                  <option key={p} value={p}>
                    {tEnum(`proficiency.${p}`)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {errorFor("languages")}
      </fieldset>

      <fieldset className="field">
        <legend>{t("specialties")}</legend>
        <div className="checkbox-grid">
          {TOPICS.map((topic) => (
            <label key={topic} className="checkbox-row">
              <input
                type="checkbox"
                name="specialties"
                value={topic}
                defaultChecked={values.specialties.includes(topic)}
              />
              <span>{tEnum(`topic.${topic}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid two">
        <div className="field">
          <label htmlFor="profile-rate-article">{t("ratePerArticle")}</label>
          <input
            id="profile-rate-article"
            name="ratePerArticle"
            inputMode="decimal"
            defaultValue={values.ratePerArticle}
            {...a11y("ratePerArticle")}
          />
          {errorFor("ratePerArticle")}
        </div>
        <div className="field">
          <label htmlFor="profile-rate-word">{t("ratePerWord")}</label>
          <input
            id="profile-rate-word"
            name="ratePerWord"
            inputMode="decimal"
            defaultValue={values.ratePerWord}
            {...a11y("ratePerWord")}
          />
          {errorFor("ratePerWord")}
        </div>
        <div className="field">
          <label htmlFor="profile-currency">{t("currency")}</label>
          <select
            id="profile-currency"
            name="currency"
            defaultValue={values.currency}
            {...a11y("currency")}
          >
            <option value="">{t("currencyNone")}</option>
            {PROFILE_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {errorFor("currency")}
        </div>
        <div className="field">
          <label htmlFor="profile-max-active">{t("maxActiveAssignments")}</label>
          <input
            id="profile-max-active"
            name="maxActiveAssignments"
            type="number"
            min={1}
            max={MAX_ACTIVE_ASSIGNMENTS_LIMIT}
            step={1}
            defaultValue={values.maxActiveAssignments}
            {...a11y("maxActiveAssignments")}
          />
          <span className="hint">{t("maxActiveAssignmentsHint")}</span>
          {errorFor("maxActiveAssignments")}
        </div>
      </div>

      <div className="field">
        <label htmlFor="profile-portfolio">{t("portfolioUrl")}</label>
        <input
          id="profile-portfolio"
          name="portfolioUrl"
          type="url"
          inputMode="url"
          placeholder="https://"
          defaultValue={values.portfolioUrl}
          {...a11y("portfolioUrl")}
        />
        {errorFor("portfolioUrl")}
      </div>

      <label className="checkbox-row">
        <input type="checkbox" name="active" defaultChecked={values.active} />
        <span>{t("active")}</span>
      </label>

      <div className="actions">
        <button type="submit" className="btn primary" disabled={pending} aria-disabled={pending}>
          {pending ? t("saving") : t("save")}
        </button>
      </div>
    </form>
  );
}
