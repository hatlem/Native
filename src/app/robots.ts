import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "http://localhost:3000";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/*/desk",
          "/*/publisher",
          "/*/agency",
          "/*/plan",
          "/*/requests",
          "/*/orders",
          "/*/reports",
          "/*/notifications",
          "/*/signin",
          "/*/signup",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
