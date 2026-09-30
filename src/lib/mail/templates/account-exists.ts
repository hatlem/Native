import { layout } from "./layout";
import { strings } from "./strings";

export type AccountExistsArgs = {
  // One-tap magic-link sign-in for the existing account.
  url: string;
  locale: string;
  appName: string;
};

export function accountExistsEmail(args: AccountExistsArgs): {
  subject: string;
  text: string;
  html: string;
} {
  const t = strings(args.locale).accountExists;
  const body = t.body(args.appName);
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
