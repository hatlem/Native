import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import "../globals.css";

export const metadata = {
  title: "BeNative",
  description:
    "Nordic marketplace for buying native content and native advertising in newspapers and magazines.",
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

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages}>
          <header className="site-header">
            <div className="container">
              <Link href="/" className="brand">
                {tc("appName")}
              </Link>
              <nav className="nav">
                <Link href="/">{t("home")}</Link>
                <Link href="/catalog">{t("catalog")}</Link>
              </nav>
            </div>
          </header>
          <main className="container">{children}</main>
          <footer>
            <div className="container">
              BeNative · Phase 0 scaffold — see PLAN.md
            </div>
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
