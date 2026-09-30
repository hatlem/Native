// Messages to writers: the pool invite, new line assignments and change
// requests on their drafts. The assignment goes out as its own designed email
// plus an inbox row; a change request is a regular notice (email + inbox).
// Every sender swallows and logs delivery failures — the invite or
// assignment itself is already committed, and the desk UI shows what to do
// when an invite email didn't go out (emailedAt stays null).
//
// Language: the writer's User.locale (set from the invite language when they
// claimed it, then from each sign-in), else the profile heuristic in
// writerEmailLocale.

import { prisma } from "@/lib/prisma";
import { emailAdapter, notifyUser, recipientLocale } from "@/lib/notify";
import { appName, appUrl } from "@/lib/url";
import { DEFAULT_INVITE_TTL_DAYS } from "@/lib/publisher-invite";
import { writerAssignedEmail, writerInviteEmail } from "@/lib/mail/templates/writer";
import { productTypeLabel } from "@/lib/notices/messages";
import type { BuyerLocale } from "@/lib/market-locale";
import { asEmailLocale, writerEmailLocale } from "./email-locale";
import { languageForCountry } from "./criteria";
import { writerClaimPath } from "./invite";

function absolute(path: string): string {
  return `${appUrl().replace(/\/+$/, "")}${path}`;
}

// Sends (or re-sends) an invite email and stamps emailedAt on success.
// Returns whether the email went out.
export async function sendWriterInviteEmail(args: {
  inviteId: string;
  inviterName: string;
}): Promise<boolean> {
  const invite = await prisma.writerInvite.findUnique({
    where: { id: args.inviteId },
    select: { id: true, email: true, token: true, locale: true },
  });
  if (!invite) return false;
  const locale = asEmailLocale(invite.locale) ?? "en";
  const built = writerInviteEmail({
    locale,
    inviterName: args.inviterName,
    url: absolute(writerClaimPath(locale, invite.token)),
    validDays: DEFAULT_INVITE_TTL_DAYS,
    appName: appName(),
  });
  try {
    await emailAdapter({ to: invite.email, ...built });
  } catch (err) {
    console.error("writer_invite.email_failed", { inviteId: invite.id, err });
    return false;
  }
  await prisma.writerInvite.update({
    where: { id: invite.id },
    data: { emailedAt: new Date() },
  });
  return true;
}

// Tells a writer they've been assigned a line — email and inbox row — in
// their own language (see the header).
export async function sendWriterAssignedEmail(args: {
  orderLineId: string;
  writerId: string;
}): Promise<void> {
  const writer = await prisma.writerProfile.findUnique({
    where: { id: args.writerId },
    select: {
      user: { select: { id: true, email: true, locale: true, deactivatedAt: true } },
      languages: { select: { language: true, proficiency: true } },
    },
  });
  if (!writer || writer.user.deactivatedAt) return;

  const line = await prisma.orderLine.findUnique({
    where: { id: args.orderLineId },
    select: { productId: true },
  });
  const product = line?.productId
    ? await prisma.product.findUnique({
        where: { id: line.productId },
        select: { type: true, title: { select: { name: true, countryCode: true } } },
      })
    : null;
  if (!product) return;

  const fallbackLocale = writerEmailLocale({
    languages: writer.languages,
    contentLanguage: languageForCountry(product.title.countryCode),
  });
  const locale = recipientLocale(writer.user.locale, fallbackLocale);
  const built = writerAssignedEmail({
    locale,
    format: productTypeLabel(product.type, locale),
    titleName: product.title.name,
    url: absolute(`/${locale}/writer/lines/${args.orderLineId}`),
    appName: appName(),
  });
  try {
    await emailAdapter({ to: writer.user.email, ...built });
  } catch (err) {
    console.error("writer_assigned.email_failed", { orderLineId: args.orderLineId, err });
  }
  // The inbox row: the same copy, re-rendered in whatever language the
  // writer reads /notifications in. The email above already went out.
  await notifyUser(
    writer.user.id,
    {
      kind: "ASSET_REVIEW",
      template: {
        key: "writerAssigned",
        params: { titleName: product.title.name, productType: product.type, orderLineId: args.orderLineId },
      },
    },
    { fallbackLocale, email: false },
  );
}

/** The language to fall back to for a writer who has never signed in. */
export async function writerFallbackLocale(writerId: string): Promise<BuyerLocale> {
  const languages = await prisma.writerLanguage.findMany({
    where: { writerId },
    select: { language: true, proficiency: true },
  });
  return writerEmailLocale({ languages });
}
