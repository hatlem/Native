import {
  ONE_CLICK_API_PATH,
  ONE_CLICK_KIND_HEADER,
  ONE_CLICK_TOKEN_HEADER,
  oneClickUnsubscribeTarget,
} from "./lib/outreach/one-click";
import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";
import { hasSessionCookie, requiresSession, signinPath } from "./lib/auth-gate";
import { appUrl } from "./lib/url";
import { REQUEST_ID_HEADER } from "./lib/log";
import { buildNonceCsp } from "./lib/csp-policy.mjs";
import { isStaticTreePath, staticPublicRewrite } from "./lib/static-public";

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

// Correlation id for one request: reuse the edge proxy's id when it sends a
// sane one (so our logs join up with Railway's), else mint one. It is set on
// the request (server code reads it via lib/request-log) and echoed on the
// response, so a user can quote it from the network tab.
export function requestIdFor(incoming: string | null): string {
  if (incoming && /^[A-Za-z0-9_.:-]{8,128}$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}

// The policy itself lives in lib/csp-policy.mjs, shared with the prerendered
// pages' cache handler (lib/static-csp-cache-handler.mjs).
export function buildCsp(nonce: string): string {
  return buildNonceCsp(nonce);
}

// Pure merge of next-intl's middleware response into ours, extracted so
// it is node:test-able. Two jobs:
//
// 1. Forward next-intl's request-header addition (x-next-intl-locale,
//    carried as the internal directive `x-middleware-request-…`) onto
//    `reqHeaders` BEFORE the final NextResponse is built, so ONE
//    consistent override list is generated for both x-nonce and the
//    locale header.
// 2. Return the client-visible headers to copy onto the final response
//    (set-cookie NEXT_LOCALE, link alternates, vary, …) while skipping
//    every internal `x-middleware-*` directive header — previously the
//    blanket copy leaked `x-middleware-request-x-nonce` (and the CSP
//    nonce with it) all the way to the browser and clobbered Next's
//    override-list bookkeeping.
export function mergeMiddlewareHeaders(
  intlHeaders: Headers,
  reqHeaders: Headers,
): Headers {
  const intlLocale = intlHeaders.get("x-middleware-request-x-next-intl-locale");
  if (intlLocale) reqHeaders.set("x-next-intl-locale", intlLocale);

  const passthrough = new Headers();
  intlHeaders.forEach((v, k) => {
    if (k.toLowerCase().startsWith("x-middleware-")) return;
    passthrough.append(k, v);
  });
  return passthrough;
}

// Where a signed-out page view must go instead (lib/auth-gate), or null to
// carry on. Only for GET/HEAD page loads: a POST here is a server action whose
// own guard answers it, and a 307 would replay the POST against /signin.
export function signedOutRedirect(req: NextRequest): string | null {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const { pathname, search } = req.nextUrl;
  const m = pathname.match(/^\/([^/]+)(?:\/(.*))?$/);
  if (!m || !(routing.locales as readonly string[]).includes(m[1])) return null;
  if (!requiresSession(m[2] ?? "")) return null;
  if (hasSessionCookie(req.cookies.getAll().map((c) => c.name))) return null;
  return signinPath(m[1], pathname + search);
}

// www.<host> → <host>, for page loads only (a POST is a server action that
// must not be replayed cross-origin). Browser storage is per origin: the
// cookie banner's stored choice (GetCookies keeps it in localStorage), the
// session cookie and the catalog's compare selection given on one host were
// missing on the other, and the sign-in redirect (appUrl) already moves every
// www visitor to the apex — so the banner asked again.
export function canonicalHostRedirect(req: NextRequest, canonical: string): string | null {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  let canonicalUrl: URL;
  try {
    canonicalUrl = new URL(canonical);
  } catch {
    return null;
  }
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (host !== `www.${canonicalUrl.host.toLowerCase()}`) return null;
  const { pathname, search } = req.nextUrl;
  return `${canonicalUrl.origin}${pathname}${search}`;
}

export default function middleware(req: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp(nonce);
  const requestId = requestIdFor(req.headers.get(REQUEST_ID_HEADER));

  // A mailbox provider's one-click unsubscribe (RFC 8058) POSTs to the
  // opt-out page URL named in List-Unsubscribe; the page only answers GET,
  // so hand it to the API route (lib/outreach/one-click.ts).
  const oneClick = oneClickUnsubscribeTarget({
    method: req.method,
    pathname: req.nextUrl.pathname,
    isServerAction: req.headers.has("next-action"),
  });
  if (oneClick) {
    // The rewritten handler still sees the ORIGINAL URL's query string, so
    // the target travels as request headers (set here, never by the client).
    const headers = new Headers(req.headers);
    headers.set(ONE_CLICK_KIND_HEADER, oneClick.kind);
    headers.set(ONE_CLICK_TOKEN_HEADER, encodeURIComponent(oneClick.token));
    return NextResponse.rewrite(new URL(ONE_CLICK_API_PATH, req.url), { request: { headers } });
  }

  const canonicalHost = canonicalHostRedirect(req, appUrl());
  if (canonicalHost) return NextResponse.redirect(canonicalHost, 308);

  // The prerendered public tree is reached only through the rewrite below.
  if (isStaticTreePath(req.nextUrl.pathname)) {
    return new NextResponse(null, { status: 404, headers: { [REQUEST_ID_HEADER]: requestId } });
  }

  // Signed out on a protected page: a real 307 to sign-in, decided before
  // anything renders (a page-level redirect streams as 200 + meta refresh).
  // appUrl(), not req.url: behind Railway's proxy the inbound URL can carry
  // an internal host.
  const signin = signedOutRedirect(req);
  if (signin) {
    const res = NextResponse.redirect(new URL(signin, appUrl()), 307);
    res.headers.set("Content-Security-Policy", csp);
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  }

  // Let next-intl resolve the locale (may redirect for "/" → "/en", etc.,
  // and internally rewrite locale-prefixed paths so [locale] segments
  // resolve correctly).
  const intlRes = intlMiddleware(req);

  // For redirects the response IS the final answer — the next request
  // will get a fresh middleware pass with its own nonce/headers.
  if (intlRes.headers.get("Location")) {
    intlRes.headers.set("Content-Security-Policy", csp);
    intlRes.headers.set(REQUEST_ID_HEADER, requestId);
    return intlRes;
  }

  // A public page for a visitor without a session: the prerendered copy
  // (lib/static-public). Its Content-Security-Policy is stored with the page
  // (lib/static-csp-cache-handler.mjs) — hashes of its inline scripts instead
  // of a nonce — so none is set here: a second policy would also be enforced.
  const staticPath = staticPublicRewrite({
    method: req.method,
    pathname: req.nextUrl.pathname,
    locales: routing.locales,
    hasSession: hasSessionCookie(req.cookies.getAll().map((c) => c.name)),
    isServerAction: req.headers.has("next-action"),
    dev: process.env.NODE_ENV === "development",
  });
  if (staticPath) {
    const target = req.nextUrl.clone();
    target.pathname = staticPath;
    const reqHeaders = new Headers(req.headers);
    reqHeaders.set(REQUEST_ID_HEADER, requestId);
    const passthrough = mergeMiddlewareHeaders(intlRes.headers, reqHeaders);
    const res = NextResponse.rewrite(target, { request: { headers: reqHeaders } });
    passthrough.forEach((v, k) => {
      if (k.toLowerCase() === "set-cookie") res.headers.append(k, v);
      else res.headers.set(k, v);
    });
    // The same URL is a different page for a signed-in visitor: no shared
    // (CDN) caching of the signed-out copy. Browsers revalidate (ETag).
    res.headers.set("Cache-Control", "private, no-cache");
    const vary = res.headers.get("vary");
    res.headers.set("Vary", vary ? `${vary}, Cookie` : "Cookie");
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  }

  // Both the passthrough case and the next-intl internal-rewrite case
  // need the request-header init for x-nonce so RSCs can attach it to
  // any inline <script>/<style> the strict CSP would otherwise block.
  // Rebuilding the response is the only way to surface request headers
  // to downstream RSCs in Next.js 15.
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-nonce", nonce);
  reqHeaders.set(REQUEST_ID_HEADER, requestId);
  // Fold next-intl's locale request header into the same override list
  // as x-nonce and collect the client-visible response headers to keep.
  // Internal x-middleware-* directives (including x-middleware-rewrite —
  // NextResponse.rewrite() emits its own) are dropped here.
  const passthrough = mergeMiddlewareHeaders(intlRes.headers, reqHeaders);
  // Preserve next-intl's internal rewrite directive if it set one.
  const rewriteUrl = intlRes.headers.get("x-middleware-rewrite");
  const res = rewriteUrl
    ? NextResponse.rewrite(rewriteUrl, { request: { headers: reqHeaders } })
    : NextResponse.next({ request: { headers: reqHeaders } });
  passthrough.forEach((v, k) => {
    // append keeps multiple Set-Cookie values distinct; everything else
    // is single-valued and safe to overwrite.
    if (k.toLowerCase() === "set-cookie") res.headers.append(k, v);
    else res.headers.set(k, v);
  });
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set(REQUEST_ID_HEADER, requestId);
  return res;
}

export const config = {
  // Skip Next internals and static assets — they don't need a per-request
  // nonce or a locale match.
  matcher: ["/((?!api|go|offer|_next|_vercel|.*\\..*).*)"],
};
