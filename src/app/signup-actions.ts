"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { asNoticeLocale } from "@/lib/notices/messages";
import { authLimiter } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { generateToken, hashToken, tokenExpiry } from "@/lib/tokens";
import { emailAdapter } from "@/lib/notify";
import { magicLinkEmail } from "@/lib/mail/templates/magic-link";
import { welcomeEmail } from "@/lib/mail/templates/welcome";
import { accountExistsEmail } from "@/lib/mail/templates/account-exists";
import {
  checkBusinessEmailWithMx,
  emailDomain,
  emailPolicyErrorCode,
  suggestEmailDomain,
} from "@/lib/email-policy";
import { appUrl, appName } from "@/lib/url";
import { clientIp } from "@/lib/client-ip";

export async function register(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const email = String(formData.get("email") || "")
    .toLowerCase()
    .trim();
  // The domain the user already confirmed on the typo prompt: resubmitting
  // it unchanged means "yes, this is really our domain".
  const confirmedDomain = String(formData.get("confirmedDomain") || "").toLowerCase().trim();
  const password = String(formData.get("password") || "");
  const name = String(formData.get("name") || "").trim();
  const orgName = String(formData.get("orgName") || "").trim();

  const ip = await clientIp();
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

  // Lookalike of a big mail provider ("gnail.com"): ask before mailing a
  // magic link there. Squatted lookalikes pass the MX check below, so
  // this is the only thing between a typo and a stranger's inbox. It's a
  // prompt, not a block: a company that owns such a domain confirms once.
  const suggestion = suggestEmailDomain(email);
  if (suggestion && confirmedDomain !== emailDomain(email)) {
    await recordAudit(email, "auth.signup_email_typo_prompted", `User:${email}`, {
      ip,
      suggestion,
    });
    // The page recomputes the suggestion from the preserved address rather
    // than reading one from the URL, so a crafted link can't prompt
    // someone to "correct" their email to an attacker's.
    redirect(`/${locale}/signup?error=email_typo${tail}`);
  }

  // Company-email gate: reject free providers (gmail, yahoo, …),
  // disposable services (mailinator, 10minutemail, …) and domains
  // with no MX records (typos like "gnail.com", parked domains). Each
  // reason gets its own message — a typo isn't a Gmail problem.
  const policy = await checkBusinessEmailWithMx(email);
  if (!policy.ok) {
    await recordAudit(email, "auth.signup_email_rejected", `User:${email}`, {
      ip,
      reason: policy.reason,
    });
    redirect(`/${locale}/signup?error=${emailPolicyErrorCode(policy.reason)}${tail}`);
  }

  // Per-address cap on top of the per-IP one: every signup for an existing
  // address mails its owner (below), so without it the form doubles as a
  // way to flood someone's inbox from rotating IPs.
  if (!(await authLimiter.check(`signup:email:${email}`)).ok) {
    redirect(`/${locale}/signup?error=rate${tail}`);
  }

  // Hash before the existence check so both branches below pay the bcrypt
  // cost — it's the dominant term, and parity keeps response time from
  // telling an enumerator which branch ran.
  const passwordHash = passwordlessSignup
    ? null
    : await bcrypt.hash(password, 10);

  // No account enumeration: an address that already has an account gets
  // the same /check-email answer as a new one. The OWNER is the one told —
  // by email, with a one-tap sign-in — so a real "I forgot I signed up"
  // user gets straight back in and a prober learns nothing.
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, deactivatedAt: true },
  });
  if (existing) {
    await notifyExistingAccount(existing, email, locale, ip);
    redirect(`/${locale}/check-email?signup=1`);
  }

  let createdUserId: string;
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
          // The language they signed up in; emails and notices follow it.
          locale: asNoticeLocale(locale),
        },
      });
      // The org creator is its first, permanent ADMIN. Membership is the
      // source of truth for role + commit authority, so without this row a
      // brand-new advertiser would resolve activeRole=null / canCommit=false
      // and be locked out of checkout, accept-quote, and team invites.
      await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: org.id,
          role: "ADMIN",
          canCommit: true,
        },
      });
      return user.id;
    });
  } catch (err) {
    // Lost a race with a concurrent signup for the same address (unique
    // violation on User.email): that is the "already exists" case, answered
    // the same way as above. Anything else is a real failure.
    if (!isUniqueViolation(err)) throw err;
    const raced = await prisma.user.findUnique({
      where: { email },
      select: { id: true, deactivatedAt: true },
    });
    if (raced) await notifyExistingAccount(raced, email, locale, ip);
    redirect(`/${locale}/check-email?signup=1`);
  }
  await recordAudit(createdUserId, "user.register", `User:${email}`, {
    ip,
    orgName,
    passwordless: passwordlessSignup,
  });

  const catalogUrl = `${appUrl()}/${locale}/onboarding`;
  const welcome = welcomeEmail({ catalogUrl, locale, appName: appName() });
  const welcomeUserId = createdUserId;
  after(async () => {
    try {
      await emailAdapter({ to: email, subject: welcome.subject, text: welcome.text, html: welcome.html });
    } catch (err) {
      console.error("auth.welcome_email_failed", { userId: welcomeUserId, err });
    }
  });

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
  redirect(`/${locale}/check-email?signup=1`);
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}

// The "you already have an account" mail for a signup that hit an existing
// address. It carries a magic link, which also verifies an account that
// signed up earlier and never clicked its first link. A deactivated account
// gets nothing: the link couldn't sign it in, and "you're back" would be a
// lie. Mail and audit run after the response, like every other auth mail,
// so the two signup branches return on the same code path.
async function notifyExistingAccount(
  user: { id: string; deactivatedAt: Date | null },
  email: string,
  locale: string,
  ip: string,
): Promise<void> {
  if (user.deactivatedAt) {
    after(() => recordAudit(user.id, "auth.signup_existing_deactivated", `User:${email}`, { ip }));
    return;
  }
  const raw = generateToken();
  await prisma.magicLinkToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(raw),
      expiresAt: tokenExpiry(),
      requestedIp: ip,
    },
  });
  const msg = accountExistsEmail({
    url: `${appUrl()}/${locale}/magic-link/${raw}`,
    locale,
    appName: appName(),
  });
  after(async () => {
    try {
      await emailAdapter({ to: email, subject: msg.subject, text: msg.text, html: msg.html });
    } catch (err) {
      console.error("auth.account_exists_email_failed", { userId: user.id, err });
    }
    await recordAudit(user.id, "auth.signup_existing_account", `User:${email}`, { ip });
  });
}
