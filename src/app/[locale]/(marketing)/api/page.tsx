import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LandingShell } from "@/app/landing-shell";
import { withSafeEmails } from "@/components/safe-email";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "apiDocs" });
  return { title: t("metaTitle"), description: t("lead") };
}

// Public API reference. Lives in (marketing) so partners can read it
// without an account — the keys themselves are issued by NativeSpin
// super-admins per integration partner.
export default async function ApiDocsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "apiDocs" });

  return (
    <LandingShell locale={locale} screenLabel="API docs">
      <header className="page-hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead")}</p>
        </div>
      </header>

      <section className="section prose-section">
        <div className="wrap">
          <span className="eyebrow accent">{t("selfServeEyebrow")}</span>
          <h2>{t("selfServeTitle")}</h2>
          <p className="prose">{t("selfServeBody")}</p>
          <pre className="prose" style={{ whiteSpace: "pre-wrap" }}>
{`POST /api/v1/orders
Authorization: Bearer atn_<your-token>
Content-Type: application/json

{ "items": [ { "productId": "<firm-product-id>", "quantity": 1 } ] }`}
          </pre>
        </div>
      </section>

      <section className="section prose-section">
        <div className="wrap">
          <h2>{t("authTitle")}</h2>
          <p className="prose">{t("authBody")}</p>
          <pre className="prose" style={{ whiteSpace: "pre-wrap" }}>
{`GET /api/v1/catalog/titles
Authorization: Bearer atn_<your-token>`}
          </pre>
          <p className="prose">{withSafeEmails(t("authRequest"))}</p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="eyebrow">{t("endpointsEyebrow")}</span>
              <h2>{t("endpointsTitle")}</h2>
            </div>
          </div>

          <div className="grid">
            <article className="card">
              <h3>GET /api/v1/catalog/titles</h3>
              <p className="muted">{t("listBody")}</p>
              <p className="muted small">
                <strong>{t("queryParams")}:</strong> market, format, limit
                (1–100), cursor.
              </p>
            </article>

            <article className="card">
              <h3>GET /api/v1/catalog/titles/{`{id}`}</h3>
              <p className="muted">{t("detailBody")}</p>
              <p className="muted small">{t("detailIncludes")}</p>
            </article>

            <article className="card">
              <h3>POST /api/v1/orders</h3>
              <p className="muted">{t("ordersBody")}</p>
            </article>
          </div>
        </div>
      </section>

      <section className="section prose-section">
        <div className="wrap">
          <h2>{t("paginationTitle")}</h2>
          <p className="prose">{t("paginationBody")}</p>
          <pre className="prose" style={{ whiteSpace: "pre-wrap" }}>
{`{
  "data": [ ... ],
  "page": { "limit": 50, "hasMore": true, "nextCursor": "cm12abc..." }
}`}
          </pre>
        </div>
      </section>

      <section className="section prose-section">
        <div className="wrap">
          <h2>{t("limitsTitle")}</h2>
          <p className="prose">{t("limitsBody")}</p>
        </div>
      </section>

      <section className="section prose-section">
        <div className="wrap">
          <h2>{t("errorsTitle")}</h2>
          <p className="prose">{t("errorsBody")}</p>
          <pre className="prose" style={{ whiteSpace: "pre-wrap" }}>
{`{ "error": { "code": "INVALID", "message": "Unknown API key." } }`}
          </pre>
        </div>
      </section>

      <section className="cta-block">
        <div className="wrap">
          <h2>{t("ctaTitle")}</h2>
          <p>{t("ctaBody")}</p>
          <div className="hero-actions">
            <Link href="/contact" className="btn primary">
              {t("ctaContact")} <span className="arrow">→</span>
            </Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
