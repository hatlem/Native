import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { resetPassword } from "@/app/password-actions";
import { LandingShell } from "@/app/landing-shell";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, token } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "auth" });

  // Server-side validate the token before rendering the form.
  // The form's POST re-validates (defense in depth).
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { consumedAt: true, expiresAt: true },
  });
  const invalid =
    !row ||
    row.consumedAt != null ||
    row.expiresAt.getTime() <= Date.now();

  if (invalid) {
    return (
      <LandingShell locale={locale} screenLabel="Reset password">
        <section className="auth-shell">
          <div className="auth-card" style={{ maxWidth: 440 }}>
            <div className="head">
              <h2>{t("resetExpired")}</h2>
            </div>
            <div className="alt">
              <Link href="/forgot-password">{t("forgotButton")}</Link>
            </div>
          </div>
        </section>
      </LandingShell>
    );
  }

  const errorKind = sp.error;

  return (
    <LandingShell locale={locale} screenLabel="Reset password">
      <section className="auth-shell">
        <div className="auth-card" style={{ maxWidth: 440 }}>
          <div className="head">
            <h2>{t("resetTitle")}</h2>
          </div>

          {errorKind === "rate" || errorKind === "1" ? (
            <div className="banner-error" role="alert">
              <span>{t("failed")}</span>
            </div>
          ) : null}
          {errorKind === "expired" ? (
            <div className="banner-error" role="alert">
              <span>{t("resetExpired")}</span>
            </div>
          ) : null}

          <form action={resetPassword} noValidate>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
            <div className="field">
              <label htmlFor="password">{t("password")}</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                autoFocus
              />
            </div>
            <div className="actions">
              <button type="submit" className="btn primary block">
                {t("resetButton")}
              </button>
            </div>
          </form>
        </div>
      </section>
    </LandingShell>
  );
}
