"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import bcrypt from "bcryptjs";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { recordAudit } from "@/lib/audit";
import { emailAdapter } from "@/lib/notify";
import { loadScope } from "@/lib/scope";
import { authLimiter } from "@/lib/rate-limit";
import { resolveOrgMembership, wouldRemoveLastAdmin, type MembershipRole } from "@/lib/membership";
import {
  newInviteToken,
  expiryFromNow,
  validateDelegationDate,
  buildOrgInviteEmail,
  orgInviteLink,
  validateOrgClaim,
} from "@/lib/org-invite";

async function clientKey(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

const LOCALES = ["en", "no", "sv", "da", "fi", "de"] as const;
type Locale = (typeof LOCALES)[number];
function asLocale(v: string): Locale {
  return (LOCALES as readonly string[]).includes(v) ? (v as Locale) : "en";
}

export async function inviteToOrg(formData: FormData) {
  const locale = asLocale(String(formData.get("locale") || "en"));
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const scope = await loadScope();
  const ws = scope.workspace;
  const orgId = ws?.activeOrgId ?? null;
  // Only an ADMIN of the active org may invite.
  if (!orgId || ws?.activeRole !== "ADMIN") {
    redirect(`/${locale}/account?error=forbidden#team`);
  }

  const email = String(formData.get("email") || "").toLowerCase().trim();
  const role = String(formData.get("role") || "MEMBER") as MembershipRole;
  const canCommit = formData.get("canCommit") === "on";
  const delegationRaw = String(formData.get("delegationExpiresAt") || "").trim();
  const delegationExpiresAt = delegationRaw ? new Date(delegationRaw) : null;

  if (!email || !email.includes("@")) {
    redirect(`/${locale}/account?error=email#team`);
  }
  // Guard against a bad role string from a tampered form.
  if (!["ADMIN", "MEMBER", "RESTRICTED"].includes(role)) {
    redirect(`/${locale}/account?error=role#team`);
  }
  // Guard against an invalid/past delegation date.
  if (delegationExpiresAt && isNaN(delegationExpiresAt.getTime())) {
    redirect(`/${locale}/account?error=delegation#team`);
  }
  if (!validateDelegationDate(delegationExpiresAt, new Date())) {
    redirect(`/${locale}/account?error=delegation_past#team`);
  }

  // Reject inviting someone who is already an active member.
  const existing = await prisma.membership.findMany({
    where: { organizationId: orgId, user: { email } },
    select: { userId: true, organizationId: true, role: true, canCommit: true, expiresAt: true, status: true },
  });
  if (resolveOrgMembership(existing, orgId, new Date())) {
    redirect(`/${locale}/account?error=already_member#team`);
  }

  const token = newInviteToken();
  // Replace any unclaimed pending invite for the same email+org (don't stack).
  await prisma.$transaction([
    prisma.orgInvite.deleteMany({ where: { organizationId: orgId, email, claimedAt: null } }),
    prisma.orgInvite.create({
      data: {
        organizationId: orgId,
        email,
        role,
        canCommit,
        delegationExpiresAt,
        token,
        expiresAt: expiryFromNow(),
        createdById: session.user.id,
      },
    }),
  ]);

  const [org, inviter] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true, email: true } }),
  ]);
  const inviterName =
    inviter?.name?.trim() ||
    inviter?.email?.split("@")[0] ||
    "An admin";
  const built = buildOrgInviteEmail({
    locale,
    orgName: org?.name ?? "your organization",
    inviterName,
    link: orgInviteLink(locale, token),
    role,
    delegationExpiresAt,
  });
  try {
    await emailAdapter({ to: email, subject: built.subject, text: built.text });
  } catch (err) {
    console.error("org_invite.email_failed", { orgId, email, err });
  }

  await recordAudit(session.user.id, "org.invite_sent", `Organization:${orgId}`, {
    email, role, canCommit, delegationExpiresAt,
  });
  redirect(`/${locale}/account?ok=invited#team`);
}

// ─── Admin gate + shared helpers ─────────────────────────────────────────────

async function requireActiveAdmin(locale: Locale) {
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);
  const scope = await loadScope();
  const ws = scope.workspace;
  if (!ws?.activeOrgId || ws.activeRole !== "ADMIN") {
    redirect(`/${locale}/account?error=forbidden#team`);
  }
  return { session, orgId: ws.activeOrgId };
}

async function loadOrgMembershipsForGuard(orgId: string) {
  return prisma.membership.findMany({
    where: { organizationId: orgId },
    select: {
      userId: true,
      organizationId: true,
      role: true,
      canCommit: true,
      expiresAt: true,
      status: true,
    },
  });
}

// ─── New management actions ───────────────────────────────────────────────────

export async function revokeMembership(formData: FormData) {
  const locale = asLocale(String(formData.get("locale") || "en"));
  const { session, orgId } = await requireActiveAdmin(locale);
  const targetUserId = String(formData.get("userId") || "");
  if (!targetUserId) redirect(`/${locale}/account?error=1#team`);

  const rows = await loadOrgMembershipsForGuard(orgId);
  if (wouldRemoveLastAdmin(rows, targetUserId, new Date())) {
    redirect(`/${locale}/account?error=last_admin#team`);
  }
  await prisma.membership.updateMany({
    where: { organizationId: orgId, userId: targetUserId },
    data: { status: "REVOKED" },
  });
  await recordAudit(session.user!.id, "org.membership_revoked", `Organization:${orgId}`, {
    targetUserId,
  });
  redirect(`/${locale}/account?ok=revoked#team`);
}

export async function updateMembership(formData: FormData) {
  const locale = asLocale(String(formData.get("locale") || "en"));
  const { session, orgId } = await requireActiveAdmin(locale);
  const targetUserId = String(formData.get("userId") || "");
  const role = String(formData.get("role") || "MEMBER") as MembershipRole;
  const canCommit = formData.get("canCommit") === "on";
  if (!targetUserId) redirect(`/${locale}/account?error=1#team`);
  if (!["ADMIN", "MEMBER", "RESTRICTED"].includes(role)) {
    redirect(`/${locale}/account?error=role#team`);
  }

  // Demoting the last admin away from ADMIN is forbidden.
  if (role !== "ADMIN") {
    const rows = await loadOrgMembershipsForGuard(orgId);
    if (wouldRemoveLastAdmin(rows, targetUserId, new Date())) {
      redirect(`/${locale}/account?error=last_admin#team`);
    }
  }
  await prisma.membership.updateMany({
    where: { organizationId: orgId, userId: targetUserId },
    data: { role, canCommit },
  });
  await recordAudit(session.user!.id, "org.membership_updated", `Organization:${orgId}`, {
    targetUserId,
    role,
    canCommit,
  });
  redirect(`/${locale}/account?ok=updated#team`);
}

export async function revokeInvite(formData: FormData) {
  const locale = asLocale(String(formData.get("locale") || "en"));
  const { session, orgId } = await requireActiveAdmin(locale);
  const inviteId = String(formData.get("inviteId") || "");
  if (!inviteId) redirect(`/${locale}/account?error=1#team`);
  await prisma.orgInvite.deleteMany({
    where: { id: inviteId, organizationId: orgId, claimedAt: null },
  });
  await recordAudit(session.user!.id, "org.invite_revoked", `Organization:${orgId}`, {
    inviteId,
  });
  redirect(`/${locale}/account?ok=invite_revoked#team`);
}

// ─────────────────────────────────────────────────────────────────────────────

export async function claimOrgInvite(formData: FormData) {
  const locale = asLocale(String(formData.get("locale") || "en"));
  const token = String(formData.get("token") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const password = String(formData.get("password") || "");
  const session = await auth();
  const authedEmail = session?.user?.email?.toLowerCase() ?? null;

  if (!token) redirect(`/${locale}/invite/${token}?error=1`);

  // Rate-limit: same guard as claimPublisherInvite — creates accounts + signs in.
  const ip = await clientKey();
  if (!(await authLimiter.check(`invite:ip:${ip}`)).ok) {
    redirect(`/${locale}/invite/${token}?error=rate`);
  }

  const invite = await prisma.orgInvite.findUnique({
    where: { token },
    select: {
      id: true,
      organizationId: true,
      email: true,
      role: true,
      canCommit: true,
      delegationExpiresAt: true,
      expiresAt: true,
      claimedAt: true,
      createdById: true,
    },
  });

  // Determine whether the logged-in user is already a member of this org.
  let isAlreadyMember = false;
  if (session?.user?.id && invite) {
    const m = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: session.user.id,
          organizationId: invite.organizationId,
        },
      },
      select: { id: true },
    });
    isAlreadyMember = !!m;
  }

  const verdict = validateOrgClaim(
    invite
      ? { email: invite.email, expiresAt: invite.expiresAt, claimedAt: invite.claimedAt }
      : null,
    { authedEmail, isAlreadyMember },
    new Date(),
  );
  if (!verdict.ok) {
    redirect(`/${locale}/invite/${token}?error=${verdict.reason}`);
  }
  const inv = invite!;

  if (verdict.mode === "existing") {
    await prisma.$transaction(async (tx) => {
      await tx.membership.create({
        data: {
          userId: session!.user!.id,
          organizationId: inv.organizationId,
          role: inv.role,
          canCommit: inv.canCommit,
          expiresAt: inv.delegationExpiresAt,
          invitedById: inv.createdById ?? null,
        },
      });
      await tx.orgInvite.update({
        where: { id: inv.id },
        data: { claimedAt: new Date(), claimedByUserId: session!.user!.id },
      });
    });
    await recordAudit(
      session!.user!.id,
      "org.invite_claimed",
      `Organization:${inv.organizationId}`,
      { inviteId: inv.id, mode: "existing" },
    );
    redirect(`/${locale}/account?ok=joined#team`);
  }

  // mode === "new": create account, membership, mark claimed, sign in.
  if (name.length < 1 || password.length < 8) {
    redirect(`/${locale}/invite/${token}?error=form`);
  }
  const passwordHash = await bcrypt.hash(password, 10);

  let createdUserId: string | null = null;
  try {
    createdUserId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: inv.email,
          name: name || null,
          role: "BUYER",
          passwordHash,
          organizationId: inv.organizationId,
          // Invite link was clicked from the invited mailbox — proof of
          // ownership, so the account starts verified.
          emailVerifiedAt: new Date(),
        },
      });
      await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: inv.organizationId,
          role: inv.role,
          canCommit: inv.canCommit,
          expiresAt: inv.delegationExpiresAt,
          invitedById: inv.createdById ?? null,
        },
      });
      await tx.orgInvite.update({
        where: { id: inv.id },
        data: { claimedAt: new Date(), claimedByUserId: user.id },
      });
      return user.id;
    });
  } catch {
    // Unique-email violation: the address already has an account.
    // Send them to sign-in — their existing session pairs them to the org.
    redirect(`/${locale}/signin`);
  }

  if (!createdUserId) redirect(`/${locale}/invite/${token}?error=1`);
  await recordAudit(
    createdUserId,
    "org.invite_claimed",
    `Organization:${inv.organizationId}`,
    { inviteId: inv.id, mode: "new" },
  );

  try {
    await signIn("credentials", { email: inv.email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/${locale}/signin`);
    }
    throw error;
  }
  redirect(`/${locale}/account?ok=joined#team`);
}
