// The Content-Security-Policy, shared by the two places that send it:
//
//   - src/middleware.ts, for every dynamically rendered page: a fresh nonce per
//     request, script-src 'nonce-…' 'strict-dynamic'.
//   - src/lib/static-csp-cache-handler.mjs, for the prerendered public pages
//     (app/static/**): no request exists when they are rendered, so no nonce
//     can be put in them. Their policy lists the SHA-256 of every inline
//     script in the page instead, plus 'self' for Next's own chunks.
//
// Plain JavaScript (with JSDoc types) because the cache handler is loaded by
// Node directly, outside the app bundle; no imports, so the Edge middleware
// bundle can use it too. Reads the environment at call time.
// The two inline scripts app/gtm.tsx renders when a GTM container is set.
// They live here so the prerendered pages' policy can list their hashes:
// next/script inserts them from JavaScript, where the page's HTML (which the
// cache handler hashes) does not show them as <script> elements.
export const GTM_CONSENT_DEFAULT_JS = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',functionality_storage:'denied',personalization_storage:'denied',security_storage:'granted',wait_for_update:500});`;

/** @param {string} id */
export function gtmLoaderJs(id) {
  return `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');`;
}

/**
 * Scripts the page inserts itself and the static policy must allow by hash.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
export function insertedInlineScripts(env) {
  return env.NEXT_PUBLIC_GTM_ID ? [GTM_CONSENT_DEFAULT_JS, gtmLoaderJs(env.NEXT_PUBLIC_GTM_ID)] : [];
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
function hosts(env) {
  const hasGtm = !!env.NEXT_PUBLIC_GTM_ID;
  return {
    gtmScript: hasGtm ? " https://www.googletagmanager.com" : "",
    gtmConnect: hasGtm
      ? " https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com"
      : "",
    gtmFrame: hasGtm ? " https://www.googletagmanager.com" : "",
    // GetTalk booking embeds (onboarding call step + catalog banner popup)
    // render an <iframe src="https://gettalk.co/...">.
    getTalkFrame: env.NEXT_PUBLIC_GETTALK_USERNAME ? " https://gettalk.co" : "",
    // GetCookies consent banner (app/getcookies.tsx): its config, region and
    // consent-log calls are fetches, which need connect-src.
    getCookies: env.NEXT_PUBLIC_GETCOOKIES_DOMAIN_ID ? " https://getcookies.co" : "",
  };
}

/**
 * Every directive but script-src, in the order they are sent.
 * @param {string} scriptSrc
 * @param {NodeJS.ProcessEnv} env
 */
function policy(scriptSrc, env) {
  const h = hosts(env);
  return [
    `default-src 'self'`,
    scriptSrc,
    // Tailwind + React inline `style=` attributes are pervasive; a
    // hash/nonce policy isn't feasible without a wholesale refactor.
    `style-src 'self' 'unsafe-inline'`,
    // blob: — the /preview tool shows a visitor's own hero photo straight
    // from the file input via URL.createObjectURL (never uploaded). Only
    // same-origin script can mint a blob: URL, so this admits no third party.
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    // Article/rate-card uploads go straight from the browser to R2 with
    // a presigned PUT (fetch), so the bucket host must be connectable.
    `connect-src 'self' https://*.r2.cloudflarestorage.com${h.gtmConnect}${h.getCookies}`,
    `frame-src 'self'${h.gtmFrame}${h.getTalkFrame}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");
}

/**
 * The policy for a dynamically rendered page, built around its nonce.
 * @param {string} nonce
 * @param {NodeJS.ProcessEnv} [env]
 */
export function buildNonceCsp(nonce, env = process.env) {
  const h = hosts(env);
  // Next.js dev wraps every module in eval() (eval-source-map), so without
  // 'unsafe-eval' the React bootstrap silently fails and the page never
  // hydrates. Production uses static chunks and doesn't need this.
  const devEval = env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  // 'strict-dynamic' lets the nonced bootstrap load Next's chunk graph
  // without each chunk needing its own nonce. Modern browsers ignore the
  // host allow-list once strict-dynamic is in effect — that's fine, the GTM
  // bootstrap is what loads gtm.js, and the nonced GetCookies loader what
  // inserts the widget.
  return policy(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${h.gtmScript}${devEval}`, env);
}

/**
 * The policy for a prerendered page: the hashes of its inline scripts, and
 * 'self' for Next's chunks (parser-inserted <script src> tags, which carry no
 * nonce here, so 'strict-dynamic' cannot be used). Third-party scripts are
 * allowed by host: GTM's loader and GetCookies' loader and widget. Never
 * 'unsafe-inline'.
 * @param {string[]} hashes  'sha256-…' sources, quotes included
 * @param {NodeJS.ProcessEnv} [env]
 */
export function buildStaticCsp(hashes, env = process.env) {
  const h = hosts(env);
  const list = hashes.length ? ` ${hashes.join(" ")}` : "";
  return policy(`script-src 'self'${list}${h.gtmScript}${h.getCookies}`, env);
}

// Marks a page as prerendered for the static policy (the app/static layout
// puts it on <html>); the cache handler only touches pages that carry it.
export const STATIC_CSP_MARKER = 'data-csp="static"';
