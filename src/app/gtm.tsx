import Script from "next/script";
import { GTM_CONSENT_DEFAULT_JS, gtmLoaderJs } from "@/lib/csp-policy.mjs";

export const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;

// Consent Mode v2 defaults to *denied* — required for EU/EEA (GDPR).
// A consent management platform deployed via GTM can later call
// gtag('consent','update',...) to grant storage. GTM only loads when a
// container id is configured, so non-configured environments ship no
// third-party code at all.
//
// The `nonce` prop is the per-request CSP nonce minted by middleware.ts.
// Without it the inline scripts are blocked by `script-src 'nonce-…'`.
// Prerendered pages (app/static) have no nonce: their hash-based policy
// lists the hashes of these two scripts (lib/csp-policy.mjs, where the
// script text lives so both sides use the same bytes).
export function GtmScripts({ nonce }: { nonce?: string }) {
  if (!GTM_ID) return null;
  return (
    <>
      <Script id="gtm-consent-default" strategy="beforeInteractive" nonce={nonce}>
        {GTM_CONSENT_DEFAULT_JS}
      </Script>
      <Script id="gtm-loader" strategy="afterInteractive" nonce={nonce}>
        {gtmLoaderJs(GTM_ID)}
      </Script>
    </>
  );
}

export function GtmNoscript() {
  if (!GTM_ID) return null;
  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
        title="gtm"
      />
    </noscript>
  );
}

