import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { LandingShell } from "@/app/landing-shell";
import { MailLink } from "@/components";
import { Link } from "@/i18n/navigation";
import { MARKET_CODES, type MarketCode } from "@/lib/preview/schema";
import { PreviewStudio } from "../_components/PreviewStudio";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Preview your own native ad — NativeSpin",
};

export default async function PreviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing" });

  const rows = await prisma.market.findMany({
    select: { code: true, name: true, disclosureLabel: true },
  });
  const allowed = new Set<string>(MARKET_CODES);
  const markets = rows
    .filter((m) => allowed.has(m.code))
    .map((m) => ({
      code: m.code as MarketCode,
      name: m.name,
      disclosureLabel: m.disclosureLabel || "Sponsored content",
    }));

  return (
    <LandingShell locale={locale} screenLabel="Preview" withFooter={true}>
      <section className="section">
        <div className="wrap">
          <div className="eyebrow">{t("studio.eyebrow")}</div>
          <h1 style={{ margin: "10px 0 12px", fontWeight: 600, fontSize: "clamp(32px,4.6vw,56px)", letterSpacing: "-0.035em", lineHeight: 1 }}>
            {t("studio.h1")}
          </h1>
          <p className="lead" style={{ marginBottom: "clamp(28px,3vw,40px)" }}>{t("studio.lead")}</p>
          <PreviewStudio markets={markets} defaultDisclosure="Sponsored content" />
        </div>
      </section>

      <section className="end-cta">
        <div className="wrap">
          <h2>{t("studio.ctaHeading")}</h2>
          <div className="row">
            <MailLink to="desk@nativespin.com" subject="Talk to the NativeSpin desk" className="btn primary">
              {t("studio.ctaDesk")} <span className="arrow">→</span>
            </MailLink>
            <Link href="/signup" className="btn">{t("studio.ctaAccess")}</Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
