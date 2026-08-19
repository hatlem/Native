import { test } from "node:test";
import assert from "node:assert/strict";
import middleware, { buildCsp, mergeMiddlewareHeaders } from "./middleware";
import { NextRequest } from "next/server";

test("mergeMiddlewareHeaders drops every internal x-middleware-* directive header but keeps client-visible headers", () => {
  const intlHeaders = new Headers();
  intlHeaders.set("x-middleware-override-headers", "x-next-intl-locale");
  intlHeaders.set("x-middleware-request-x-next-intl-locale", "no");
  intlHeaders.set("x-middleware-rewrite", "https://nativespin.com/no/plan");
  intlHeaders.append("set-cookie", "NEXT_LOCALE=no; Path=/");
  intlHeaders.set("link", "</no/plan>; rel=alternate; hreflang=no");
  intlHeaders.set("vary", "Accept-Language");

  const reqHeaders = new Headers();
  const passthrough = mergeMiddlewareHeaders(intlHeaders, reqHeaders);

  const passthroughKeys = [...passthrough.keys()];
  for (const k of passthroughKeys) {
    assert.ok(
      !k.toLowerCase().startsWith("x-middleware-"),
      `passthrough leaked internal directive header: ${k}`,
    );
  }
  assert.equal(passthrough.get("set-cookie"), "NEXT_LOCALE=no; Path=/");
  assert.equal(passthrough.get("link"), "</no/plan>; rel=alternate; hreflang=no");
  assert.equal(passthrough.get("vary"), "Accept-Language");
});

test("mergeMiddlewareHeaders folds next-intl's locale request header into reqHeaders alongside x-nonce", () => {
  const intlHeaders = new Headers();
  intlHeaders.set("x-middleware-request-x-next-intl-locale", "sv");

  const reqHeaders = new Headers();
  reqHeaders.set("x-nonce", "test-nonce-value");
  mergeMiddlewareHeaders(intlHeaders, reqHeaders);

  assert.equal(reqHeaders.get("x-nonce"), "test-nonce-value");
  assert.equal(reqHeaders.get("x-next-intl-locale"), "sv");
});

test("mergeMiddlewareHeaders is a no-op on reqHeaders when next-intl set no locale header", () => {
  const intlHeaders = new Headers();
  intlHeaders.set("set-cookie", "foo=bar");

  const reqHeaders = new Headers();
  reqHeaders.set("x-nonce", "n");
  mergeMiddlewareHeaders(intlHeaders, reqHeaders);

  assert.equal(reqHeaders.get("x-next-intl-locale"), null);
  assert.equal(reqHeaders.get("x-nonce"), "n");
});

test("redirect responses (locale routing) pass through unmodified with the CSP header attached", () => {
  // "/" with no locale prefix triggers next-intl's redirect to the default
  // locale (routing.ts: defaultLocale "en", localePrefix default "always").
  // This is next-intl's own response returned as-is (middleware.ts:98-101) —
  // mergeMiddlewareHeaders is not involved here, only the CSP is attached.
  const req = new NextRequest(new URL("https://nativespin.com/"));
  const res = middleware(req);

  assert.equal(res.status, 307);
  const location = res.headers.get("location");
  assert.ok(location, "expected a Location header on the redirect");
  assert.ok(res.headers.get("content-security-policy"), "expected CSP header on the redirect response");
});

test("CSP regression: buildCsp still emits the nonce and the same directive shape", () => {
  const csp = buildCsp("abc123==");
  assert.match(csp, /script-src 'self' 'nonce-abc123==' 'strict-dynamic'/);
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
  assert.match(csp, /img-src 'self' data: https:/);
  assert.match(csp, /font-src 'self' data:/);
  // Browser uploads PUT straight to R2 with a presigned url.
  assert.match(csp, /connect-src 'self' https:\/\/\*\.r2\.cloudflarestorage\.com/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /upgrade-insecure-requests/);
});
