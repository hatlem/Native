import { layout } from "./layout";
import { strings } from "./strings";

export type PasswordResetArgs = {
  url: string;
  locale: string;
  appName: string;
};

export function passwordResetEmail(args: PasswordResetArgs): {
  subject: string;
  text: string;
  html: string;
} {
  const t = strings(args.locale).passwordReset;
  return {
    subject: t.subject(args.appName),
    text: `${t.body}\n\n${args.url}\n\n${t.footer}`,
    html: layout({
      preheader: t.preheader,
      heading: t.heading,
      body: t.body,
      cta: { label: t.cta, url: args.url },
      footer: t.footer,
      appName: args.appName,
    }),
  };
}
