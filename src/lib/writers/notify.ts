// Email to writers: the pool invite and new line assignments. Writers have
// no in-app inbox of their own yet, so email is how they learn there is
// work waiting. Both senders swallow and log delivery failures — the invite
// or assignment itself is already committed, and the desk UI shows what to
// do when an invite email didn't go out (emailedAt stays null).

import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { emailAdapter } from "@/lib/notify";
import { appName, appUrl } from "@/lib/url";
import { DEFAULT_INVITE_TTL_DAYS } from "@/lib/publisher-invite";
import { writerAssignedEmail, writerInviteEmail } from "@/lib/mail/templates/writer";
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

// Tells a writer they've been assigned a line, in the language they'll be
// writing in when their profile lists it (see writerEmailLocale).
export async function sendWriterAssignedEmail(args: {
  orderLineId: string;
  writerId: string;
}): Promise<void> {
  const writer = await prisma.writerProfile.findUnique({
    where: { id: args.writerId },
    select: {
      user: { select: { email: true, deactivatedAt: true } },
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

  const locale = writerEmailLocale({
    languages: writer.languages,
    contentLanguage: languageForCountry(product.title.countryCode),
  });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const built = writerAssignedEmail({
    locale,
    format: tType(product.type),
    titleName: product.title.name,
    url: absolute(`/${locale}/writer/lines/${args.orderLineId}`),
    appName: appName(),
  });
  try {
    await emailAdapter({ to: writer.user.email, ...built });
  } catch (err) {
    console.error("writer_assigned.email_failed", { orderLineId: args.orderLineId, err });
  }
}
