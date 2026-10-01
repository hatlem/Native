import Script from "next/script";

export const GETCOOKIES_DOMAIN_ID = process.env.NEXT_PUBLIC_GETCOOKIES_DOMAIN_ID;
export const GETCOOKIES_ORIGIN = "https://getcookies.co";

// The consent banner (GetCookies CMP). It renders the cookie banner, stores the
// visitor's choice and pushes gtag('consent','update', …) for Google Consent
// Mode v2, so the GA4 tag in GTM only sets cookies once the visitor has said
// yes. Our own defaults in gtm.tsx (everything denied) are pushed first and
// stay the floor; the widget only ever raises consent from there.
//
// Mounted BEFORE the GTM loader so a returning visitor's stored choice is
// re-applied before tags fire (GTM waits `wait_for_update` ms for it).
//
// Ships nothing unless a domain id is configured — dev, tests and previews
// carry no third-party code. getcookies.co needs no script-src entry (the
// nonce covers the loader and 'strict-dynamic' what it inserts); its
// config/consent fetches need connect-src — see middleware.ts buildCsp.
export function GetCookiesScripts({ nonce }: { nonce?: string }) {
  if (!GETCOOKIES_DOMAIN_ID) return null;
  // The official 1 KB loader (GetCookies → Innebyggingskode → "Standard
  // Website"). It re-applies a stored choice as consent defaults, then inserts
  // the full widget from getcookies.co itself; 'strict-dynamic' trusts that
  // insertion because this tag carries the nonce.
  return (
    <Script
      id="getcookies-loader"
      src={`${GETCOOKIES_ORIGIN}/api/v1/widget/loader.js`}
      data-domain-id={GETCOOKIES_DOMAIN_ID}
      strategy="afterInteractive"
      nonce={nonce}
    />
  );
}
