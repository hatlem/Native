import { layout } from "./layout";
import { strings } from "./strings";

export type PasswordChangedArgs = {
  ip: string;
  at: string;
  locale: string;
  appName: string;
};

export function passwordChangedEmail(args: PasswordChangedArgs): {
  subject: string;
  text: string;
  html: string;
} {
  const t = strings(args.locale).passwordChanged;
  const body = t.body(args.ip, args.at);
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
