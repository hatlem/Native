import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { LandingShell } from "@/app/landing-shell";
import { catalogTitleCount, titleCountFloor } from "@/lib/catalog-stats";
import { intlLocale } from "@/lib/money";
import { SignupForm } from "./signup-form";

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
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (session?.user) redirect(`/${locale}/catalog`);

  const t = await getTranslations({ locale, namespace: "auth" });
  const tc = await getTranslations({ locale, namespace: "common" });

  const appName = tc("appName");
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

          <SignupForm locale={locale} />

          <div className="alt">
            {t("haveAccount")} <Link href="/signin">{t("signin")}</Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
