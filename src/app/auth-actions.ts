"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import bcrypt from "bcryptjs";
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
import { checkBusinessEmailWithMx } from "@/lib/email-policy";
import { PLAN_COOKIE, PLAN_BRIEF_COOKIE } from "@/lib/basket";
import { CLIENT_COOKIE } from "@/lib/workspace";

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
      // Disambiguate the "valid password, just unverified" case from
      // truly-wrong credentials. Telling that user "Invalid email or
      // password" sends them to forgot-password when the real fix is
      // to click a link in their inbox. Gated on a successful bcrypt
      // compare so we don't leak existence to anyone with a guess.
      const u = await prisma.user.findUnique({
        where: { email },
        select: { id: true, passwordHash: true, emailVerifiedAt: true },
      });
      if (u?.passwordHash && !u.emailVerifiedAt) {
        const ok = await bcrypt.compare(password, u.passwordHash);
        if (ok) {
          const raw = generateToken();
          await prisma.magicLinkToken.create({
            data: {
              userId: u.id,
              tokenHash: hashToken(raw),
              expiresAt: tokenExpiry(),
              requestedIp: ip,
            },
          });
          const url = `${appUrl()}/${locale}/magic-link/${raw}`;
          const msg = magicLinkEmail({ url, locale, appName: appName() });
          const unverifiedUserId = u.id;
          after(async () => {
            try {
              await emailAdapter({ to: email, subject: msg.subject, text: msg.text, html: msg.html });
            } catch (err) {
              console.error("auth.verify_email_resend_failed", { userId: unverifiedUserId, err });
            }
            await recordAudit(unverifiedUserId, "auth.verify_email_resent", `User:${email}`, { ip });
          });
          redirect(`/${locale}/check-email?verify=1`);
        }
      }
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

  const ip = await clientKey();
  // Preserve form input on validation error. Password is deliberately
  // never echoed back; market + phone now live in onboarding so they
  // don't appear here anymore.
  const preservedParams = new URLSearchParams();
  if (name) preservedParams.set("name", name);
  if (orgName) preservedParams.set("orgName", orgName);
  if (email) preservedParams.set("email", email);
  const preservedQs = preservedParams.toString();
  const tail = preservedQs ? `&${preservedQs}` : "";

  if (!(await authLimiter.check(`signup:ip:${ip}`)).ok) {
    redirect(`/${locale}/signup?error=rate${tail}`);
  }

  // Signup gate is now: email + orgName + (password OR consent to use
  // magic-link). Faktureringsmarked / VAT-marked moves to onboarding —
  // it's a legal-entity attribute, not a moment-of-creation requirement.
  // Password is optional; an empty password commits the user to a
  // magic-link-only signin path and triggers a magic-link email.
  const passwordlessSignup = password.length === 0;
  if (!email || !orgName) {
    redirect(`/${locale}/signup?error=1${tail}`);
  }
  if (!passwordlessSignup && password.length < 8) {
    redirect(`/${locale}/signup?error=password_length${tail}`);
  }

  // Company-email gate: reject free providers (gmail, yahoo, …),
  // disposable services (mailinator, 10minutemail, …) and domains
  // with no MX records (typos like "gnail.com", parked domains).
  const policy = await checkBusinessEmailWithMx(email);
  if (!policy.ok) {
    await recordAudit(email, "auth.signup_email_rejected", `User:${email}`, {
      ip,
      reason: policy.reason,
    });
    redirect(`/${locale}/signup?error=email_business${tail}`);
  }

  const passwordHash = passwordlessSignup
    ? null
    : await bcrypt.hash(password, 10);
  let createdUserId: string | null = null;
  try {
    createdUserId = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: orgName,
          type: "ADVERTISER",
          // marketCode is set during onboarding (next stop after signup).
          marketCode: null,
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
  await recordAudit(createdUserId, "user.register", `User:${email}`, {
    ip,
    orgName,
    passwordless: passwordlessSignup,
  });

  const catalogUrl = `${appUrl()}/${locale}/onboarding`;
  const welcome = welcomeEmail({ catalogUrl, locale, appName: appName() });
  try {
    await emailAdapter({ to: email, subject: welcome.subject, text: welcome.text, html: welcome.html });
  } catch (err) {
    console.error("auth.welcome_email_failed", { userId: createdUserId, err });
  }

  // Both signup paths (password + passwordless) deliver a magic-link
  // and land the user on /check-email. The link consume in
  // src/app/[locale]/magic-link/[token]/route.ts performs the
  // single-use + emailVerifiedAt update atomically, then signs the
  // user in — so the first session is always gated behind inbox
  // ownership. Password users can sign in normally via credentials
  // AFTER verification (the credentials provider rejects accounts
  // with emailVerifiedAt === null).
  const raw = generateToken();
  await prisma.magicLinkToken.create({
    data: {
      userId: createdUserId,
      tokenHash: hashToken(raw),
      expiresAt: tokenExpiry(),
      requestedIp: ip,
    },
  });
  const url = `${appUrl()}/${locale}/magic-link/${raw}`;
  const msg = magicLinkEmail({ url, locale, appName: appName() });
  const newUserId = createdUserId;
  after(async () => {
    try {
      await emailAdapter({ to: email, subject: msg.subject, text: msg.text, html: msg.html });
    } catch (err) {
      console.error("auth.magic_link_email_failed_on_signup", { userId: newUserId, err });
    }
    await recordAudit(
      newUserId,
      passwordlessSignup ? "auth.magic_link_signup_sent" : "auth.verify_email_sent",
      `User:${email}`,
      { ip },
    );
  });
  redirect(`/${locale}/check-email`);
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
          // Reaching this point requires clicking the invite link in
          // the invited mailbox — that's proof of ownership, so the
          // account starts verified and bypasses the credentials gate.
          emailVerifiedAt: new Date(),
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
  // Clear the basket/brief cookies so the next user on this browser
  // doesn't inherit the previous session's plan basket. The cookies
  // are not user-scoped (they predate auth), so we treat sign-out as
  // the natural "abandon plan" boundary. Found via scenario testing:
  // a fresh-signup buyer landed on /plan with the prior user's lines
  // already selected.
  const store = await cookies();
  store.delete(PLAN_COOKIE);
  store.delete(PLAN_BRIEF_COOKIE);
  // Also drop the agency client-switch cookie so a logout doesn't
  // leave the next user with someone else's client context.
  store.delete(CLIENT_COOKIE);
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
  return process.env.AUTH_APP_NAME ?? "NativeSpin";
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
    // Token row MUST exist before the email leaves — otherwise a fast
    // recipient could click the link before the row is committed.
    const raw = generateToken();
    await prisma.magicLinkToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(raw),
        expiresAt: tokenExpiry(),
        requestedIp: ip,
      },
    });
    // Hand the email send + audit write to `next/server`'s `after()` so
    // they run AFTER the response is committed. This closes most of the
    // timing-attack window between the user-exists branch (SMTP latency,
    // ~10²ms) and the unknown-email branch (audit only, ~10ms). Both
    // branches return the same /check-email redirect on the same code
    // path — the post-response work is invisible to the attacker.
    const url = `${appUrl()}/${locale}/magic-link/${raw}`;
    const msg = magicLinkEmail({ url, locale, appName: appName() });
    const userId = user.id;
    const userEmail = user.email;
    after(async () => {
      try {
        await emailAdapter({ to: userEmail, subject: msg.subject, text: msg.text, html: msg.html });
      } catch (err) {
        console.error("auth.magic_link_email_failed", { userId, err });
      }
      await recordAudit(userId, "auth.magic_link_requested", `User:${userEmail}`, { ip });
    });
  } else {
    // Same shape: audit also deferred so timing parity holds.
    after(async () => {
      await recordAudit(email, "auth.magic_link_requested_unknown", `User:${email}`, { ip });
    });
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
