"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { authLimiter } from "@/lib/rate-limit";
import { generateToken, hashToken, tokenExpiry } from "@/lib/tokens";
import { validateEmailChange } from "@/lib/email-change";
import { checkBusinessEmailWithMx } from "@/lib/email-policy";
import { emailAdapter } from "@/lib/notify";
import {
  emailChangeConfirmEmail,
  emailChangeNoticeEmail,
} from "@/lib/mail/templates/email-change";
import { appUrl, appName } from "@/lib/url";
import { clientIp } from "@/lib/client-ip";

// Request a change of sign-in email. Nothing is written to User here — the
// address moves only when the link in the NEW mailbox is clicked (see
// src/app/[locale]/account/confirm-email/[token]/route.ts). That ordering is
// the whole security story: a typo'd address can't lock anyone out, and a
// hijacked session can't complete the move without also holding the new inbox.
//
// Unlike the anti-enumeration dance in the signed-out password-reset flow,
// this action talks straight to the user: they're authenticated, so telling
// them "that address is already in use" leaks nothing they couldn't learn by
// trying to sign up with it.
export async function requestEmailChange(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);
  const userId = session.user.id;

  const ip = await clientIp();
  const [ipCheck, userCheck] = await Promise.all([
    authLimiter.check(`email-change:ip:${ip}`),
    authLimiter.check(`email-change:user:${userId}`),
  ]);
  if (!ipCheck.ok || !userCheck.ok) {
    redirect(`/${locale}/account?error=rate#email`);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, passwordHash: true, organizationId: true },
  });
  if (!user) redirect(`/${locale}/signin`);

  const verdict = validateEmailChange(
    user.email,
    String(formData.get("newEmail") || ""),
  );
  if (!verdict.ok) {
    redirect(`/${locale}/account?error=${verdict.reason}#email`);
  }
  const newEmail = verdict.email;

  // Re-authenticate password holders. Someone who walks up to an unlocked
  // laptop shouldn't be one form away from owning the account; magic-link-only
  // users have no password to prove, and for them the confirmation link is the
  // only gate (same trade-off as setPassword in account-actions.ts).
  if (user.passwordHash) {
    const ok = await bcrypt.compare(
      String(formData.get("currentPassword") || ""),
      user.passwordHash,
    );
    if (!ok) {
      redirect(`/${locale}/account?error=email_password#email`);
    }
  }

  const taken = await prisma.user.findUnique({
    where: { email: newEmail },
    select: { id: true },
  });
  if (taken) {
    redirect(`/${locale}/account?error=email_taken#email`);
  }

  // Same company-email gate as signup, applied to the same population: org-side
  // accounts. Desk, publisher and writer accounts are onboarded by invitation
  // and legitimately use personal addresses, so gating them here would lock
  // them out of a change signup never asked them to pass.
  if (user.organizationId) {
    const policy = await checkBusinessEmailWithMx(newEmail);
    if (!policy.ok) {
      await recordAudit(userId, "user.email_change_rejected", `User:${userId}`, {
        reason: policy.reason,
      });
      redirect(`/${locale}/account?error=email_business#email`);
    }
  }

  // Supersede any earlier pending request: the newest address is the one the
  // user means, and leaving older tokens live would let a stale link redirect
  // the account somewhere they've since changed their mind about.
  const now = new Date();
  await prisma.emailChangeToken.updateMany({
    where: { userId, consumedAt: null },
    data: { consumedAt: now },
  });

  const raw = generateToken();
  await prisma.emailChangeToken.create({
    data: {
      userId,
      newEmail,
      tokenHash: hashToken(raw),
      expiresAt: tokenExpiry(),
      requestedIp: ip,
    },
  });

  const url = `${appUrl()}/${locale}/account/confirm-email/${raw}`;
  const confirm = emailChangeConfirmEmail({
    url,
    newEmail,
    locale,
    appName: appName(),
  });
  const notice = emailChangeNoticeEmail({
    newEmail,
    locale,
    appName: appName(),
  });

  // Both sends are best-effort and independent: a bounce at the old address
  // must not stop the user changing away from it, which is often exactly why
  // they're here (lost mailbox, changed employer).
  try {
    await emailAdapter({
      to: newEmail,
      subject: confirm.subject,
      text: confirm.text,
      html: confirm.html,
    });
  } catch (err) {
    console.error("user.email_change_confirm_failed", { userId, err });
  }
  try {
    await emailAdapter({
      to: user.email,
      subject: notice.subject,
      text: notice.text,
      html: notice.html,
    });
  } catch (err) {
    console.error("user.email_change_notice_failed", { userId, err });
  }

  await recordAudit(userId, "user.email_change_requested", `User:${userId}`, {
    newEmail,
    ip,
  });
  redirect(`/${locale}/account?ok=email_requested#email`);
}
