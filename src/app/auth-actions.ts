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
  if (!ipCheck.ok || !emailCheck.ok) {
    redirect(`/${locale}/signin?error=rate`);
  }

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      await recordAudit(email || "anonymous", "auth.signin_failed", `User:${email}`, { ip });
      redirect(`/${locale}/signin?error=1`);
    }
    throw error;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });
  await recordAudit(user?.id ?? email, "auth.signin", `User:${email}`, { ip });
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
  if (!(await authLimiter.check(`signup:ip:${ip}`)).ok) {
    redirect(`/${locale}/signup?error=rate`);
  }

  if (
    !email ||
    password.length < 8 ||
    !orgName ||
    !MARKET_CODES.includes(marketCode)
  ) {
    redirect(`/${locale}/signup?error=1`);
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
  if (!createdUserId) redirect(`/${locale}/signup?error=1`);
  await recordAudit(createdUserId, "user.register", `User:${email}`, { ip, orgName });

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
