import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { landingForRole } from "@/lib/roles";
import { authenticate, requestMagicLink } from "@/app/auth-actions";
import { LandingShell } from "@/app/landing-shell";
import { SubmitButton } from "@/components";
import { DemoChips, type DemoAccount } from "./demo-chips";

export const dynamic = "force-dynamic";

const DEMO_ACCOUNTS: DemoAccount[] = [
  { key: "buyer", label: "Buyer", email: "buyer@atnative.com", password: "atnative-buyer" },
  { key: "agency", label: "Agency", email: "agency@atnative.com", password: "atnative-agency" },
  { key: "publisher", label: "Publisher", email: "publisher@atnative.com", password: "atnative-pub" },
  { key: "desk", label: "Desk", email: "desk@atnative.com", password: "atnative-desk" },
  { key: "superadmin", label: "Super admin", email: "superadmin@atnative.com", password: "atnative-superadmin" },
];

export default async function SignInPage({
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

  const t = await getTranslations({ locale, namespace: "auth" });
  const tc = await getTranslations({ locale, namespace: "common" });

  const appName = tc("appName");
  const errorCode = typeof sp.error === "string" ? sp.error : undefined;
  const errorMessage =
    errorCode === "rate"
      ? t("rateLimited")
      : errorCode === "magic_expired"
        ? t("magicLinkExpired")
        : errorCode
          ? t("failed")
          : null;
  const initialEmail = typeof sp.email === "string" ? sp.email : "";

  return (
    <LandingShell locale={locale} screenLabel="Sign in">
      <section className="auth-shell">
        <div className="marketing">
          <span className="eyebrow accent">{appName}</span>
          <h1>{t("welcomeHeadline")}</h1>
          <p className="lead">{t("welcomeLead")}</p>
          <div className="pull">
            <strong>{t("pullTitle")}</strong>
            {t("pullBody")}
          </div>
        </div>

        <div className="auth-card">
          <div className="head">
            <h2>{t("title")}</h2>
            <p>{t("signinSubtitle")}</p>
          </div>

          {errorMessage ? (
            <div className="banner-error" role="alert">
              <ErrorIcon />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <form action={authenticate} noValidate>
            <input type="hidden" name="locale" value={locale} />
            <div className="field">
              <label htmlFor="email">{t("email")}</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                defaultValue={initialEmail}
              />
            </div>
            <div className="field">
              <label htmlFor="password">{t("password")}</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <div className="actions">
              <SubmitButton label={t("submit")} pendingLabel={t("signingIn")} />
            </div>
          </form>

          <div className="alt" style={{ marginTop: 8 }}>
            <Link href="/forgot-password">{t("forgotLink")}</Link>
          </div>

          <div className="divider" role="separator" aria-hidden="true" style={{ margin: "20px 0", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
            {t("magicLinkDivider")}
          </div>

          <div className="head" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 18 }}>{t("magicLinkTitle")}</h2>
            <p>{t("magicLinkLead")}</p>
          </div>

          <form action={requestMagicLink} noValidate>
            <input type="hidden" name="locale" value={locale} />
            <div className="field">
              <label htmlFor="magic-email">{t("email")}</label>
              <input id="magic-email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="actions">
              <button type="submit" className="btn primary block">
                {t("magicLinkButton")}
              </button>
            </div>
          </form>

          {/* Demo accounts are seeded with known-weak passwords; only expose
              the chip helper outside production so credential-stuffing the
              seeded accounts isn't documented on the production login page. */}
          {process.env.NODE_ENV !== "production" ? (
            <DemoChips label={t("demoLabel")} accounts={DEMO_ACCOUNTS} />
          ) : null}

          <div className="alt">
            {t("noAccount")} <Link href="/signup">{t("signup")}</Link>
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
