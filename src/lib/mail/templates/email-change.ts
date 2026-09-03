import { layout } from "./layout";
import { strings } from "./strings";

export type EmailChangeConfirmArgs = {
  url: string;
  newEmail: string;
  locale: string;
  appName: string;
};

// To the NEW address — carries the only link that can complete the change.
export function emailChangeConfirmEmail(args: EmailChangeConfirmArgs): {
  subject: string;
  text: string;
  html: string;
} {
  const t = strings(args.locale).emailChangeConfirm;
  const body = t.body(args.newEmail);
  return {
    subject: t.subject(args.appName),
    text: `${body}\n\n${args.url}\n\n${t.footer}`,
    html: layout({
      preheader: t.preheader,
      heading: t.heading,
      body,
      cta: { label: t.cta, url: args.url },
      footer: t.footer,
      appName: args.appName,
    }),
  };
}

export type EmailChangeNoticeArgs = {
  newEmail: string;
  locale: string;
  appName: string;
};

// To the OLD address — deliberately link-free. Its job is to warn, and a
// confirmation link in this mail would let a hijacked session confirm its
// own change from the mailbox it already controls.
export function emailChangeNoticeEmail(args: EmailChangeNoticeArgs): {
  subject: string;
  text: string;
  html: string;
} {
  const t = strings(args.locale).emailChangeNotice;
  const body = t.body(args.newEmail);
  return {
    subject: t.subject(args.appName),
    text: `${body}\n\n${t.footer}`,
    html: layout({
      preheader: t.preheader,
      heading: t.heading,
      body,
      footer: t.footer,
      appName: args.appName,
    }),
  };
}
