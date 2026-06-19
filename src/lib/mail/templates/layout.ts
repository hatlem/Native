// One HTML shell for every auth email. Inline styles only (Outlook-safe).
// The only external asset is the hosted wordmark PNG, referenced by an
// absolute URL; its alt text falls back to the app name when a client
// blocks images. The CTA button degrades to a styled link.
//
// Palette mirrors the NativeSpin brand tokens (src/app/landing-styles.ts):
// ink on cream paper, not a generic white card with a blue accent.

import { appUrl } from "@/lib/url";

export type LayoutArgs = {
  preheader: string;
  heading: string;
  body: string;
  cta?: { label: string; url: string };
  footer: string;
  appName: string;
};

const COLOR_PAGE = "#E4DECB"; // paper-2 — slightly deeper cream behind the card
const COLOR_CARD = "#EDE8DB"; // paper
const COLOR_INK = "#14110C"; // ink — headings + body
const COLOR_MUTED = "#6B6452"; // ink-mute — footer + preheader
const COLOR_CONTRAST = "#EDE8DB"; // primary-contrast — text on the ink button
const COLOR_HAIR = "rgba(20,17,12,0.18)"; // hairline border

// Wordmark is 1353×254 (~5.33:1). 150×28 keeps it crisp; the 320px PNG
// covers retina.
const LOGO_W = 150;
const LOGO_H = 28;

export function layout(args: LayoutArgs): string {
  const logoUrl = `${appUrl().replace(/\/$/, "")}/brand/nativespin-wordmark-email.png`;
  const cta = args.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
        <tr><td>
          <a href="${escapeHtml(args.cta.url)}"
             style="background:${COLOR_INK};color:${COLOR_CONTRAST};text-decoration:none;padding:12px 22px;border-radius:6px;display:inline-block;font-weight:600;font-size:15px;">
            ${escapeHtml(args.cta.label)}
          </a>
        </td></tr>
       </table>`
    : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="color-scheme" content="light only"><title>${escapeHtml(args.heading)}</title></head>
<body style="margin:0;padding:24px;background:${COLOR_PAGE};font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:${COLOR_INK};">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${escapeHtml(args.preheader)}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;">
    <tr><td style="padding:8px 4px 20px;">
      <img src="${escapeHtml(logoUrl)}" width="${LOGO_W}" height="${LOGO_H}" alt="${escapeHtml(args.appName)}"
           style="display:block;border:0;outline:none;text-decoration:none;width:${LOGO_W}px;max-width:${LOGO_W}px;height:auto;">
    </td></tr>
    <tr><td style="background:${COLOR_CARD};border:1px solid ${COLOR_HAIR};border-radius:10px;padding:32px;">
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:${COLOR_INK};">${escapeHtml(args.heading)}</h1>
      <p style="margin:0;font-size:15px;line-height:1.55;color:${COLOR_INK};">${escapeHtml(args.body)}</p>
      ${cta}
      <p style="margin:24px 0 0;font-size:13px;color:${COLOR_MUTED};line-height:1.5;">${escapeHtml(args.footer)}</p>
    </td></tr>
    <tr><td style="padding:16px 4px;color:${COLOR_MUTED};font-size:12px;">${escapeHtml(args.appName)}</td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
