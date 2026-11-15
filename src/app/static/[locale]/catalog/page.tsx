import { setRequestLocale } from "next-intl/server";
import { CatalogMarketing } from "@/app/[locale]/catalog/_components/CatalogMarketing";
import { pageTitleMetadata } from "@/lib/page-title";

// The catalog for visitors without a session: the catalog gate (the [locale]
// catalog page renders the same component when there is no session). Any
// query string is ignored, as it is there. Rendered on first request and
// cached like the landing page (./../page.tsx).
export const generateMetadata = pageTitleMetadata("catalog");

export const revalidate = 300;

export function generateStaticParams(): Array<{ locale: string }> {
  return [];
}

export default async function StaticCatalogGatePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <CatalogMarketing locale={locale} />;
}
