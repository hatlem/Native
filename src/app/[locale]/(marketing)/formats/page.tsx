import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProductType } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { LandingShell } from "@/app/landing-shell";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "formats" });
  return { title: t("metaTitle"), description: t("lead") };
}

type Slug =
  | "native-article"
  | "advertorial"
  | "native-display"
  | "package"
  | "native-plus"
  | "content-video";

const FORMATS: { slug: Slug; type: ProductType; key: string }[] = [
  { slug: "native-article", type: ProductType.NATIVE_ARTICLE, key: "NATIVE_ARTICLE" },
  { slug: "advertorial", type: ProductType.ADVERTORIAL, key: "ADVERTORIAL" },
  { slug: "native-display", type: ProductType.NATIVE_DISPLAY, key: "NATIVE_DISPLAY" },
  { slug: "package", type: ProductType.PACKAGE, key: "PACKAGE" },
  { slug: "native-plus", type: ProductType.NATIVE_PLUS, key: "NATIVE_PLUS" },
  { slug: "content-video", type: ProductType.CONTENT_VIDEO, key: "CONTENT_VIDEO" },
];

export default async function FormatsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "formats" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tm = await getTranslations({ locale, namespace: "marketing" });

  return (
    <LandingShell locale={locale} screenLabel="Formats">
      <header className="page-hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead")}</p>
        </div>
      </header>

      <section className="section">
        <div className="wrap">
          <div className="format-list">
            {FORMATS.map((f) => (
              <article
                key={f.slug}
                id={f.slug}
                className="format-card"
              >
                <header className="format-card-head">
                  <span className="eyebrow">{tType(f.key)}</span>
                  <h2>{t(`${f.slug}.title`)}</h2>
                  <p className="lead">{tType(`desc${f.key}`)}</p>
                </header>

                <dl className="format-grid">
                  <div>
                    <dt>{t("voice")}</dt>
                    <dd>{t(`${f.slug}.voice`)}</dd>
                  </div>
                  <div>
                    <dt>{t("brandPresence")}</dt>
                    <dd>{t(`${f.slug}.brand`)}</dd>
                  </div>
                  <div>
                    <dt>{t("readsLike")}</dt>
                    <dd>{t(`${f.slug}.reads`)}</dd>
                  </div>
                  <div>
                    <dt>{t("bestFor")}</dt>
                    <dd>{t(`${f.slug}.bestFor`)}</dd>
                  </div>
                </dl>

                <p className="format-rule">{t(`${f.slug}.rule`)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="eyebrow">{t("comparisonEyebrow")}</span>
              <h2>{t("comparisonTitle")}</h2>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table compare-formats-table">
              <thead>
                <tr>
                  <th>{t("th.attribute")}</th>
                  {FORMATS.map((f) => (
                    <th key={f.slug}>{tType(f.key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["voice", "brand", "reads", "bestFor"] as const).map((row) => (
                  <tr key={row}>
                    <td>
                      <strong>{t(`th.${row}`)}</strong>
                    </td>
                    {FORMATS.map((f) => (
                      <td key={f.slug} className="muted">
                        {t(`${f.slug}.${row}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section prose-section">
        <div className="wrap">
          <h2>{t("disclosureTitle")}</h2>
          <p className="prose">{t("disclosureBody")}</p>
        </div>
      </section>

      <section className="cta-block">
        <div className="wrap">
          <h2>{t("ctaTitle")}</h2>
          <p>{t("ctaBody")}</p>
          <div className="hero-actions">
            <Link href="/signup" className="btn primary">
              {tm("createAccount")} <span className="arrow">→</span>
            </Link>
            <Link href="/contact" className="btn secondary">
              {t("ctaContact")}
            </Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
