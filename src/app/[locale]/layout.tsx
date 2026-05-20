import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { auth } from "@/auth";
import { logout } from "@/app/auth-actions";
import { GtmScripts, GtmNoscript } from "@/app/gtm";
import "../globals.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const loc = (routing.locales as readonly string[]).includes(locale)
    ? locale
    : routing.defaultLocale;
  const tc = await getTranslations({ locale: loc, namespace: "common" });
  const th = await getTranslations({ locale: loc, namespace: "home" });
  const appName = tc("appName");
  const title = `${appName} · ${th("title")}`;
  const description = th("subtitle");

  return {
    metadataBase: new URL(
      process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    ),
    applicationName: appName,
    title: { default: title, template: `%s · ${appName}` },
    description,
    alternates: {
      canonical: `/${loc}`,
      languages: Object.fromEntries(
        routing.locales.map((l) => [l, `/${l}`]),
      ),
    },
    openGraph: {
      type: "website",
      siteName: appName,
      title,
      description,
      url: `/${loc}`,
      locale: loc,
    },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
  themeColor: "#f6f7f9",
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!(routing.locales as readonly string[]).includes(locale)) {
    notFound();
  }

  const messages = await getMessages();
  const t = await getTranslations({ locale, namespace: "nav" });
  const tc = await getTranslations({ locale, namespace: "common" });
  const ta = await getTranslations({ locale, namespace: "auth" });
  const tm = await getTranslations({ locale, namespace: "marketing" });
  const session = await auth();

  return (
    <html lang={locale}>
      <body>
        <GtmNoscript />
        <GtmScripts />
        <NextIntlClientProvider messages={messages}>
          <header className="site-header">
            <div className="container">
              <Link href="/" className="brand">
                {tc("appName")}
              </Link>
              <nav className="nav">
                <Link href="/">{t("home")}</Link>
                <Link href="/catalog">{t("catalog")}</Link>
                <Link href="/recommend">{t("recommend")}</Link>
                <Link href="/plan">{t("plan")}</Link>
                {session?.user?.orgId ? (
                  <>
                    {session.user.orgType === "AGENCY" ? (
                      <Link href="/agency">{t("agency")}</Link>
                    ) : null}
                    <Link href="/requests">{t("requests")}</Link>
                    <Link href="/orders">{t("orders")}</Link>
                    <Link href="/reports">{t("reports")}</Link>
                  </>
                ) : null}
                <Link href="/desk">{t("desk")}</Link>
                <Link href="/publisher">{t("publisher")}</Link>
                {session?.user ? (
                  <>
                    <Link href="/notifications">{t("notifications")}</Link>
                    <form
                      action={logout}
                      style={{ display: "inline", marginLeft: 18 }}
                    >
                      <input type="hidden" name="locale" value={locale} />
                      <span className="muted">{session.user.email}</span>{" "}
                      <button type="submit">{ta("signout")}</button>
                    </form>
                  </>
                ) : (
                  <>
                    <Link href="/signin">{ta("signin")}</Link>
                    <Link href="/signup">{ta("signup")}</Link>
                  </>
                )}
              </nav>
            </div>
          </header>
          <main className="container">{children}</main>
          <footer>
            <div className="container footer-grid">
              <div>
                <strong style={{ color: "var(--heading)" }}>{tc("appName")}</strong>
                <p className="muted" style={{ fontSize: "0.85rem", maxWidth: "32ch" }}>
                  {tm("footerTagline")}
                </p>
                <p className="muted" style={{ fontSize: "0.8rem" }}>
                  © {new Date().getFullYear()} {tc("appName")}
                </p>
              </div>
              <div>
                <p style={{ fontWeight: 700, margin: 0, color: "var(--heading)" }}>
                  {tm("footerProduct")}
                </p>
                <ul style={{ listStyle: "none", padding: 0, margin: "8px 0" }}>
                  <li><Link href="/catalog">{t("catalog")}</Link></li>
                  <li><Link href="/recommend">{t("recommend")}</Link></li>
                  <li><Link href="/how-it-works">{tm("howCta")}</Link></li>
                </ul>
              </div>
              <div>
                <p style={{ fontWeight: 700, margin: 0, color: "var(--heading)" }}>
                  {tm("footerSolutions")}
                </p>
                <ul style={{ listStyle: "none", padding: 0, margin: "8px 0" }}>
                  <li><Link href="/for-advertisers">{tm("audAdvertiserTitle")}</Link></li>
                  <li><Link href="/for-agencies">{tm("audAgencyTitle")}</Link></li>
                  <li><Link href="/for-publishers">{tm("audPublisherTitle")}</Link></li>
                </ul>
              </div>
              <div>
                <p style={{ fontWeight: 700, margin: 0, color: "var(--heading)" }}>
                  {tm("footerCompany")}
                </p>
                <ul style={{ listStyle: "none", padding: 0, margin: "8px 0" }}>
                  <li><Link href="/about">{tm("footerAbout")}</Link></li>
                  <li>
                    <a href="mailto:hello@benative.example">{tm("footerContact")}</a>
                  </li>
                </ul>
              </div>
            </div>
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
