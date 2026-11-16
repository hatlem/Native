// Which page loads are served from the prerendered public tree (app/static).
//
// The [locale] tree renders every page per request: its root layout reads the
// session (signed-in nav, badges) and the per-request CSP nonce. For a visitor
// without a session the public pages below are the same for everyone, so they
// are prerendered once per locale under app/static/[locale] and the
// middleware rewrites to them — the URL stays /<locale>/<page>. Visitors with
// a session cookie keep the [locale] tree (their header, their redirects).
//
// Pure and dependency-free so middleware can import it and node:test cover it.

export const STATIC_TREE_PREFIX = "/static";

// Path after /<locale>/ ("" is the landing page). Pages that read the query
// string, the session or a token are not listed.
export const STATIC_PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "",
  "about",
  "api",
  "catalog",
  "changelog",
  "contact",
  "for-advertisers",
  "for-agencies",
  "for-publishers",
  "formats",
  "help",
  "how-it-works",
  "pricing",
  "privacy",
  "resources/creative-specs",
  "security",
  "subprocessors",
  "terms",
]);

export type StaticRewriteInput = {
  method: string;
  pathname: string;
  locales: readonly string[];
  hasSession: boolean;
  isServerAction: boolean;
  dev: boolean;
};

/** The app/static path to serve instead, or null to render the [locale] page. */
export function staticPublicRewrite(input: StaticRewriteInput): string | null {
  // Dev renders everything on demand, so there is no cached page (and no
  // policy) to serve; actions run against the [locale] page they came from.
  if (input.dev || input.hasSession || input.isServerAction) return null;
  if (input.method !== "GET" && input.method !== "HEAD") return null;
  const m = input.pathname.match(/^\/([^/]+)(?:\/(.*?))?\/?$/);
  if (!m || !input.locales.includes(m[1])) return null;
  const rest = m[2] ?? "";
  if (!STATIC_PUBLIC_PATHS.has(rest)) return null;
  return `${STATIC_TREE_PREFIX}/${m[1]}${rest ? `/${rest}` : ""}`;
}

/** A direct request for the internal tree: answered 404, never rendered. */
export function isStaticTreePath(pathname: string): boolean {
  return pathname === STATIC_TREE_PREFIX || pathname.startsWith(`${STATIC_TREE_PREFIX}/`);
}
