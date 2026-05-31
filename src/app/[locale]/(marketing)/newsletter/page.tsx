import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LandingShell } from "@/app/landing-shell";

type Status = "confirmed" | "unsubscribed" | "invalid";
const KNOWN: Status[] = ["confirmed", "unsubscribed", "invalid"];

export default async function NewsletterStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  const { status: raw } = await searchParams;
  const status: Status = KNOWN.includes(raw as Status) ? (raw as Status) : "invalid";
  const t = await getTranslations({ locale, namespace: "landing" });

  return (
    <LandingShell locale={locale} screenLabel="Newsletter">
      <header className="page-hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("newsletter.statusEyebrow")}</span>
          <h1>{t(`newsletter.status_${status}_title`)}</h1>
          <p className="lead">{t(`newsletter.status_${status}_body`)}</p>
          <p style={{ marginTop: 24 }}>
            <Link href="/" className="btn">{t("newsletter.statusHome")}</Link>
          </p>
        </div>
      </header>
    </LandingShell>
  );
}
