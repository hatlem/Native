import { layout } from "./layout";
import { strings } from "./strings";

export type WelcomeArgs = {
  catalogUrl: string;
  locale: string;
  appName: string;
};

export function welcomeEmail(args: WelcomeArgs): {
  subject: string;
  text: string;
  html: string;
} {
  const t = strings(args.locale).welcome;
  const body = t.body(args.appName);
  return {
    subject: t.subject(args.appName),
    text: `${body}\n\n${args.catalogUrl}\n\n${t.footer}`,
    html: layout({
      preheader: t.preheader,
      heading: t.heading,
      body,
      cta: { label: t.cta, url: args.catalogUrl },
      footer: t.footer,
      appName: args.appName,
    }),
  };
}
