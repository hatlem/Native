"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import bcrypt from "bcryptjs";
import { MarketCode } from "@prisma/client";
import { signIn, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { landingForRole } from "@/lib/roles";
import { authLimiter } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { generateToken, hashToken, tokenExpiry } from "@/lib/tokens";
import { emailAdapter } from "@/lib/notify";
import { magicLinkEmail } from "@/lib/mail/templates/magic-link";
import { passwordResetEmail } from "@/lib/mail/templates/password-reset";
import { passwordChangedEmail } from "@/lib/mail/templates/password-changed";
import { recordSignIn } from "@/lib/auth-events";
import { welcomeEmail } from "@/lib/mail/templates/welcome";

const MARKET_CODES = Object.values(MarketCode) as string[];

async function clientKey(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

export async function authenticate(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const email = String(formData.get("email") || "")
    .toLowerCase()
    .trim();
  const password = String(formData.get("password") || "");

  // Rate-limit on the email AND the source IP — the attacker controls both
  // independently so we want either to slow them down.
  const ip = await clientKey();
  const [ipCheck, emailCheck] = await Promise.all([
    authLimiter.check(`signin:ip:${ip}`),
    authLimiter.check(`signin:email:${email}`),
  ]);
  const emailParam = email ? `&email=${encodeURIComponent(email)}` : "";
  if (!ipCheck.ok || !emailCheck.ok) {
    redirect(`/${locale}/signin?error=rate${emailParam}`);
  }

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      await recordAudit(email || "anonymous", "auth.signin_failed", `User:${email}`, { ip });
      redirect(`/${locale}/signin?error=1${emailParam}`);
    }
    throw error;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });
  await recordAudit(user?.id ?? email, "auth.signin", `User:${email}`, { ip });
  if (user?.id) {
    await recordSignIn({
      userId: user.id,
      userEmail: email,
      ip,
      locale,
      appName: appName(),
      resetUrl: `${appUrl()}/${locale}/forgot-password`,
    });
  }
  // Outside the try: redirect() throws NEXT_REDIRECT, which must not be caught.
  redirect(landingForRole(user?.role, locale));
}

export async function register(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const email = String(formData.get("email") || "")
    .toLowerCase()
    .trim();
  const password = String(formData.get("password") || "");
  const name = String(formData.get("name") || "").trim();
  const orgName = String(formData.get("orgName") || "").trim();
  const marketCode = String(formData.get("market") || "").trim();

  const ip = await clientKey();
  // Don't echo password back through the URL — everything else is recoverable.
  const preservedParams = new URLSearchParams();
  if (name) preservedParams.set("name", name);
  if (orgName) preservedParams.set("orgName", orgName);
  if (marketCode) preservedParams.set("market", marketCode);
  if (email) preservedParams.set("email", email);
  const preservedQs = preservedParams.toString();
  const tail = preservedQs ? `&${preservedQs}` : "";

  if (!(await authLimiter.check(`signup:ip:${ip}`)).ok) {
    redirect(`/${locale}/signup?error=rate${tail}`);
  }

  if (
    !email ||
    password.length < 8 ||
    !orgName ||
    !MARKET_CODES.includes(marketCode)
  ) {
    redirect(`/${locale}/signup?error=1${tail}`);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  let createdUserId: string | null = null;
  try {
    createdUserId = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: orgName,
          type: "ADVERTISER",
          marketCode: marketCode as MarketCode,
        },
      });
      const user = await tx.user.create({
        data: {
          email,
          name: name || null,
          role: "BUYER",
          passwordHash,
          organizationId: org.id,
        },
      });
      return user.id;
    });
  } catch {
    // Unique-email violation (or any create failure) — surface as a
    // friendly "already registered" rather than a 500.
  }
  // Don't leak whether the email already exists — same outcome as a
  // generic validation failure. The legitimate owner sees a sign-in
  // prompt via the standard ?error=1 banner; an attacker enumerating
  // emails learns nothing.
  if (!createdUserId) redirect(`/${locale}/signup?error=1${tail}`);
  await recordAudit(createdUserId, "user.register", `User:${email}`, { ip, orgName });

  const catalogUrl = `${appUrl()}/${locale}/catalog`;
  const welcome = welcomeEmail({ catalogUrl, locale, appName: appName() });
  try {
    await emailAdapter({ to: email, subject: welcome.subject, text: welcome.text, html: welcome.html });
  } catch (err) {
    console.error("auth.welcome_email_failed", { userId: createdUserId, err });
  }

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/${locale}/signin`);
    }
    throw error;
  }
  redirect(`/${locale}/catalog`);
}

// Claim a publisher-invite token: validate it (single-use, time-limited),
// create a User in PUBLISHER role bound to the pre-existing Publisher
// record, mark the invite claimed, sign the user in.
//
// Email is read-only on the claim form (locked to invite.email) so the
// audit chain stays tight — if the original recipient forwarded the
// link, the new claimant can't bind it to a different identity.
export async function claimPublisherInvite(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const token = String(formData.get("token") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const password = String(formData.get("password") || "");
  // Email is hard-locked to whatever the invite was sent to. We accept
  // it from the form so a tampered-with field can be caught + ignored;
  // the row in DB is the source of truth.
  const submittedEmail = String(formData.get("email") || "")
    .toLowerCase()
    .trim();

  const ip = await clientKey();
  if (!(await authLimiter.check(`invite:ip:${ip}`)).ok) {
    redirect(`/${locale}/publisher/claim/${token}?error=rate`);
  }

  if (!token || !name || password.length < 8) {
    redirect(`/${locale}/publisher/claim/${token}?error=1`);
  }

  const invite = await prisma.publisherInvite.findUnique({
    where: { token },
    select: {
      id: true,
      email: true,
      publisherId: true,
      expiresAt: true,
      claimedAt: true,
    },
  });
  if (
    !invite ||
    invite.claimedAt ||
    invite.expiresAt.getTime() <= Date.now()
  ) {
    redirect(`/${locale}/publisher/claim/${token}`);
  }
  if (submittedEmail && submittedEmail !== invite.email) {
    // Tampered email — refuse silently rather than leak whether the
    // mismatched address exists.
    redirect(`/${locale}/publisher/claim/${token}?error=1`);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  let createdUserId: string | null = null;
  try {
    createdUserId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: invite.email,
          name: name || null,
          role: "PUBLISHER",
          passwordHash,
          publisherId: invite.publisherId,
        },
      });
      await tx.publisherInvite.update({
        where: { id: invite.id },
        data: { claimedAt: new Date(), claimedByUserId: user.id },
      });
      return user.id;
    });
  } catch {
    // Unique-email violation (publisher tried to claim with an email
    // that already has a user). Send them to sign-in — if it's their
    // existing account, signing in pairs them with the publisher.
    redirect(`/${locale}/signin`);
  }

  if (!createdUserId) redirect(`/${locale}/publisher/claim/${token}?error=1`);
  await recordAudit(
    createdUserId,
    "publisher.invite_claimed",
    `Publisher:${invite.publisherId}`,
    { inviteId: invite.id, ip },
  );

  try {
    await signIn("credentials", {
      email: invite.email,
      password,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/${locale}/signin`);
    }
    throw error;
  }
  redirect(`/${locale}/publisher`);
}

export async function logout(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  await signOut({ redirectTo: `/${locale}` });
}

function appUrl(): string {
  return (
    process.env.AUTH_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000"
  );
}

function appName(): string {
  return process.env.AUTH_APP_NAME ?? "ATNative";
}

// Magic-link sign-in: user submits email, we email them a one-tap link.
// We always redirect to /check-email, regardless of whether the email
// matched a real account, to avoid account enumeration.
export async function requestMagicLink(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const email = String(formData.get("email") || "")
    .toLowerCase()
    .trim();

  const ip = await clientKey();
  const [ipCheck, emailCheck] = await Promise.all([
    authLimiter.check(`magic-link:ip:${ip}`),
    authLimiter.check(`magic-link:email:${email}`),
  ]);
  if (!ipCheck.ok || !emailCheck.ok) {
    redirect(`/${locale}/signin?error=rate`);
  }

  if (!email) {
    redirect(`/${locale}/check-email`);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });

  if (user) {
    const raw = generateToken();
    await prisma.magicLinkToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(raw),
        expiresAt: tokenExpiry(),
        requestedIp: ip,
      },
    });
    const url = `${appUrl()}/${locale}/magic-link/${raw}`;
    const msg = magicLinkEmail({ url, locale, appName: appName() });
    try {
      await emailAdapter({ to: user.email, subject: msg.subject, text: msg.text, html: msg.html });
    } catch (err) {
      console.error("auth.magic_link_email_failed", { userId: user.id, err });
    }
    await recordAudit(user.id, "auth.magic_link_requested", `User:${email}`, { ip });
  } else {
    await recordAudit(email, "auth.magic_link_requested_unknown", `User:${email}`, { ip });
  }

  redirect(`/${locale}/check-email`);
}

// Password reset request: same anti-enumeration as requestMagicLink.
export async function requestPasswordReset(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const email = String(formData.get("email") || "")
    .toLowerCase()
    .trim();

  const ip = await clientKey();
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
    const raw = generateToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(raw),
        expiresAt: tokenExpiry(),
        requestedIp: ip,
      },
    });
    const url = `${appUrl()}/${locale}/reset-password/${raw}`;
    const msg = passwordResetEmail({ url, locale, appName: appName() });
    try {
      await emailAdapter({ to: user.email, subject: msg.subject, text: msg.text, html: msg.html });
    } catch (err) {
      console.error("auth.password_reset_email_failed", { userId: user.id, err });
    }
    await recordAudit(user.id, "auth.password_reset_requested", `User:${email}`, { ip });
  } else if (user) {
    // User exists but has no password (passwordless-future or OAuth-only account):
    // there's nothing to reset. Keep the user-facing response identical to the
    // other branches (still /check-email) but emit a distinct audit kind so
    // ops can spot the case in the log.
    await recordAudit(user.id, "auth.password_reset_requested_no_password", `User:${email}`, { ip });
  } else {
    await recordAudit(email, "auth.password_reset_requested_unknown", `User:${email}`, { ip });
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

  const ip = await clientKey();
  if (!(await authLimiter.check(`reset-consume:ip:${ip}`)).ok) {
    redirect(`/${locale}/reset-password/${token}?error=rate`);
  }

  if (!token || newPassword.length < 8) {
    redirect(`/${locale}/reset-password/${token}?error=1`);
  }

  const hash = hashToken(token);
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const now = new Date();

  type Outcome =
    | { ok: true; userId: string; email: string }
    | { ok: false };

  const outcome = await prisma.$transaction<Outcome>(async (tx) => {
    const updated = await tx.passwordResetToken.updateMany({
      where: { tokenHash: hash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (updated.count !== 1) return { ok: false };

    const row = await tx.passwordResetToken.findUnique({
      where: { tokenHash: hash },
      select: { userId: true, user: { select: { email: true } } },
    });
    if (!row) return { ok: false };

    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash },
    });

    await tx.passwordResetToken.updateMany({
      where: { userId: row.userId, consumedAt: null, NOT: { tokenHash: hash } },
      data: { consumedAt: now },
    });

    return { ok: true, userId: row.userId, email: row.user.email };
  });

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
