import { layout } from "./layout";
import { strings } from "./strings";

export type MagicLinkArgs = {
  url: string;
  locale: string;
  appName: string;
};

export function magicLinkEmail(args: MagicLinkArgs): {
  subject: string;
  text: string;
  html: string;
} {
  const t = strings(args.locale).magicLink;
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
