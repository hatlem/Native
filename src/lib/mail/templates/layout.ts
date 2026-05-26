// One HTML shell for every auth email. Inline styles only (Outlook).
// No external assets. The CTA button degrades to a styled link.

export type LayoutArgs = {
  preheader: string;
  heading: string;
  body: string;
  cta?: { label: string; url: string };
  footer: string;
  appName: string;
};

const COLOR_BG = "#f5f6f8";
const COLOR_CARD = "#ffffff";
const COLOR_TEXT = "#1a1a1a";
const COLOR_MUTED = "#6b7280";
const COLOR_ACCENT = "#0b6cff";

export function layout(args: LayoutArgs): string {
  const cta = args.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
        <tr><td>
          <a href="${escapeHtml(args.cta.url)}"
             style="background:${COLOR_ACCENT};color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600;">
            ${escapeHtml(args.cta.label)}
          </a>
        </td></tr>
       </table>`
    : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(args.heading)}</title></head>
<body style="margin:0;padding:24px;background:${COLOR_BG};font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:${COLOR_TEXT};">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${escapeHtml(args.preheader)}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;">
    <tr><td style="padding:16px 0;color:${COLOR_MUTED};font-size:14px;">${escapeHtml(args.appName)}</td></tr>
    <tr><td style="background:${COLOR_CARD};border-radius:10px;padding:32px;">
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">${escapeHtml(args.heading)}</h1>
      <p style="margin:0;font-size:15px;line-height:1.55;color:${COLOR_TEXT};">${escapeHtml(args.body)}</p>
      ${cta}
      <p style="margin:24px 0 0;font-size:13px;color:${COLOR_MUTED};line-height:1.5;">${escapeHtml(args.footer)}</p>
    </td></tr>
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
