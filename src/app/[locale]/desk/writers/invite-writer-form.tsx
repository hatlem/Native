"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { createWriterInvite } from "@/app/writer-invite-actions";
import { WRITER_INVITE_IDLE } from "@/lib/writers/invite";
import { SafeEmail } from "@/components/safe-email";

const INVITE_LOCALES = ["en", "no", "sv", "da", "fi", "de"] as const;

export function InviteWriterForm({ locale }: { locale: string }) {
  const t = useTranslations("deskWriters");
  const [state, action, pending] = useActionState(createWriterInvite, WRITER_INVITE_IDLE);
  // Default the email language to the desk's own UI language — the desk
  // mostly recruits writers for its own market — but it is always shown
  // and editable, since the writer's language is what matters.
  const defaultInviteLocale = (INVITE_LOCALES as readonly string[]).includes(locale)
    ? locale
    : "en";

  return (
    <form action={action} className="card stack-4">
      <input type="hidden" name="locale" value={locale} />
      <div className="grid two">
        <label className="field">
          <span>{t("emailLabel")}</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder={t("emailPlaceholder")}
          />
        </label>
        <label className="field">
          <span>{t("inviteLanguageLabel")}</span>
          <select name="inviteLocale" defaultValue={defaultInviteLocale}>
            {INVITE_LOCALES.map((l) => (
              <option key={l} value={l}>
                {t(`inviteLanguage.${l}`)}
              </option>
            ))}
          </select>
          <span className="hint">{t("inviteLanguageHint")}</span>
        </label>
      </div>
      <div className="cluster">
        <button type="submit" className="btn primary" disabled={pending} aria-disabled={pending}>
          {pending ? t("inviting") : t("inviteButton")}
        </button>
      </div>
      <div aria-live="polite">
        {state.status === "sent" ? (
          <div className="banner-success" role="status">
            <span>
              {t.rich("inviteSent", { addr: () => <SafeEmail address={state.email} /> })}
            </span>
          </div>
        ) : state.status === "notSent" ? (
          <div className="banner-error" role="alert">
            <span>
              {t.rich("inviteNotSent", { addr: () => <SafeEmail address={state.email} /> })}
            </span>
          </div>
        ) : state.status === "error" ? (
          <div className="banner-error" role="alert">
            <span>
              {state.code === "existingAccount" ? t("errorExistingAccount") : t("errorInvalidEmail")}
            </span>
          </div>
        ) : null}
      </div>
    </form>
  );
}
