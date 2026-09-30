import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { register } from "@/app/signup-actions";
import { LandingShell } from "@/app/landing-shell";
import { SubmitButton } from "@/components";
import { catalogTitleCount, titleCountFloor } from "@/lib/catalog-stats";
import { intlLocale } from "@/lib/money";
import { emailDomain, suggestEmailDomain } from "@/lib/email-policy";
import { EmailTypoPrompt } from "./email-typo-prompt";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return {
    title: t("signupTitle"),
  };
}

export default async function SignUpPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (session?.user) redirect(`/${locale}/catalog`);

  const t = await getTranslations({ locale, namespace: "auth" });
  const tc = await getTranslations({ locale, namespace: "common" });

  const appName = tc("appName");
  const errorCode = typeof sp.error === "string" ? sp.error : undefined;
  const errorMessage =
    errorCode === "rate"
      ? t("regRateLimited")
      : errorCode === "email_business"
        ? t("regEmailBusiness")
        : errorCode === "email_invalid"
          ? t("regEmailInvalid")
          : errorCode === "email_domain"
            ? t("regEmailNoMailServer")
            : errorCode === "password_length"
              ? t("regPasswordTooShort")
              : errorCode === "email_typo"
                ? null
                : errorCode
                ? t("regFailed")
                : null;
  const sParam = (key: string) =>
    typeof sp[key] === "string" ? (sp[key] as string) : "";
  const initialName = sParam("name");
  const initialOrgName = sParam("orgName");
  const initialEmail = sParam("email");
  // Typo prompt: recomputed from the preserved address, never read from
  // the URL, so a link can't suggest an address of someone else's choosing.
  const typoSuggestion =
    errorCode === "email_typo" ? suggestEmailDomain(initialEmail) : null;
  const typedDomain = typoSuggestion ? emailDomain(initialEmail) : null;

  return (
    <LandingShell locale={locale} screenLabel="Sign up">
      <section className="auth-shell">
        <div className="marketing">
          <span className="eyebrow accent">{appName}</span>
          <h1>{t("signupHeadline")}</h1>
          <p className="lead">
            {t("signupLead", {
              count: titleCountFloor(await catalogTitleCount()).toLocaleString(intlLocale(locale)),
            })}
          </p>
          <ul className="signup-bullets">
            <li>{t("bulletCatalog")}</li>
            <li>{t("bulletDesk")}</li>
            <li>{t("bulletReports")}</li>
          </ul>
          <div className="pull">
            <strong>{t("haveAccountTitle")}</strong>
            {t("haveAccountBody")}{" "}
            <Link href="/signin" className="link">
              {t("signin")}
            </Link>
          </div>
        </div>

        <div className="auth-card">
          <div className="head">
            <h2>{t("signupTitle")}</h2>
            <p>{t("signupSubtitleShort")}</p>
          </div>

          {errorMessage ? (
            <div className="banner-error" role="alert">
              <ErrorIcon />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <form action={register} noValidate>
            <input type="hidden" name="locale" value={locale} />
            <div className="field">
              <label htmlFor="name">
                {t("name")}{" "}
                <span className="optional">({t("optional")})</span>
              </label>
              <input
                id="name"
                name="name"
                autoComplete="name"
                autoFocus
                defaultValue={initialName}
              />
            </div>
            <div className="field">
              <label htmlFor="orgName">{t("org")}</label>
              <input
                id="orgName"
                name="orgName"
                autoComplete="organization"
                required
                defaultValue={initialOrgName}
              />
            </div>
            <div className="field">
              <label htmlFor="email">{t("email")}</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                defaultValue={initialEmail}
                aria-invalid={typoSuggestion ? true : undefined}
                aria-describedby={typoSuggestion ? "email-typo" : undefined}
              />
              {typoSuggestion && typedDomain ? (
                <EmailTypoPrompt
                  id="email-typo"
                  inputId="email"
                  suggestion={typoSuggestion}
                  typedDomain={typedDomain}
                  question={t.rich("regEmailTypoQuestion", {
                    email: typoSuggestion,
                    b: (chunks) => <strong>{chunks}</strong>,
                  })}
                  useLabel={t("regEmailTypoUse", { email: typoSuggestion })}
                  keepHint={t("regEmailTypoKeep", { domain: typedDomain })}
                />
              ) : null}
            </div>

            {/* Password is now optional. The disclosure default-closed
                keeps the form at three fields for the first-time visitor
                Maja's scenario flagged; opening it shows the same
                password input + hint as before. An empty password
                routes signup through magic-link delivery. */}
            <details className="signup-password-disclosure">
              <summary>{t("setPasswordSummary")}</summary>
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="password">
                  {t("password")}{" "}
                  <span className="optional">({t("optional")})</span>
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                />
                <span className="hint">{t("pwHintOptional")}</span>
              </div>
            </details>

            <p className="muted small" style={{ marginTop: 8 }}>
              {t("magicLinkSignupNote")}
            </p>

            <div className="actions">
              <SubmitButton
                label={t("createAccount")}
                pendingLabel={t("creatingAccount")}
              />
            </div>
          </form>

          <div className="alt">
            {t("haveAccount")} <Link href="/signin">{t("signin")}</Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}

function ErrorIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
