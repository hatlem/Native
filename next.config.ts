import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Baseline security headers for every response. The Content-Security-Policy
// is NOT set here: src/middleware.ts builds it per request (nonce-based
// script-src with 'strict-dynamic') for every dynamically rendered page, and
// the prerendered public pages (app/static) carry their own, hash-based one
// (lib/static-csp-cache-handler.mjs).
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

// Browser caching for files that are not content-hashed. (Next already sends
// `public, max-age=31536000, immutable` for /_next/static, which covers the
// self-hosted Inter font and every JS/CSS chunk; /landing.css carries a
// content hash in its URL and sets its own immutable header.)
const DAY = 86_400;
const assetCacheHeaders = [
  // Share image and home-screen icon: generated once at build, rarely change.
  { source: "/og-image.png", value: `public, max-age=${DAY}, stale-while-revalidate=${7 * DAY}` },
  { source: "/apple-touch-icon.png", value: `public, max-age=${DAY}, stale-while-revalidate=${7 * DAY}` },
  { source: "/icon.svg", value: `public, max-age=${DAY}, stale-while-revalidate=${7 * DAY}` },
  // The wordmark sprite every page header and footer references
  // (app/brand.tsx) — it changes with a rebrand, not a deploy.
  { source: "/brand/:file*", value: `public, max-age=${7 * DAY}, stale-while-revalidate=${30 * DAY}` },
  // PDF fonts (lib/pdf/fonts.ts), never changed in place.
  { source: "/fonts/:file*", value: `public, max-age=${30 * DAY}, immutable` },
].map(({ source, value }) => ({ source, headers: [{ key: "Cache-Control", value }] }));

const nextConfig: NextConfig = {
  // Next's file-system ISR cache, plus the hash-based Content-Security-Policy
  // for each prerendered public page, stored with the page itself.
  cacheHandler: path.join(process.cwd(), "src/lib/static-csp-cache-handler.mjs"),
  // The floating Next.js "N" dev indicator overlaps form content at
  // mobile widths and ends up in every screenshot we take for design
  // review. Disable it — it's a dev-only overlay and we still get
  // build errors, type errors, and HMR feedback through the CLI.
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }, ...assetCacheHeaders];
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
