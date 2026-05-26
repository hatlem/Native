import { layout } from "./layout";
import { strings } from "./strings";

export type NewSigninAlertArgs = {
  ip: string;
  at: string;
  resetUrl: string;
  locale: string;
  appName: string;
};

export function newSigninAlertEmail(args: NewSigninAlertArgs): {
  subject: string;
  text: string;
  html: string;
} {
  const t = strings(args.locale).newSigninAlert;
  const body = t.body(args.ip, args.at);
  return {
    subject: t.subject(args.appName),
    text: `${body}\n\n${args.resetUrl}\n\n${t.footer}`,
    html: layout({
      preheader: t.preheader,
      heading: t.heading,
      body,
      cta: { label: t.cta, url: args.resetUrl },
      footer: t.footer,
      appName: args.appName,
    }),
  };
}
