import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LandingShell } from "@/app/landing-shell";
import { NewsletterSignup } from "../_components/NewsletterSignup";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing" });
  return {
    title: t("newsletter.statusEyebrow"),
  };
}

type Status = "confirmed" | "unsubscribed" | "invalid";
const KNOWN: Status[] = ["confirmed", "unsubscribed", "invalid"];

// Landing page for the confirm/unsubscribe links, and — reached without a
// status (a shared URL, a typed address) — a plain sign-up page. Showing
// "that link didn't work" to someone who never clicked a link was wrong.
export default async function NewsletterStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  const { status: raw } = await searchParams;
  const status = KNOWN.includes(raw as Status) ? (raw as Status) : null;
  const t = await getTranslations({ locale, namespace: "landing" });

  return (
    <LandingShell locale={locale} screenLabel="Newsletter">
      <header className="page-hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("newsletter.statusEyebrow")}</span>
          {status ? (
            <>
              <h1>{t(`newsletter.status_${status}_title`)}</h1>
              <p className="lead">{t(`newsletter.status_${status}_body`)}</p>
              <p style={{ marginTop: 24 }}>
                <Link href="/" className="btn">{t("newsletter.statusHome")}</Link>
              </p>
            </>
          ) : (
            <>
              <h1>{t("newsletter.heading")}</h1>
              <p className="lead">{t("newsletter.lead")}</p>
              <div style={{ marginTop: 24, maxWidth: 520 }}>
                <NewsletterSignup source="newsletter-page" />
              </div>
            </>
          )}
        </div>
      </header>
    </LandingShell>
  );
}
