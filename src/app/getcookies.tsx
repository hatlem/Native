import Script from "next/script";

export const GETCOOKIES_DOMAIN_ID = process.env.NEXT_PUBLIC_GETCOOKIES_DOMAIN_ID;
// Bumped by GetCookies when the banner configuration changes (cache buster).
const GETCOOKIES_WIDGET_VERSION = process.env.NEXT_PUBLIC_GETCOOKIES_WIDGET_VERSION ?? "1";
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
// carry no third-party code. The loader is the snippet GetCookies generates,
// nonce'd because the CSP is 'strict-dynamic': the script element it creates
// inherits trust from this nonce'd script, so getcookies.co needs no
// script-src entry (connect-src does need it — see middleware.ts buildCsp).
export function GetCookiesScripts({ nonce }: { nonce?: string }) {
  if (!GETCOOKIES_DOMAIN_ID) return null;
  return (
    <Script id="getcookies-loader" strategy="afterInteractive" nonce={nonce}>
      {`(function(){window.getCookiesConfig={domainId:'${GETCOOKIES_DOMAIN_ID}',version:${Number(GETCOOKIES_WIDGET_VERSION) || 1}};var s=document.createElement('script');s.src='${GETCOOKIES_ORIGIN}/static/widget.js?v=${Number(GETCOOKIES_WIDGET_VERSION) || 1}';s.async=true;document.head.appendChild(s);})();`}
    </Script>
  );
}
