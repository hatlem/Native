import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { routing } from "@/i18n/routing";

export const dynamic = "force-dynamic";

// PLAN §14: the catalog *is* the marketing funnel — sitemap lists every
// locale's home, catalog index and every active Title page so search
// engines can crawl the long tail.

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "http://localhost:3000";

  const titles = await prisma.title.findMany({
    where: { active: true },
    select: { slug: true, updatedAt: true },
  });

  const MARKETING = [
    "for-advertisers",
    "for-agencies",
    "for-publishers",
    "how-it-works",
    "about",
  ] as const;

  const out: MetadataRoute.Sitemap = [];
  for (const locale of routing.locales) {
    out.push({ url: `${base}/${locale}`, changeFrequency: "weekly", priority: 0.7 });
    out.push({
      url: `${base}/${locale}/catalog`,
      changeFrequency: "daily",
      priority: 0.9,
    });
    for (const path of MARKETING) {
      out.push({
        url: `${base}/${locale}/${path}`,
        changeFrequency: "monthly",
        priority: 0.5,
      });
    }
    for (const t of titles) {
      out.push({
        url: `${base}/${locale}/catalog/${t.slug}`,
        lastModified: t.updatedAt,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  }
  return out;
}
