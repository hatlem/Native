"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { authLimiter } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/client-ip";
import { validateClaimForm } from "@/lib/org-invite";
import { passwordlessSignIn } from "@/lib/passwordless-signin";

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

  const ip = await clientIp();
  if (!(await authLimiter.check(`invite:ip:${ip}`)).ok) {
    redirect(`/${locale}/publisher/claim/${token}?error=rate`);
  }

  // Password is optional — an empty one creates a passwordless account
  // that signs in via the magic-link provider (same as org invites).
  const form = validateClaimForm(name, password);
  if (!token || !form.ok) {
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

  const passwordHash = form.passwordless ? null : await bcrypt.hash(password, 10);

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
    if (form.passwordless) {
      await passwordlessSignIn(createdUserId, ip);
    } else {
      await signIn("credentials", {
        email: invite.email,
        password,
        redirect: false,
      });
    }
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/${locale}/signin`);
    }
    throw error;
  }
  redirect(`/${locale}/publisher`);
}

// Claim a writer-invite token: validate it (single-use, time-limited),
// create a User in CONTENT role, bind an empty WriterProfile, mark the
// invite claimed, and sign the user in.
//
// Mirrors claimPublisherInvite exactly — same email-lock, same rate
// limiter, same duplicate-email handling.
export async function claimWriterInviteSignup(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const token = String(formData.get("token") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const password = String(formData.get("password") || "");
  const submittedEmail = String(formData.get("email") || "")
    .toLowerCase()
    .trim();

  const ip = await clientIp();
  if (!(await authLimiter.check(`invite:ip:${ip}`)).ok) {
    redirect(`/${locale}/writer/claim/${token}?error=rate`);
  }

  // Password optional — mirrors claimPublisherInvite.
  const form = validateClaimForm(name, password);
  if (!token || !form.ok) {
    redirect(`/${locale}/writer/claim/${token}?error=1`);
  }

  const invite = await prisma.writerInvite.findUnique({
    where: { token },
    select: { id: true, email: true, expiresAt: true, claimedAt: true },
  });
  if (!invite || invite.claimedAt || invite.expiresAt.getTime() <= Date.now()) {
    redirect(`/${locale}/writer/claim/${token}`);
  }
  if (submittedEmail && submittedEmail !== invite.email) {
    redirect(`/${locale}/writer/claim/${token}?error=1`);
  }

  const passwordHash = form.passwordless ? null : await bcrypt.hash(password, 10);

  let createdUserId: string | null = null;
  try {
    createdUserId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: invite.email,
          name: name || null,
          role: "CONTENT",
          passwordHash,
          // Clicking the invite link proves mailbox ownership — account
          // starts verified and bypasses the email-confirmation gate.
          emailVerifiedAt: new Date(),
        },
      });
      await tx.writerProfile.create({ data: { userId: user.id } });
      await tx.writerInvite.update({
        where: { id: invite.id },
        data: { claimedAt: new Date(), claimedByUserId: user.id },
      });
      return user.id;
    });
  } catch {
    // Unique-email violation — send to sign-in.
    redirect(`/${locale}/signin`);
  }

  if (!createdUserId) redirect(`/${locale}/writer/claim/${token}?error=1`);
  await recordAudit(
    createdUserId,
    "writer.invite_claimed",
    `WriterInvite:${invite.id}`,
    { ip },
  );

  try {
    if (form.passwordless) {
      await passwordlessSignIn(createdUserId, ip);
    } else {
      await signIn("credentials", {
        email: invite.email,
        password,
        redirect: false,
      });
    }
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/${locale}/signin`);
    }
    throw error;
  }
  redirect(`/${locale}/writer`);
}
