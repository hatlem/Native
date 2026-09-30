// Notifications — writes one row per recipient into the in-DB inbox
// (the source of truth read by /[locale]/notifications) and fans out to
// an email adapter. The adapter is a console logger by default;
// providers like Resend/Postmark plug in by swapping
// `sendEmail` without touching callers.
//
// Recipients are resolved by role / scope, not by raw user id, so
// callers say "tell the desk" / "tell this org" and the helper picks
// users. That keeps the call sites readable and lets us add desk
// rotation, on-call schedules, etc. in one place.
//
// Every notice is a template (lib/notice-template.ts) — there is no way to
// pass a finished title/body, so nothing can go out English-only. Each
// recipient gets it in their own language: User.locale (the language they
// use NativeSpin in), else the audience's default — the org's home market
// for a buyer org, the publisher's market for a publisher, English for the
// desk. Links carry the same locale.

import { NotificationKind, Prisma } from "@prisma/client";
import { marketDefaultLocale, type BuyerLocale } from "@/lib/market-locale";
import { renderNotice, type NoticeTemplate, type RenderedNotice } from "@/lib/notice-template";
import { asNoticeLocale } from "@/lib/notices/messages";
import { noticeEmail } from "@/lib/notices/email";
import { prisma } from "@/lib/prisma";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  // Per-message overrides. When unset, the adapter falls back to its
  // configured defaults (AUTH_EMAIL_FROM / AUTH_EMAIL_REPLY_TO). Outreach
  // sets these so partnership mail comes from (and replies route to)
  // partnerships@, separate from transactional auth mail.
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
};

export type EmailAdapter = (msg: EmailMessage) => Promise<void>;

const consoleAdapter: EmailAdapter = async (msg) => {
  console.log("[email]", msg.to, "·", msg.subject);
  // Local E2E runs have no inbox: EMAIL_LOG_BODY=1 prints the plain-text body
  // so magic links and invite links can be followed. Console adapter only —
  // with RESEND_API_KEY set (prod) this adapter is never installed.
  if (process.env.EMAIL_LOG_BODY === "1") console.log("[email-body]", msg.to, "\n" + msg.text);
};

// Swap by setting `emailAdapter` from the boot path; default is console.
export let emailAdapter: EmailAdapter = consoleAdapter;
export function setEmailAdapter(next: EmailAdapter) {
  emailAdapter = next;
}

export type NotifyInput = {
  kind: NotificationKind;
  template: NoticeTemplate;
};

type Recipient = { id: string; email: string | null; locale: string | null };

const RECIPIENT_SELECT = { id: true, email: true, locale: true } as const;

/** The language a notice to this user is written in. */
export function recipientLocale(userLocale: string | null | undefined, fallback: BuyerLocale): BuyerLocale {
  return asNoticeLocale(userLocale) ?? fallback;
}

async function deliver(
  recipients: Recipient[],
  input: NotifyInput,
  fallback: BuyerLocale,
  opts: { email?: boolean } = {},
): Promise<void> {
  // Render once per language, not once per recipient.
  const rendered = new Map<BuyerLocale, RenderedNotice>();
  const renderFor = (locale: BuyerLocale): RenderedNotice => {
    let n = rendered.get(locale);
    if (!n) {
      n = renderNotice(input.template, locale);
      rendered.set(locale, n);
    }
    return n;
  };

  await Promise.all(
    recipients.map(async (r) => {
      const locale = recipientLocale(r.locale, fallback);
      const n = renderFor(locale);
      // title/body/link are the fallback for a row whose template can no
      // longer be parsed, and match the email this recipient got.
      await prisma.notification.create({
        data: {
          userId: r.id,
          kind: input.kind,
          title: n.title,
          body: n.body || null,
          link: n.link || null,
          messageKey: input.template.key,
          messageParams: input.template.params as Prisma.InputJsonValue,
        },
      });
      if (r.email && opts.email !== false) {
        try {
          await emailAdapter(noticeEmail(r.email, n, locale));
        } catch (err) {
          console.error("notify.email_failed", { userId: r.id, err });
        }
      }
    }),
  );
}

// Send to every desk/superadmin user.
export async function notifyDesk(input: NotifyInput) {
  const users = await prisma.user.findMany({
    where: { role: { in: ["DESK", "SUPERADMIN"] } },
    select: RECIPIENT_SELECT,
  });
  // The desk's working language is English unless a desk user set their own.
  await deliver(users, input, "en");
}

// Send to every user belonging to an org.
export async function notifyOrg(organizationId: string, input: NotifyInput) {
  const [org, users] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { marketCode: true } }),
    prisma.user.findMany({ where: { organizationId }, select: RECIPIENT_SELECT }),
  ]);
  // marketCode is nullable until onboarding completes; English is the safe
  // default (a wrong-language notice is worse than an English one).
  await deliver(users, input, org?.marketCode ? marketDefaultLocale(org.marketCode) : "en");
}

// Send to every user belonging to a publisher (portal users).
export async function notifyPublisher(publisherId: string, input: NotifyInput) {
  const [publisher, users] = await Promise.all([
    prisma.publisher.findUnique({ where: { id: publisherId }, select: { countryCode: true } }),
    prisma.user.findMany({ where: { publisherId }, select: RECIPIENT_SELECT }),
  ]);
  await deliver(users, input, publisher ? marketDefaultLocale(publisher.countryCode) : "en");
}

// Send to one user (a writer on their assignment). `fallbackLocale` covers a
// user who has never signed in; `email: false` writes the inbox row only,
// for a sender that already mails its own designed email.
export async function notifyUser(
  userId: string,
  input: NotifyInput,
  opts: { fallbackLocale?: BuyerLocale; email?: boolean } = {},
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ...RECIPIENT_SELECT, deactivatedAt: true },
  });
  if (!user || user.deactivatedAt) return;
  await deliver([user], input, opts.fallbackLocale ?? "en", { email: opts.email });
}
