import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { inter } from "@/fonts";
import { routing } from "@/i18n/routing";
import { pickClientMessages } from "@/i18n/client-messages";
import { GtmScripts, GtmNoscript } from "@/app/gtm";
import { GetCookiesScripts } from "@/app/getcookies";
import { PublicHeader } from "@/app/public-header";
import { SiteFooter, siteMetadata, siteViewport } from "@/app/site-chrome";
import "../../globals.css";

// The prerendered public tree. The middleware rewrites a page load from a
// visitor WITHOUT a session cookie for one of the pages in
// lib/static-public.ts to /static/<locale>/<page>; the URL in the browser
// stays /<locale>/<page>. Everyone else gets the [locale] tree.
//
// This root layout is the [locale] one minus everything that depends on the
// request — no session (so the signed-out public header, which is what these
// visitors see there too), no nonce. The pages are rendered once (at build,
// or on first request for the ones that read the catalog) and served from
// Next's cache. Their Content-Security-Policy, built from the hashes of the
// page's own inline scripts instead of a nonce, is stored with each cached
// page (lib/static-csp-cache-handler.mjs) — the data-csp marker on <html>
// tells it which pages are ours.
//
// `dynamic = "error"`: anything in this tree that reads the request (headers,
// cookies, the session) fails the build instead of quietly turning a page
// dynamic — where it would go out with no policy at all.
export const dynamic = "error";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  return siteMetadata((await params).locale);
}

export const viewport: Viewport = siteViewport;

export default async function StaticLocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!(routing.locales as readonly string[]).includes(locale)) notFound();
  setRequestLocale(locale);

  const messages = pickClientMessages(await getMessages(), { signedIn: false });
  const tc = await getTranslations({ locale, namespace: "common" });
  const ta = await getTranslations({ locale, namespace: "auth" });

  return (
    <html lang={locale} className={inter.variable} data-csp="static">
      <body>
        <GtmNoscript />
        <GetCookiesScripts />
        <GtmScripts />
        <NextIntlClientProvider messages={messages}>
          <PublicHeader
            brand={tc("appName")}
            authActions={{ signIn: ta("signin"), signUp: ta("signup") }}
          />
          <main id="main" className="container">
            {children}
          </main>
          <SiteFooter locale={locale} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
