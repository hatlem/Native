"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { register } from "@/app/signup-actions";
import { SubmitButton } from "@/components/submit-button";
import {
  INITIAL_SIGNUP_STATE,
  signupErrorField,
  signupErrorMessageKey,
} from "@/lib/signup-form-state";
import { EmailTypoPrompt } from "./email-typo-prompt";

// The sign-up form. Validation errors come back as action state and render
// next to the field they belong to (aria-invalid + aria-describedby), with
// everything the person typed still in place — nothing travels in the URL.
export function SignupForm({ locale }: { locale: string }) {
  const t = useTranslations("auth");
  const [state, formAction] = useActionState(register, INITIAL_SIGNUP_STATE);
  const field = signupErrorField(state.error, state.values);
  const messageKey = signupErrorMessageKey(state.error, field);
  const message = messageKey ? t(messageKey) : null;
  const formRef = useRef<HTMLFormElement>(null);

  // Move focus to the field that needs fixing after a failed submit.
  useEffect(() => {
    if (!state.error || !field) return;
    formRef.current?.querySelector<HTMLInputElement>(`#${field}`)?.focus();
  }, [state, field]);

  const typo = state.error === "email_typo" && state.typoSuggestion && state.typedDomain;
  const errId = (f: string) => `${f}-error`;

  return (
    <>
      {message && !field ? (
        <div className="banner-error" role="alert">
          <span>{message}</span>
        </div>
      ) : null}

      <form action={formAction} noValidate ref={formRef}>
        <input type="hidden" name="locale" value={locale} />
        <div className="field">
          <label htmlFor="name">
            {t("name")} <span className="optional">({t("optional")})</span>
          </label>
          <input id="name" name="name" autoComplete="name" autoFocus defaultValue={state.values.name} />
        </div>
        <div className="field">
          <label htmlFor="orgName">{t("org")}</label>
          <input
            id="orgName"
            name="orgName"
            autoComplete="organization"
            required
            defaultValue={state.values.orgName}
            aria-invalid={field === "orgName" ? true : undefined}
            aria-describedby={field === "orgName" ? errId("orgName") : undefined}
          />
          {field === "orgName" && message ? (
            <span className="err" id={errId("orgName")} role="alert">
              {message}
            </span>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="email">{t("email")}</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            // key: React keeps an uncontrolled input's DOM value across
            // re-renders; re-mount so the returned value is what shows.
            key={`email-${state.values.email}`}
            defaultValue={state.values.email}
            aria-invalid={field === "email" ? true : undefined}
            aria-describedby={field === "email" ? (typo ? "email-typo" : errId("email")) : undefined}
          />
          {field === "email" && message ? (
            <span className="err" id={errId("email")} role="alert">
              {message}
            </span>
          ) : null}
          {typo ? (
            <EmailTypoPrompt
              id="email-typo"
              inputId="email"
              suggestion={state.typoSuggestion!}
              typedDomain={state.typedDomain!}
              question={t.rich("regEmailTypoQuestion", {
                email: state.typoSuggestion!,
                b: (chunks) => <strong>{chunks}</strong>,
              })}
              useLabel={t("regEmailTypoUse", { email: state.typoSuggestion! })}
              keepHint={t("regEmailTypoKeep", { domain: state.typedDomain! })}
            />
          ) : null}
        </div>

        {/* Password is optional; the disclosure opens itself when the error is about it. */}
        <details className="signup-password-disclosure" open={field === "password" ? true : undefined}>
          <summary>{t("setPasswordSummary")}</summary>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="password">
              {t("password")} <span className="optional">({t("optional")})</span>
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              aria-invalid={field === "password" ? true : undefined}
              aria-describedby={field === "password" ? errId("password") : "password-hint"}
            />
            {field === "password" && message ? (
              <span className="err" id={errId("password")} role="alert">
                {message}
              </span>
            ) : (
              <span className="hint" id="password-hint">
                {t("pwHintOptional")}
              </span>
            )}
          </div>
        </details>

        <p className="muted small" style={{ marginTop: 8 }}>
          {t("magicLinkSignupNote")}
        </p>

        <div className="actions">
          <SubmitButton label={t("createAccount")} pendingLabel={t("creatingAccount")} />
        </div>
      </form>
    </>
  );
}
