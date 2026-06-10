import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requestPasswordReset } from "@/app/password-actions";
import { LandingShell } from "@/app/landing-shell";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "auth" });

  const rateLimited = sp.error === "rate";

  return (
    <LandingShell locale={locale} screenLabel="Forgot password">
      <section className="auth-shell">
        <div className="auth-card" style={{ maxWidth: 440 }}>
          <div className="head">
            <h2>{t("forgotTitle")}</h2>
            <p>{t("forgotLead")}</p>
          </div>

          {rateLimited ? (
            <div className="banner-error" role="alert">
              <span>{t("failed")}</span>
            </div>
          ) : null}

          <form action={requestPasswordReset} noValidate>
            <input type="hidden" name="locale" value={locale} />
            <div className="field">
              <label htmlFor="email">{t("email")}</label>
              <input id="email" name="email" type="email" autoComplete="email" autoFocus required />
            </div>
            <div className="actions">
              <button type="submit" className="btn primary block">
                {t("forgotButton")}
              </button>
            </div>
          </form>

          <div className="alt">
            <Link href="/signin">{t("backToSignin")}</Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
