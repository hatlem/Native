"use client";

import { useActionState, useEffect, useRef, type RefObject } from "react";
import { useTranslations } from "next-intl";
import {
  deactivateOwnAccount,
  setPassword,
  updateProfile,
} from "@/app/account-actions";
import { requestEmailChange } from "@/app/account-email-actions";
import { SubmitButton } from "@/components/submit-button";
import { accountErrorKey } from "@/lib/account-messages";
import { accountErrorFieldId } from "@/lib/account-error-field";
import {
  INITIAL_ACCOUNT_FORM_STATE,
  type AccountFormState,
} from "@/lib/account-form-state";

// The four /account forms that validate what the person typed: profile,
// sign-in email, password and deactivation. Each is a useActionState form —
// a refusal comes back as state and renders next to the field it is about
// (aria-invalid + aria-describedby, focus moved there) with the input still
// in place. Nothing typed travels in the URL, and passwords are never echoed.

type Translate = ReturnType<typeof useTranslations>;

// What a form needs to show its error: the message, and the id of the input
// it belongs to (null → a form-level banner).
function useFormError(state: AccountFormState, t: Translate, formRef: RefObject<HTMLFormElement | null>) {
  const key = accountErrorKey(state.error ?? undefined);
  const message = key ? t(key) : null;
  const fieldId = accountErrorFieldId(state.error ?? undefined);

  // After a failed submit, land on the field to fix (or the banner).
  useEffect(() => {
    if (!state.error) return;
    const form = formRef.current;
    if (!form) return;
    const target = fieldId
      ? form.querySelector<HTMLElement>(`#${fieldId}`)
      : form.querySelector<HTMLElement>("[data-form-error]");
    target?.focus();
  }, [state, fieldId, formRef]);

  const errId = (id: string) => `${id}-error`;
  return {
    message,
    fieldId,
    // Props for an input: invalid + described by its error (or its hint).
    aria: (id: string, hintId?: string) => ({
      "aria-invalid": fieldId === id ? (true as const) : undefined,
      "aria-describedby": fieldId === id ? errId(id) : hintId,
    }),
    // The error line under a field, when the error is about that field.
    fieldError: (id: string) =>
      fieldId === id && message ? (
        <span className="err" id={errId(id)} role="alert">
          {message}
        </span>
      ) : null,
    // The banner for an error that is about the form as a whole.
    banner:
      message && !fieldId ? (
        <div className="banner-error" role="alert" tabIndex={-1} data-form-error>
          <span>{message}</span>
        </div>
      ) : null,
  };
}

export function ProfileForm({
  locale,
  email,
  name,
  phone,
}: {
  locale: string;
  email: string;
  name: string;
  phone: string;
}) {
  const t = useTranslations("account");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(updateProfile, INITIAL_ACCOUNT_FORM_STATE);
  const err = useFormError(state, t, formRef);
  // After a refusal the form shows what was typed, not what is stored.
  const nameValue = state.error ? (state.values.name ?? "") : name;
  const phoneValue = state.error ? (state.values.phone ?? "") : phone;

  return (
    <form action={formAction} className="product-form card" noValidate ref={formRef}>
      <input type="hidden" name="locale" value={locale} />
      {err.banner}
      <div className="field">
        <label htmlFor="acc-email">{t("emailLabel")}</label>
        <input id="acc-email" type="email" value={email} disabled readOnly />
        <span className="hint">{t("emailHint")}</span>
      </div>
      <div className="field">
        <label htmlFor="acc-name">
          {t("nameLabel")} <span className="optional">({t("optional")})</span>
        </label>
        <input
          id="acc-name"
          name="name"
          autoComplete="name"
          // key: React keeps an uncontrolled input's DOM value across
          // re-renders; re-mount so the returned value is what shows.
          key={`name-${nameValue}`}
          defaultValue={nameValue}
        />
      </div>
      <div className="field">
        <label htmlFor="acc-phone">{t("phoneLabel")}</label>
        <input
          id="acc-phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          key={`phone-${phoneValue}`}
          defaultValue={phoneValue}
          placeholder="+47 ..."
          {...err.aria("acc-phone", "acc-phone-hint")}
        />
        {err.fieldError("acc-phone") ?? (
          <span className="hint" id="acc-phone-hint">
            {t("phoneHint")}
          </span>
        )}
      </div>
      <div className="actions">
        <SubmitButton label={t("saveProfile")} pendingLabel={t("saving")} />
      </div>
    </form>
  );
}

export function EmailChangeForm({ locale, hasPassword }: { locale: string; hasPassword: boolean }) {
  const t = useTranslations("account");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(requestEmailChange, INITIAL_ACCOUNT_FORM_STATE);
  const err = useFormError(state, t, formRef);
  const newEmail = state.values.newEmail ?? "";

  return (
    <form action={formAction} className="product-form card" noValidate ref={formRef}>
      <input type="hidden" name="locale" value={locale} />
      {err.banner}
      <div className="field">
        <label htmlFor="acc-new-email">{t("newEmailLabel")}</label>
        <input
          id="acc-new-email"
          name="newEmail"
          type="email"
          autoComplete="email"
          required
          key={`new-email-${newEmail}`}
          defaultValue={newEmail}
          placeholder={t("newEmailPlaceholder")}
          {...err.aria("acc-new-email", "acc-new-email-hint")}
        />
        {err.fieldError("acc-new-email") ?? (
          <span className="hint" id="acc-new-email-hint">
            {t("emailChangeHint")}
          </span>
        )}
      </div>
      {hasPassword ? (
        <div className="field">
          <label htmlFor="acc-email-pw">{t("currentPasswordLabel")}</label>
          <input
            id="acc-email-pw"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            {...err.aria("acc-email-pw")}
          />
          {err.fieldError("acc-email-pw")}
        </div>
      ) : null}
      <div className="actions">
        <SubmitButton label={t("saveEmail")} pendingLabel={t("saving")} />
      </div>
    </form>
  );
}

export function PasswordForm({ locale, hasPassword }: { locale: string; hasPassword: boolean }) {
  const t = useTranslations("account");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(setPassword, INITIAL_ACCOUNT_FORM_STATE);
  const err = useFormError(state, t, formRef);

  return (
    <form action={formAction} className="product-form card" noValidate ref={formRef}>
      <input type="hidden" name="locale" value={locale} />
      {err.banner}
      {hasPassword ? (
        <div className="field">
          <label htmlFor="acc-pw-current">{t("currentPasswordLabel")}</label>
          <input
            id="acc-pw-current"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            {...err.aria("acc-pw-current")}
          />
          {err.fieldError("acc-pw-current")}
        </div>
      ) : (
        <p className="muted small">{t("passwordlessNote")}</p>
      )}
      <div className="field">
        <label htmlFor="acc-pw-new">{t("newPasswordLabel")}</label>
        <input
          id="acc-pw-new"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          {...err.aria("acc-pw-new", "acc-pw-new-hint")}
        />
        {err.fieldError("acc-pw-new") ?? (
          <span className="hint" id="acc-pw-new-hint">
            {t("pwHint")}
          </span>
        )}
      </div>
      <div className="actions">
        <SubmitButton
          label={hasPassword ? t("savePasswordChange") : t("savePasswordSet")}
          pendingLabel={t("saving")}
        />
      </div>
    </form>
  );
}

export function DeactivateForm({ locale, email }: { locale: string; email: string }) {
  const t = useTranslations("account");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(deactivateOwnAccount, INITIAL_ACCOUNT_FORM_STATE);
  const err = useFormError(state, t, formRef);
  const typed = state.values.confirmEmail ?? "";
  const erase = state.values.eraseData === "on";

  return (
    <form action={formAction} className="product-form" noValidate ref={formRef}>
      <input type="hidden" name="locale" value={locale} />
      <h3 style={{ margin: "12px 0 4px" }}>{t("deactivateTitle")}</h3>
      <p className="muted small">{t("deactivateHint")}</p>
      {err.banner}
      <div className="field">
        <label htmlFor="acc-deactivate-confirm">{t("deactivateConfirmLabel")}</label>
        <input
          id="acc-deactivate-confirm"
          name="confirmEmail"
          type="email"
          autoComplete="off"
          required
          key={`confirm-${typed}`}
          defaultValue={typed}
          placeholder={email}
          {...err.aria("acc-deactivate-confirm")}
        />
        {err.fieldError("acc-deactivate-confirm")}
      </div>
      {/* Erasure: off by default — a deactivated account can be switched
          back on, an erased one cannot. */}
      <div className="field">
        <label className="checkbox" htmlFor="acc-erase-data">
          <input
            id="acc-erase-data"
            name="eraseData"
            type="checkbox"
            key={`erase-${erase}`}
            defaultChecked={erase}
          />{" "}
          {t("eraseDataLabel")}
        </label>
        <p className="muted small">{t("eraseDataHint")}</p>
      </div>
      <div className="actions">
        <SubmitButton
          label={t("deactivateButton")}
          pendingLabel={t("deactivating")}
          className="btn danger block"
        />
      </div>
    </form>
  );
}
