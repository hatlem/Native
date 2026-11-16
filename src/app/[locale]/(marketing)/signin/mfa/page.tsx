import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { landingForRole } from "@/lib/roles";
import { LandingShell } from "@/app/landing-shell";
import { currentPendingMfa } from "@/lib/mfa/signin";
import { MfaSignInForm } from "./mfa-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "mfa" });
  return { title: t("stepTitle"), robots: { index: false } };
}

// Second step of signing in to an account with two-factor on. Reachable only
// with the signed "first factor passed" cookie (src/lib/mfa/tickets.ts); it
// shows nothing about the account — not even the email — so a stolen or
// replayed cookie learns nothing here, and still needs the code.
export default async function MfaStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;

  const session = await auth();
  if (session?.user) redirect(landingForRole(session.user.role, locale));

  const pending = await currentPendingMfa();
  if (!pending) redirect(`/${locale}/signin?error=mfa_expired`);

  const t = await getTranslations({ locale, namespace: "mfa" });
  const tc = await getTranslations({ locale, namespace: "common" });

  const errorCode = typeof sp.error === "string" ? sp.error : undefined;
  const errorMessage =
    errorCode === "rate"
      ? t("errorRate")
      : errorCode === "replay"
        ? t("errorReplay")
        : errorCode
          ? t("errorInvalid")
          : null;

  return (
    <LandingShell locale={locale} screenLabel="Sign in — two-factor">
      <section className="auth-shell">
        <div className="marketing">
          <span className="eyebrow accent">{tc("appName")}</span>
          <h1>{t("stepHeadline")}</h1>
          <p className="lead">{t("stepLead")}</p>
        </div>

        <div className="auth-card">
          <div className="head">
            <h2>{t("stepTitle")}</h2>
            <p>{pending.via === "magic" ? t("stepSubtitleMagic") : t("stepSubtitle")}</p>
          </div>

          {errorMessage ? (
            <div className="banner-error" role="alert">
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <MfaSignInForm
            locale={locale}
            hasError={!!errorMessage}
            labels={{
              code: t("codeLabel"),
              hint: t("codeHint"),
              submit: t("verify"),
              verifying: t("verifying"),
              cancel: t("cancel"),
            }}
          />
        </div>
      </section>
    </LandingShell>
  );
}
