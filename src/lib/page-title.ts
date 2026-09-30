import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { safeLocale } from "@/i18n/routing";

// Document titles for the signed-in app. The [locale] layout's template
// turns a page title into "<Page> · NativeSpin"; without one, every app page
// fell back to the marketing default ("NativeSpin · Buy native content in
// premium newspapers…"), so ten tabs of the app read the same and the
// catalog (which is in the sitemap) had no title of its own.
//
// Set per route segment by a metadata-only layout, so a detail page
// (/orders/[id]) shares its section's title without each page repeating
// the boilerplate. Keys live in the "pageTitle" namespace of the messages.
export const PAGE_TITLE_KEYS = [
  "catalog",
  "catalogCompare",
  "home",
  "plan",
  "lists",
  "favorites",
  "requests",
  "orders",
  "invoices",
  "articles",
  "reports",
  "campaign",
  "notifications",
  "account",
  "agency",
  "onboarding",
  "onboardingCall",
  "invite",
  "writer",
  "publisher",
  "desk",
  "deskRequest",
  "deskOrders",
  "deskTitles",
  "deskUsers",
  "deskWriters",
  "deskPriceQuotes",
  "deskPublisherContacts",
  "deskReports",
  "deskPlaybooks",
  "deskContentFees",
  "deskApiKeys",
  "deskMetricsNeedsContact",
] as const;

export type PageTitleKey = (typeof PAGE_TITLE_KEYS)[number];

type SegmentProps = { params: Promise<{ locale: string }> };

async function pageTitle(locale: string, key: PageTitleKey): Promise<string> {
  const t = await getTranslations({ locale: safeLocale(locale), namespace: "pageTitle" });
  return t(key);
}

// `export const generateMetadata = pageTitleMetadata("orders")` in a layout.
export function pageTitleMetadata(key: PageTitleKey) {
  return async ({ params }: SegmentProps): Promise<Metadata> => {
    const { locale } = await params;
    return { title: await pageTitle(locale, key) };
  };
}

// For a section with its own sub-pages (the desk): the section page reads
// "Desk · NativeSpin" and its children "Orders · Desk · NativeSpin". A
// nested template replaces the root one rather than stacking on it, so the
// app name is spelled out here.
export function sectionTitleMetadata(key: PageTitleKey) {
  return async ({ params }: SegmentProps): Promise<Metadata> => {
    const { locale } = await params;
    const section = await pageTitle(locale, key);
    const tc = await getTranslations({ locale: safeLocale(locale), namespace: "common" });
    return { title: { default: section, template: `%s · ${section} · ${tc("appName")}` } };
  };
}
