"use server";
import { inviteTokenCandidates, storedInviteToken } from "@/lib/tokens";
import { hashPassword } from "@/lib/password";
import { log } from "@/lib/log";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { auth } from "@/auth";
import { recordAudit } from "@/lib/audit";
import { emailAdapter } from "@/lib/notify";
import { loadScope } from "@/lib/scope";
import { authLimiter } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { resolveOrgMembership, commitGrantFor, type MembershipRole } from "@/lib/membership";
import {
  newInviteToken,
  expiryFromNow,
  validateDelegationDate,
  isDelegatedAdminForbidden,
  buildOrgInviteEmail,
  orgInviteLink,
  validateOrgClaim,
  validateClaimForm,
} from "@/lib/org-invite";
import { passwordlessSignIn } from "@/lib/passwordless-signin";
import { changeSeat, createAccountFromInvite, grantSeatFromInvite, hasActiveSeat, revokeSeat } from "@/lib/org-seats";
import { switchActiveOrg } from "@/lib/active-org";
import { inviteLandingPath } from "@/lib/invite-landing";

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
  const canCommit = commitGrantFor(role, formData.get("canCommit") === "on");
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
  if (isDelegatedAdminForbidden(role, delegationExpiresAt)) {
    redirect(`/${locale}/account?error=admin_delegation#team`);
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
        // Only the hash is stored; the raw token goes out in the email.
        token: storedInviteToken(token),
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
  let emailed = true;
  try {
    await emailAdapter({ to: email, subject: built.subject, text: built.text });
  } catch (err) {
    emailed = false;
    log.error("org_invite.email_failed", { orgId, err });
  }

  await recordAudit(session.user.id, "org.invite_sent", `Organization:${orgId}`, {
    email, role, canCommit, delegationExpiresAt, emailed,
  });
  if (!emailed) redirect(`/${locale}/account?error=invite_email_failed#team`);
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

// ─── New management actions ───────────────────────────────────────────────────

export async function revokeMembership(formData: FormData) {
  const locale = asLocale(String(formData.get("locale") || "en"));
  const { session, orgId } = await requireActiveAdmin(locale);
  const targetUserId = String(formData.get("userId") || "");
  if (!targetUserId) redirect(`/${locale}/account?error=1#team`);

  const result = await revokeSeat(orgId, targetUserId);
  if (!result.ok) redirect(`/${locale}/account?error=${result.reason}#team`);
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
  const canCommit = commitGrantFor(role, formData.get("canCommit") === "on");
  if (!targetUserId) redirect(`/${locale}/account?error=1#team`);
  if (!["ADMIN", "MEMBER", "RESTRICTED"].includes(role)) {
    redirect(`/${locale}/account?error=role#team`);
  }

  // Demoting the last admin away from ADMIN is forbidden — checked and
  // written in one locked transaction (see changeSeat).
  const changed = await changeSeat(orgId, targetUserId, role, canCommit);
  if (!changed.ok) redirect(`/${locale}/account?error=last_admin#team`);
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

// After a claim, make the joined org the active one — an existing user who
// already belongs to another org would otherwise keep seeing that org — and
// land them on the new team's plans (lib/invite-landing.ts).
async function landInJoinedOrg(locale: string, organizationId: string): Promise<never> {
  await switchActiveOrg(organizationId);
  const planCount = await prisma.savedList.count({ where: { organizationId, archivedAt: null } });
  redirect(inviteLandingPath(locale, planCount));
}

export async function claimOrgInvite(formData: FormData) {
  const locale = asLocale(String(formData.get("locale") || "en"));
  const token = String(formData.get("token") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const password = String(formData.get("password") || "");
  const session = await auth();
  const authedEmail = session?.user?.email?.toLowerCase() ?? null;

  if (!token) redirect(`/${locale}/invite/${token}?error=1`);

  // Rate-limit: same guard as claimPublisherInvite — creates accounts + signs in.
  const ip = await clientIp();
  if (!(await authLimiter.check(`invite:ip:${ip}`)).ok) {
    redirect(`/${locale}/invite/${token}?error=rate`);
  }

  const invite = await prisma.orgInvite.findFirst({
    where: { token: { in: inviteTokenCandidates(token) } },
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

  // Only a CURRENT seat makes the invite redundant. A removed (REVOKED) or
  // lapsed (EXPIRED) row is exactly what a re-invite exists to bring back.
  const isAlreadyMember =
    !!session?.user?.id && !!invite && (await hasActiveSeat(session.user.id, invite.organizationId));

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
    await prisma.$transaction((tx) => grantSeatFromInvite(tx, inv, session!.user!.id));
    await recordAudit(
      session!.user!.id,
      "org.invite_claimed",
      `Organization:${inv.organizationId}`,
      { inviteId: inv.id, mode: "existing" },
    );
    await landInJoinedOrg(locale, inv.organizationId);
  }

  // mode === "new": create account, membership, mark claimed, sign in.
  // Password is optional — an empty one creates a passwordless account and
  // signs in through the magic-link consume route instead of credentials.
  const form = validateClaimForm(name, password);
  if (!form.ok) {
    redirect(`/${locale}/invite/${token}?error=form`);
  }
  const passwordHash = form.passwordless ? null : await hashPassword(password);

  let createdUserId: string | null = null;
  try {
    createdUserId = await createAccountFromInvite(inv, { name: name || null, passwordHash, locale });
  } catch (err) {
    // Unique-email violation: the address already has an account.
    // Send them to sign-in — their existing session pairs them to the org.
    // Anything else (database down, transaction timeout) is a real failure
    // and must not be disguised as "you already have an account".
    if (!isUniqueViolation(err)) {
      log.error("org_invite.claim_failed", { inviteId: inv.id, err });
      throw err;
    }
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
    if (form.passwordless) {
      await passwordlessSignIn(createdUserId, ip);
    } else {
      await signIn("credentials", { email: inv.email, password, redirect: false });
    }
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/${locale}/signin`);
    }
    throw error;
  }
  await landInJoinedOrg(locale, inv.organizationId);
}
