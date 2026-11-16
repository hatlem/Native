import type { Metadata, Viewport } from "next";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { BrandWordmark } from "@/app/brand";
import { MailLink } from "@/components";

// The page chrome both root layouts share: the signed-in/dynamic one
// ([locale]/layout.tsx) and the prerendered public one (static/[locale]).
// Request-independent, so the prerendered pages can use it as is.

export async function siteMetadata(locale: string): Promise<Metadata> {
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
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: appName }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/og-image.png"] },
    // icon.svg sits at the app root, outside both root layouts, so the file
    // convention does not link it; without a link Chromium asks for
    // /favicon.ico (a 404 in the console of every page).
    icons: { icon: { url: "/icon.svg", type: "image/svg+xml" }, apple: "/apple-touch-icon.png" },
    // No layout-level robots: "index, follow" is what crawlers assume
    // without one, and emitting it here put it next to the noindex Next adds
    // on every 404 (two conflicting robots metas). Pages that must stay out
    // of the index (share links, auth pages) set their own.
  };
}

export const siteViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0d10" },
  ],
};

export async function SiteFooter({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "nav" });
  const tc = await getTranslations({ locale, namespace: "common" });
  const tm = await getTranslations({ locale, namespace: "marketing" });
  const appName = tc("appName");
  return (
    <footer>
      <div className="container footer-grid">
        <div className="brand-block">
          <Link href="/" className="brand" aria-label={appName}>
            <BrandWordmark className="brand-wordmark" aria-label={appName} />
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
              <MailLink to="hello@nativespin.com">
                {tm("footerContact")}
              </MailLink>
            </li>
            <li><Link href="/help">{tm("footerHelp")}</Link></li>
            <li><Link href="/changelog">{tm("footerChangelog")}</Link></li>
          </ul>
        </div>
        <div className="col">
          <h2 className="footer-col-head">{tm("footerLegal")}</h2>
          <ul>
            <li><Link href="/privacy">{tm("footerPrivacy")}</Link></li>
            <li><Link href="/terms">{tm("footerTerms")}</Link></li>
            <li><Link href="/security">{tm("footerSecurity")}</Link></li>
            <li><Link href="/subprocessors">{tm("footerSubprocessors")}</Link></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
