"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authLimiter } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { generateToken, hashToken, tokenExpiry } from "@/lib/tokens";
import { emailAdapter } from "@/lib/notify";
import { magicLinkEmail } from "@/lib/mail/templates/magic-link";
import { welcomeEmail } from "@/lib/mail/templates/welcome";
import { checkBusinessEmailWithMx } from "@/lib/email-policy";
import { appUrl, appName } from "@/lib/url";
import { clientIp } from "@/lib/client-ip";

export async function register(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const email = String(formData.get("email") || "")
    .toLowerCase()
    .trim();
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
