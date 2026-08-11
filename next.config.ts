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
  // The floating Next.js "N" dev indicator overlaps form content at
  // mobile widths and ends up in every screenshot we take for design
  // review. Disable it — it's a dev-only overlay and we still get
  // build errors, type errors, and HMR feedback through the CLI.
  devIndicators: false,
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
      // /orders merged into /requests ("Quotes & orders") — permanent per
      // the design decision, unlike the two entries above.
      { source: "/:locale/orders", destination: "/:locale/requests", permanent: true },
    ];
  },
  // /.well-known/openapi.json is the conventional discovery URL for
  // generic API tooling (Postman, openapi-generator, Apidog, etc.).
  // Mirror it to the real handler at /api/openapi.json so partners
  // don't have to know our route convention to find the spec.
  async rewrites() {
    return [
      {
        source: "/.well-known/openapi.json",
        destination: "/api/openapi.json",
      },
    ];
  },
};

export default withNextIntl(nextConfig);
