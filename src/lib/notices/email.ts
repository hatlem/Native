// The email a rendered notice goes out as: the notice's title and body inside
// the shared shell (lib/mail/templates/layout.ts), with the call to action,
// the plain-text link line and the footer in the recipient's language too —
// the trailing English "View:" used to follow even a Norwegian notice.

import type { BuyerLocale } from "@/lib/market-locale";
import { layout } from "@/lib/mail/templates/layout";
import { appName, appUrl } from "@/lib/url";
import type { RenderedNotice } from "./define";
import { noticeT } from "./messages";

export type NoticeEmail = { to: string; subject: string; text: string; html: string };

// In-app notifications keep the relative link (read by the app's own
// <Link>), but a relative path in an email is just inert text — Gmail
// won't auto-link "/en/desk/xyz" the way it would a real URL. Resolve to
// absolute only for the outbound email.
function absoluteLink(link: string): string | undefined {
  if (!link) return undefined;
  return /^https?:\/\//.test(link) ? link : `${appUrl().replace(/\/$/, "")}${link}`;
}

export function noticeEmail(to: string, n: RenderedNotice, locale: BuyerLocale): NoticeEmail {
  const t = noticeT(locale);
  const link = absoluteLink(n.link);
  return {
    to,
    subject: n.title,
    text: [n.body, link ? t("email.linkLine", { url: link }) : null].filter(Boolean).join("\n\n"),
    html: layout({
      preheader: n.body || n.title,
      heading: n.title,
      body: n.body,
      cta: link ? { label: t("email.cta"), url: link } : undefined,
      footer: t("email.footer"),
      appName: appName(),
    }),
  };
}
