import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { landingForRole } from "@/lib/roles";
import { catalogTitleCount, titleCountFloor } from "@/lib/catalog-stats";
import { intlLocale } from "@/lib/money";
import { LandingContent } from "./_components/LandingContent";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing" });
  const tc = await getTranslations({ locale, namespace: "common" });
  const count = titleCountFloor(await catalogTitleCount());
  // `absolute`: the home title leads with the brand itself, so the layout's
  // "%s · NativeSpin" template would print it twice.
  return {
    title: {
      absolute: `${tc("appName")} — ${t("hero.metaTitle", {
        totalCount: count.toLocaleString(intlLocale(locale)),
      })}`,
    },
  };
}

export const dynamic = "force-dynamic";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Signed-in users don't need the marketing pitch — send them straight to
  // their actionable home (catalog for buyers/agencies, the console for
  // desk/admin, the portal for publishers/writers) so they land on a page
  // that tells them what to do next. Done before the catalog queries below
  // so we don't run them for a session we're about to redirect.
  // (Visitors without a session cookie get the prerendered copy of
  // <LandingContent> instead — app/static/[locale]/page.tsx.)
  const session = await auth();
  if (session?.user) {
    redirect(landingForRole(session.user.role, locale));
  }

  return <LandingContent locale={locale} />;
}
