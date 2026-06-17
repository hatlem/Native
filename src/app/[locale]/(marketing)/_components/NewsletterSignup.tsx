"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { subscribeNewsletter, type SubscribeState } from "@/lib/newsletter/subscribe";

const initial: SubscribeState = { status: "idle" };

export function NewsletterSignup({
  variant = "full",
  source,
}: {
  variant?: "full" | "compact";
  source: string;
}) {
  const t = useTranslations("landing");
  const locale = useLocale();
  const [state, action, pending] = useActionState(subscribeNewsletter, initial);

  if (state.status === "ok") {
    return <p className="newsletter-ok">{t("newsletter.success")}</p>;
  }

  return (
    <form action={action} className={`newsletter-form ${variant}`}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="source" value={source} />
      {/* Honeypot: visually hidden, must stay empty. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="newsletter-hp"
      />
      {/* A real accessible label — NOT the example address. An email-shaped
          string in this SSR text node makes Cloudflare's Email Address
          Obfuscation rewrite it into a `__cf_email__` span + a decode script
          our CSP blocks, breaking React hydration (#418) across every public
          footer. The example address stays as the placeholder attribute
          (which CF leaves alone) for UX. */}
      <label className="sr-only" htmlFor={`nl-${source}`}>{t("newsletter.emailLabel")}</label>
      <input
        id={`nl-${source}`}
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder={t("newsletter.placeholder")}
      />
      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? t("newsletter.sending") : t("newsletter.button")}
      </button>
      {state.status === "error" && (
        <p className="newsletter-err">{t("newsletter.error")}</p>
      )}
    </form>
  );
}
