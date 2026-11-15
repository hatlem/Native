import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LandingShell } from "@/app/landing-shell";
import { MailLink } from "@/components";
import { intlLocale } from "@/lib/money";
import { SUBPROCESSORS, SUBPROCESSORS_LAST_UPDATED } from "@/lib/subprocessors";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "subprocessors" });
  return { title: t("metaTitle"), description: t("lead") };
}

export default async function SubprocessorsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "subprocessors" });
  const updated = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${SUBPROCESSORS_LAST_UPDATED}T00:00:00Z`),
  );

  return (
    <LandingShell locale={locale} screenLabel="Subprocessors">
      <header className="page-hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead")}</p>
          <p className="last-updated">{t("lastUpdated", { date: updated })}</p>
        </div>
      </header>

      <section className="section">
        <div className="wrap">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("colName")}</th>
                  <th scope="col">{t("colPurpose")}</th>
                  <th scope="col">{t("colData")}</th>
                  <th scope="col">{t("colLocation")}</th>
                </tr>
              </thead>
              <tbody>
                {SUBPROCESSORS.map((s) => (
                  <tr key={s.key}>
                    <th scope="row">
                      {s.name ?? t("ai.name")}
                      {s.optional ? (
                        <>
                          <br />
                          <span className="muted small">{t("optional")}</span>
                        </>
                      ) : null}
                    </th>
                    <td>{t(`${s.key}.purpose`)}</td>
                    <td className="muted">{t(`${s.key}.data`)}</td>
                    <td className="muted">{s.location ?? t("locationTbc")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section prose-section">
        <div className="wrap">
          <h2>{t("changesTitle")}</h2>
          <p className="prose">{t("changesBody")}</p>
          <p className="prose">
            {t("contact")} <MailLink className="link" to="privacy@nativespin.com" />
          </p>
        </div>
      </section>
    </LandingShell>
  );
}
