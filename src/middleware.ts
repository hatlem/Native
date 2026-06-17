import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

// Per-request CSP nonce. Inline scripts (GTM bootstrap, ld+json) and
// styles (landing page `<style dangerouslySetInnerHTML>`) carry this
// value so the browser can authorise them — anything else is rejected by
// `script-src 'nonce-…'` / `script-src 'strict-dynamic'`.
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function buildCsp(nonce: string): string {
  const hasGtm = !!process.env.NEXT_PUBLIC_GTM_ID;
  const gtmScript = hasGtm ? " https://www.googletagmanager.com" : "";
  const gtmConnect = hasGtm
    ? " https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com"
    : "";
  const gtmFrame = hasGtm ? " https://www.googletagmanager.com" : "";
  // Next.js dev wraps every module in eval() (eval-source-map), so without
  // 'unsafe-eval' the React bootstrap silently fails and the page never
  // hydrates. Production uses static chunks and doesn't need this.
  const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

  return [
    `default-src 'self'`,
    // 'strict-dynamic' lets the nonced bootstrap load Next's chunk
    // graph without each chunk needing its own nonce. Drop modern
    // browsers ignore the host allow-list once strict-dynamic is in
    // effect — that's fine, the GTM bootstrap is what loads gtm.js.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${gtmScript}${devEval}`,
    // Tailwind + React inline `style=` attributes are pervasive; a
    // hash/nonce policy isn't feasible without a wholesale refactor.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: https:`,
    `font-src 'self' data:`,
    `connect-src 'self'${gtmConnect}`,
    `frame-src 'self'${gtmFrame}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");
}

export default function middleware(req: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp(nonce);

  // Let next-intl resolve the locale (may redirect for "/" → "/en", etc.,
  // and internally rewrite locale-prefixed paths so [locale] segments
  // resolve correctly).
  const intlRes = intlMiddleware(req);

  // For redirects the response IS the final answer — the next request
  // will get a fresh middleware pass with its own nonce/headers.
  if (intlRes.headers.get("Location")) {
    intlRes.headers.set("Content-Security-Policy", csp);
    return intlRes;
  }

  // Both the passthrough case and the next-intl internal-rewrite case
  // need the request-header init for x-nonce so RSCs can attach it to
  // any inline <script>/<style> the strict CSP would otherwise block.
  // Rebuilding the response is the only way to surface request headers
  // to downstream RSCs in Next.js 15.
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-nonce", nonce);
  // Preserve next-intl's internal rewrite directive if it set one.
  const rewriteUrl = intlRes.headers.get("x-middleware-rewrite");
  const res = rewriteUrl
    ? NextResponse.rewrite(rewriteUrl, { request: { headers: reqHeaders } })
    : NextResponse.next({ request: { headers: reqHeaders } });
  intlRes.headers.forEach((v, k) => {
    // Don't double-set the rewrite directive — NextResponse.rewrite()
    // emits its own.
    if (k.toLowerCase() === "x-middleware-rewrite") return;
    res.headers.set(k, v);
  });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // Skip Next internals and static assets — they don't need a per-request
  // nonce or a locale match.
  matcher: ["/((?!api|go|offer|_next|_vercel|.*\\..*).*)"],
};
