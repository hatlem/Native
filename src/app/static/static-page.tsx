import type { ComponentType } from "react";
import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";

// Helpers for the prerendered public tree (see ./[locale]/layout.tsx).

type LocaleParams = { params: Promise<{ locale: string }> };

/** Prerender a page for every locale at build time. */
export function localeParams(): Array<{ locale: string }> {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * A [locale] marketing page, rendered for the static tree. next-intl reads
 * the locale from a request header unless it is set for the render, which
 * static rendering cannot do — so every static page sets it first.
 */
export function staticPage(Page: ComponentType<LocaleParams>) {
  return async function StaticPage({ params }: LocaleParams) {
    setRequestLocale((await params).locale);
    return <Page params={params} />;
  };
}
