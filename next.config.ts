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
  // try first (Tobias scenario). Send them to the real API docs at /api
  // rather than 307-ing them silently to the home page.
  async redirects() {
    return [
      { source: "/developers", destination: "/api", permanent: false },
      { source: "/docs", destination: "/api", permanent: false },
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
