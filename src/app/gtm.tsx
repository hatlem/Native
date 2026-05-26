import Script from "next/script";

export const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;

// Consent Mode v2 defaults to *denied* — required for EU/EEA (GDPR).
// A consent management platform deployed via GTM can later call
// gtag('consent','update',...) to grant storage. GTM only loads when a
// container id is configured, so non-configured environments ship no
// third-party code at all.
//
// The `nonce` prop is the per-request CSP nonce minted by middleware.ts.
// Without it the inline scripts are blocked by `script-src 'nonce-…'`.
export function GtmScripts({ nonce }: { nonce?: string }) {
  if (!GTM_ID) return null;
  return (
    <>
      <Script id="gtm-consent-default" strategy="beforeInteractive" nonce={nonce}>
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',functionality_storage:'denied',personalization_storage:'denied',security_storage:'granted',wait_for_update:500});`}
      </Script>
      <Script id="gtm-loader" strategy="afterInteractive" nonce={nonce}>
        {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`}
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
