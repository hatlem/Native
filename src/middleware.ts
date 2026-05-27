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

function isPassthrough(res: NextResponse): boolean {
  return (
    !res.headers.get("Location") && !res.headers.get("x-middleware-rewrite")
  );
}

export default function middleware(req: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp(nonce);

  // Let next-intl resolve the locale (may redirect for "/" → "/en", etc.).
  const intlRes = intlMiddleware(req);

  // For redirects/rewrites the layout will run on the *next* request with
  // a fresh nonce, so we only need to set the response header here.
  if (!isPassthrough(intlRes)) {
    intlRes.headers.set("Content-Security-Policy", csp);
    return intlRes;
  }

  // Passthrough: inject the nonce as a request header so the layout can
  // read it via `headers()` and thread it into <Script nonce> / <style nonce>.
  // Also surface the current pathname so the layout can decide whether
  // to enforce the onboarding gate without each authenticated page
  // re-implementing the check. We have to rebuild the NextResponse
  // because next-intl's `.next()` call doesn't expose its request-header
  // init.
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-nonce", nonce);
  reqHeaders.set("x-pathname", req.nextUrl.pathname);
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  intlRes.headers.forEach((v, k) => res.headers.set(k, v));
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // Skip Next internals and static assets — they don't need a per-request
  // nonce or a locale match.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
