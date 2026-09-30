"use client";

import { useActionState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { sendContactMessage, type ContactFormState } from "@/app/contact-actions";
import type { ContactField } from "@/lib/contact/validate";
import { withSafeEmails } from "@/components/safe-email";

const initial: ContactFormState = { status: "idle" };

export function ContactForm({ children }: { children?: ReactNode }) {
  const t = useTranslations("contact");
  const locale = useLocale();
  const [state, action, pending] = useActionState(sendContactMessage, initial);

  if (state.status === "sent") {
    return (
      <div className="auth-card contact-sent" role="status">
        <div className="head">
          <h2>{t("sentTitle")}</h2>
          <p>{t("sentBody")}</p>
        </div>
      </div>
    );
  }

  const failed = state.status === "error" ? state : null;
  const value = (f: ContactField) => failed?.values[f] ?? "";
  const fieldError = (f: ContactField) => {
    const code = failed?.fieldErrors?.[f];
    if (!code) return null;
    return code === "too_long"
      ? t("errTooLong")
      : code === "invalid"
        ? f === "email"
          ? t("errEmail")
          : t("errInvalid")
        : t("errRequired");
  };
  // Remount the fields with the echoed values after a failed submit — React
  // resets an uncontrolled form once its action settles.
  const formKey = failed ? JSON.stringify(failed.values) : "fresh";

  return (
    <form className="auth-card" action={action} noValidate key={formKey}>
      <div className="head">
        <h2>{t("formCardTitle")}</h2>
        <p>{t("formCardLead")}</p>
      </div>

      {failed && failed.error !== "fields" ? (
        <div className="banner-error" role="alert">
          <span>
            {failed.error === "rate" ? t("errRate") : withSafeEmails(t("errSend"))}
          </span>
        </div>
      ) : null}

      <input type="hidden" name="locale" value={locale} />
      {/* Honeypot: visually hidden, must stay empty (same as the newsletter). */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="newsletter-hp"
      />

      <Field id="contact-name" label={t("name")} error={fieldError("name")}>
        <input
          id="contact-name"
          name="name"
          required
          maxLength={120}
          autoComplete="name"
          defaultValue={value("name")}
          aria-invalid={!!fieldError("name")}
          aria-describedby={fieldError("name") ? "contact-name-err" : undefined}
        />
      </Field>
      <Field id="contact-email" label={t("email")} error={fieldError("email")}>
        <input
          id="contact-email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          defaultValue={value("email")}
          aria-invalid={!!fieldError("email")}
          aria-describedby={fieldError("email") ? "contact-email-err" : undefined}
        />
      </Field>
      <Field id="contact-organisation" label={t("org")} error={fieldError("organisation")}>
        <input
          id="contact-organisation"
          name="organisation"
          maxLength={160}
          autoComplete="organization"
          defaultValue={value("organisation")}
        />
      </Field>
      <Field id="contact-role" label={t("role")} error={fieldError("role")}>
        <select id="contact-role" name="role" defaultValue={value("role") || "advertiser"}>
          <option value="advertiser">{t("roleAdvertiser")}</option>
          <option value="agency">{t("roleAgency")}</option>
          <option value="publisher">{t("rolePublisher")}</option>
          <option value="other">{t("roleOther")}</option>
        </select>
      </Field>
      <Field id="contact-message" label={t("message")} error={fieldError("message")}>
        <textarea
          id="contact-message"
          name="message"
          rows={5}
          required
          maxLength={5000}
          placeholder={t("messagePlaceholder")}
          defaultValue={value("message")}
          aria-invalid={!!fieldError("message")}
          aria-describedby={fieldError("message") ? "contact-message-err" : undefined}
        />
      </Field>

      <div className="actions">
        <button type="submit" className="btn primary block" disabled={pending}>
          {pending ? t("sending") : t("submit")}
        </button>
      </div>
      {children}
    </form>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error: string | null;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <span className="err" id={`${id}-err`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
