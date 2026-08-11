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

import { NotificationKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appUrl, appName } from "@/lib/url";
import { layout } from "@/lib/mail/templates/layout";

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
};

// Swap by setting `emailAdapter` from the boot path; default is console.
export let emailAdapter: EmailAdapter = consoleAdapter;
export function setEmailAdapter(next: EmailAdapter) {
  emailAdapter = next;
}

export type NotifyInput = {
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string;
};

// In-app notifications keep the relative link (read by the app's own
// <Link>), but a relative path in an email is just inert text — Gmail
// won't auto-link "/en/desk/xyz" the way it would a real URL. Resolve to
// absolute only for the outbound email.
function absoluteLink(link: string | undefined): string | undefined {
  if (!link) return undefined;
  return /^https?:\/\//.test(link) ? link : `${appUrl().replace(/\/$/, "")}${link}`;
}

async function writeOne(userId: string, n: NotifyInput, email?: string | null) {
  await prisma.notification.create({
    data: {
      userId,
      kind: n.kind,
      title: n.title,
      body: n.body ?? null,
      link: n.link ?? null,
    },
  });
  if (email) {
    const link = absoluteLink(n.link);
    try {
      await emailAdapter({
        to: email,
        subject: n.title,
        text: (n.body ?? "") + (link ? `\n\nView: ${link}` : ""),
        html: layout({
          preheader: n.body ?? n.title,
          heading: n.title,
          body: n.body ?? "",
          cta: link ? { label: "View", url: link } : undefined,
          footer: "This is an automated notification from NativeSpin.",
          appName: appName(),
        }),
      });
    } catch (err) {
      console.error("notify.email_failed", { userId, err });
    }
  }
}

// Send to every desk/superadmin user.
export async function notifyDesk(n: NotifyInput) {
  const users = await prisma.user.findMany({
    where: { role: { in: ["DESK", "SUPERADMIN"] } },
    select: { id: true, email: true },
  });
  await Promise.all(users.map((u) => writeOne(u.id, n, u.email)));
}

// Send to every user belonging to an org.
export async function notifyOrg(organizationId: string, n: NotifyInput) {
  const users = await prisma.user.findMany({
    where: { organizationId },
    select: { id: true, email: true },
  });
  await Promise.all(users.map((u) => writeOne(u.id, n, u.email)));
}

// Send to every user belonging to a publisher (portal users).
export async function notifyPublisher(publisherId: string, n: NotifyInput) {
  const users = await prisma.user.findMany({
    where: { publisherId },
    select: { id: true, email: true },
  });
  await Promise.all(users.map((u) => writeOne(u.id, n, u.email)));
}
