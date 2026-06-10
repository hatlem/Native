"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { after } from "next/server";
import bcrypt from "bcryptjs";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { landingForRole } from "@/lib/roles";
import { authLimiter } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { generateToken, hashToken, tokenExpiry } from "@/lib/tokens";
import { consumePasswordResetToken } from "@/lib/auth-tokens";
import { emailAdapter } from "@/lib/notify";
import { passwordResetEmail } from "@/lib/mail/templates/password-reset";
import { passwordChangedEmail } from "@/lib/mail/templates/password-changed";
import { recordSignIn } from "@/lib/auth-events";
import { appUrl, appName } from "@/lib/url";
import { clientIp } from "@/lib/client-ip";

// Password reset request: same anti-enumeration as requestMagicLink.
export async function requestPasswordReset(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const email = String(formData.get("email") || "")
    .toLowerCase()
    .trim();

  const ip = await clientIp();
  const [ipCheck, emailCheck] = await Promise.all([
    authLimiter.check(`reset:ip:${ip}`),
    authLimiter.check(`reset:email:${email}`),
  ]);
  if (!ipCheck.ok || !emailCheck.ok) {
    redirect(`/${locale}/forgot-password?error=rate`);
  }

  if (!email) {
    redirect(`/${locale}/check-email`);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, passwordHash: true },
  });

  if (user?.passwordHash) {
    // Token row MUST exist before the email leaves — otherwise a fast
    // recipient could click the reset link before the row is committed.
    const raw = generateToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(raw),
        expiresAt: tokenExpiry(),
        requestedIp: ip,
      },
    });
    // Defer the SMTP latency + audit write to after() so the three
    // request-side branches (has-password / no-password / unknown email)
    // all return on roughly the same wall-clock — closing the
    // enumeration timing channel.
    const url = `${appUrl()}/${locale}/reset-password/${raw}`;
    const msg = passwordResetEmail({ url, locale, appName: appName() });
    const userId = user.id;
    const userEmail = user.email;
    after(async () => {
      try {
        await emailAdapter({ to: userEmail, subject: msg.subject, text: msg.text, html: msg.html });
      } catch (err) {
        console.error("auth.password_reset_email_failed", { userId, err });
      }
      await recordAudit(userId, "auth.password_reset_requested", `User:${userEmail}`, { ip });
    });
  } else if (user) {
    // User exists but has no password (passwordless-future or OAuth-only account):
    // there's nothing to reset. Keep the user-facing response identical to the
    // other branches (still /check-email) but emit a distinct audit kind so
    // ops can spot the case in the log.
    const userId = user.id;
    after(async () => {
      await recordAudit(userId, "auth.password_reset_requested_no_password", `User:${email}`, { ip });
    });
  } else {
    after(async () => {
      await recordAudit(email, "auth.password_reset_requested_unknown", `User:${email}`, { ip });
    });
  }

  redirect(`/${locale}/check-email`);
}

// Consume a password-reset token: validate, update password, invalidate
// all other open reset tokens for the same user, fire the
// password-changed email, and sign the user in.
export async function resetPassword(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const token = String(formData.get("token") || "").trim();
  const newPassword = String(formData.get("password") || "");

  const ip = await clientIp();
  if (!(await authLimiter.check(`reset-consume:ip:${ip}`)).ok) {
    redirect(`/${locale}/reset-password/${token}?error=rate`);
  }

  if (!token || newPassword.length < 8) {
    redirect(`/${locale}/reset-password/${token}?error=1`);
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const now = new Date();

  // Atomic single-use consume + password swap + sibling-token
  // invalidation — see @/lib/auth-tokens.
  const outcome = await consumePasswordResetToken(token, passwordHash);

  if (!outcome.ok) {
    await recordAudit(token ? `token:${token.slice(0, 8)}…` : "anonymous", "auth.password_reset_invalid", `Token`, { ip });
    redirect(`/${locale}/reset-password/${token}?error=expired`);
  }

  await recordAudit(outcome.userId, "auth.password_reset_consumed", `User:${outcome.email}`, { ip });

  const msg = passwordChangedEmail({
    ip,
    at: now.toISOString().replace("T", " ").slice(0, 16) + " UTC",
    locale,
    appName: appName(),
  });
  try {
    await emailAdapter({ to: outcome.email, subject: msg.subject, text: msg.text, html: msg.html });
  } catch (err) {
    console.error("auth.password_changed_email_failed", { userId: outcome.userId, err });
  }

  try {
    await signIn("credentials", { email: outcome.email, password: newPassword, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/${locale}/signin`);
    }
    throw error;
  }

  // Use the recordSignIn helper to record IP + fire alert if needed.
  await recordSignIn({
    userId: outcome.userId,
    userEmail: outcome.email,
    ip,
    locale,
    appName: appName(),
    resetUrl: `${appUrl()}/${locale}/forgot-password`,
  });

  const fresh = await prisma.user.findUnique({
    where: { id: outcome.userId },
    select: { role: true },
  });
  redirect(landingForRole(fresh?.role, locale));
}
