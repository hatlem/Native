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
                    <Link href="/reports">{t("reports")}</Link>
                  </>
                ) : null}
                <Link href="/desk">{t("desk")}</Link>
                <Link href="/publisher">{t("publisher")}</Link>
                {session?.user ? (
                  <form
                    action={logout}
                    style={{ display: "inline", marginLeft: 18 }}
                  >
                    <input type="hidden" name="locale" value={locale} />
                    <span className="muted">{session.user.email}</span>{" "}
                    <button type="submit">{ta("signout")}</button>
                  </form>
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
            <div className="container">
              <span>
                © {new Date().getFullYear()} {tc("appName")}
              </span>
              <span>
                <Link href="/catalog">{t("catalog")}</Link>
                {" · "}
                <Link href="/recommend">{t("recommend")}</Link>
              </span>
            </div>
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
