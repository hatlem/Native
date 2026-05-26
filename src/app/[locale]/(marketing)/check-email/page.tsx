import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LandingShell } from "@/app/landing-shell";

export const dynamic = "force-dynamic";

export default async function CheckEmailPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });

  return (
    <LandingShell locale={locale} screenLabel="Check email">
      <section className="auth-shell">
        <div className="auth-card" style={{ maxWidth: 440 }}>
          <div className="head">
            <h2>{t("checkTitle")}</h2>
            <p>{t("checkLead")}</p>
          </div>
          <div className="alt">
            <Link href="/signin">{t("backToSignin")}</Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
