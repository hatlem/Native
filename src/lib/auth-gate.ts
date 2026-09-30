// Signed-out gate for the app's protected pages, run in middleware so a
// signed-out visitor gets a real HTTP 307 to sign-in (with the page they
// wanted as `next`) BEFORE anything renders. Page-level guards can't do that:
// every [locale] page renders inside a streamed layout, so a redirect() or
// notFound() thrown by the page arrives after a 200 has been sent and turns
// into a client-side meta refresh. Pages keep their own checks — this is the
// fast, optimistic layer (cookie presence only, no DB, edge-safe); an expired
// or forged cookie still falls through to them.
//
// Pure and dependency-free so middleware can import it and node:test can
// cover it.

// First path segment(s) after the locale that require an account. The
// catalog index and every marketing page stay public; a title page
// (catalog/<slug>) and compare need an account, as their pages already say.
const PROTECTED_SEGMENTS = new Set([
  "home",
  "account",
  "agency",
  "articles",
  "campaign",
  "desk",
  "favorites",
  "invoices",
  "lists",
  "notifications",
  "onboarding",
  "orders",
  "plan",
  "publisher",
  "reports",
  "requests",
  "writer",
]);

// Account-creation pages that live under a protected segment: an invited
// publisher or writer opens these signed out, by design.
const PUBLIC_SUBPATHS = [/^publisher\/claim(\/|$)/, /^writer\/claim(\/|$)/];

/** `rest` is the path after `/<locale>/`, without leading slash or query. */
export function requiresSession(rest: string): boolean {
  const clean = rest.replace(/^\/+|\/+$/g, "");
  if (PUBLIC_SUBPATHS.some((re) => re.test(clean))) return false;
  const [first, second] = clean.split("/");
  if (first === "catalog") return !!second;
  return PROTECTED_SEGMENTS.has(first ?? "");
}

// Auth.js v5 session cookie, plain on http and __Secure- on https; large
// JWTs are chunked into `<name>.0`, `<name>.1`, …
const SESSION_COOKIE = /^(__Secure-)?authjs\.session-token(\.\d+)?$/;

export function hasSessionCookie(cookieNames: Iterable<string>): boolean {
  for (const name of cookieNames) if (SESSION_COOKIE.test(name)) return true;
  return false;
}

// Same-origin path check. Prevents ?next=https://evil.com or //evil.com
// open redirects when bouncing a user back after sign-in or onboarding.
export function safeNext(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

/** The sign-in page, remembering where to go afterwards when that's safe. */
export function signinPath(locale: string, next?: string | null): string {
  const target = safeNext(next, "");
  return target
    ? `/${locale}/signin?next=${encodeURIComponent(target)}`
    : `/${locale}/signin`;
}
