import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Inter } from "next/font/google";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { auth } from "@/auth";
import { logout } from "@/app/auth-actions";
import { GtmScripts, GtmNoscript } from "@/app/gtm";
import { NavShell } from "@/app/nav-shell";
import { PublicHeader } from "@/app/public-header";
import {
  audienceFor,
  navItemsFor,
  paletteItemsFor,
  userMenuItemsFor,
} from "@/lib/nav";
import "../globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

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
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0d10" },
  ],
};

function initialsFromEmail(email: string | null | undefined): string {
  if (!email) return "·";
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return email[0]?.toUpperCase() ?? "·";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function roleLabel(audience: ReturnType<typeof audienceFor>, role: string | undefined, t: (k: string) => string): string {
  if (role === "SUPERADMIN") return t("roleSuperAdmin");
  if (role === "DESK" || role === "CONTENT") return t("roleDesk");
  if (role === "PUBLISHER") return t("rolePublisher");
  if (audience === "agency") return t("roleAgency");
  if (audience === "advertiser") return t("roleAdvertiser");
  return t("roleGuest");
}

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
  // Per-request CSP nonce minted by middleware.ts. Threaded into any
  // inline <script>/<style> that the strict policy would otherwise block.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  const audience = audienceFor(session);
  const nav = navItemsFor(audience, t);
  const palette = paletteItemsFor(audience, t);
  const userMenu = userMenuItemsFor(audience, t);

  const appName = tc("appName");
  const signedIn = Boolean(session?.user);

  return (
    <html lang={locale} className={inter.variable}>
      <body>
        <GtmNoscript />
        <GtmScripts nonce={nonce} />
        <NextIntlClientProvider messages={messages}>
          {signedIn ? (
            <NavShell
              brand={appName}
              nav={nav}
              palette={palette}
              menuItems={userMenu}
              signedIn={signedIn}
              user={
                session?.user?.email
                  ? {
                      email: session.user.email,
                      initials: initialsFromEmail(session.user.email),
                      roleLabel: roleLabel(audience, session.user.role, t),
                    }
                  : undefined
              }
              signOutAction={
                <form action={logout}>
                  <input type="hidden" name="locale" value={locale} />
                  <button type="submit">{ta("signout")}</button>
                </form>
              }
              labels={{
                skip: t("skipToContent"),
                menu: t("menu"),
                close: t("close"),
                search: t("search"),
                searchPlaceholder: t("searchPlaceholder"),
                noResults: t("noResults"),
              }}
            />
          ) : (
            <PublicHeader
              brand={appName}
              authActions={{ signIn: ta("signin"), signUp: ta("signup") }}
            />
          )}

          <main id="main" className="container">
            {children}
          </main>

          <footer>
            <div className="container footer-grid">
              <div className="brand-block">
                <Link href="/" className="brand" aria-label={appName}>
                  <span className="brand-mark" aria-hidden="true">AT</span>
                  <span>{appName}</span>
                </Link>
                <p>{tm("footerTagline")}</p>
                <p className="copyright">
                  © {new Date().getFullYear()} {appName}
                </p>
              </div>
              <div className="col">
                <h2 className="footer-col-head">{tm("footerProduct")}</h2>
                <ul>
                  <li><Link href="/catalog">{t("catalog")}</Link></li>
                  <li><Link href="/formats">{t("formats")}</Link></li>
                  <li><Link href="/recommend">{t("recommend")}</Link></li>
                  <li><Link href="/how-it-works">{tm("howCta")}</Link></li>
                </ul>
              </div>
              <div className="col">
                <h2 className="footer-col-head">{tm("footerSolutions")}</h2>
                <ul>
                  <li><Link href="/for-advertisers">{tm("audAdvertiserTitle")}</Link></li>
                  <li><Link href="/for-agencies">{tm("audAgencyTitle")}</Link></li>
                  <li><Link href="/for-publishers">{tm("audPublisherTitle")}</Link></li>
                </ul>
              </div>
              <div className="col">
                <h2 className="footer-col-head">{tm("footerCompany")}</h2>
                <ul>
                  <li><Link href="/about">{tm("footerAbout")}</Link></li>
                  <li>
                    <a href="mailto:hello@nativespin.com">
                      {tm("footerContact")}
                    </a>
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
