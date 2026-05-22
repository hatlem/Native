import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { MarketCode } from "@prisma/client";
import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { register } from "@/app/auth-actions";

export const dynamic = "force-dynamic";

const MARKET_CODES = Object.values(MarketCode);

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
  const tMarket = await getTranslations({ locale, namespace: "market" });

  const appName = tc("appName");
  const errorKey =
    sp.error === "exists" ? "regExists" : sp.error ? "regFailed" : null;

  return (
    <section className="auth-shell">
      <div className="marketing">
        <span className="eyebrow accent">{appName}</span>
        <h1>{t("signupHeadline")}</h1>
        <p className="lead">{t("signupLead")}</p>
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
          <p>{t("signupSubtitle")}</p>
        </div>

        {errorKey ? (
          <div className="banner-error" role="alert">
            <ErrorIcon />
            <span>{t(errorKey)}</span>
          </div>
        ) : null}

        <form action={register} noValidate>
          <input type="hidden" name="locale" value={locale} />
          <div className="field">
            <label htmlFor="name">{t("name")}</label>
            <input id="name" name="name" autoComplete="name" autoFocus />
          </div>
          <div className="field">
            <label htmlFor="orgName">{t("org")}</label>
            <input
              id="orgName"
              name="orgName"
              autoComplete="organization"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="market">{t("market")}</label>
            <select id="market" name="market" defaultValue="" required>
              <option value="" disabled>
                {t("marketPlaceholder")}
              </option>
              {MARKET_CODES.map((m) => (
                <option key={m} value={m}>
                  {tMarket(m)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="email">{t("email")}</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">{t("password")}</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
            <span className="hint">{t("pwHint")}</span>
          </div>
          <div className="actions">
            <button type="submit" className="btn block">
              {t("createAccount")}
            </button>
          </div>
        </form>

        <div className="alt">
          {t("haveAccount")} <Link href="/signin">{t("signin")}</Link>
        </div>
      </div>
    </section>
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
