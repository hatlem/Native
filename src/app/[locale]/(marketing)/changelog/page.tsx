import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LandingShell } from "@/app/landing-shell";
import { intlLocale } from "@/lib/money";
import { CHANGELOG } from "@/lib/changelog";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "changelog" });
  return { title: t("metaTitle"), description: t("lead") };
}

export default async function ChangelogPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "changelog" });
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "long", timeZone: "UTC" });

  return (
    <LandingShell locale={locale} screenLabel="Changelog">
      <header className="page-hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead")}</p>
        </div>
      </header>

      <section className="section prose-section">
        <div className="wrap">
          {CHANGELOG.map((e) => (
            <article key={e.id} style={{ marginBottom: 28 }}>
              <p className="muted small">
                <time dateTime={e.date}>{fmt.format(new Date(`${e.date}T00:00:00Z`))}</time>
              </p>
              <h2>{t(`entries.${e.id}.title`)}</h2>
              <p className="prose">{t(`entries.${e.id}.body`)}</p>
            </article>
          ))}
        </div>
      </section>
    </LandingShell>
  );
}
