import { setRequestLocale } from "next-intl/server";
import { LandingContent } from "@/app/[locale]/(marketing)/_components/LandingContent";

// The landing page for visitors without a session (see ../layout.tsx).
// It quotes the catalog (title count, showcase), so it is not built with the
// app — the build has no database — but rendered on the first request per
// locale and then served from cache, refreshed every 5 minutes and when the
// desk changes the catalog (the catalog-facets tag, lib/catalog-public.ts).
export { generateMetadata } from "@/app/[locale]/(marketing)/page";

export const revalidate = 300;

export function generateStaticParams(): Array<{ locale: string }> {
  return [];
}

export default async function StaticLandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LandingContent locale={locale} />;
}
