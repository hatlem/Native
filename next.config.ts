import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Conservative baseline security headers. No CSP yet — landing pages
// inline <style> and we use third-party GTM, so a meaningful CSP needs
// nonce wiring per route. Tracked as a follow-up.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // HSTS is safe to send everywhere — browsers ignore it on plain HTTP.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // /developers and /docs are conventional landing spots tech evaluators
  // try first (Tobias scenario). Send them to the real API docs at /api.
  // Only the locale-prefixed forms are listed — next-intl's middleware
  // first redirects bare `/developers` → `/<defaultLocale>/developers`,
  // which then hits the rule below. Adding a bare `/developers → /api`
  // here would short-circuit ahead of next-intl and land on `/api`
  // with no locale prefix (which 404s — `/api` lives under [locale]).
  async redirects() {
    return [
      {
        source: "/:locale/developers",
        destination: "/:locale/api",
        permanent: false,
      },
      { source: "/:locale/docs", destination: "/:locale/api", permanent: false },
    ];
  },
};

export default withNextIntl(nextConfig);
