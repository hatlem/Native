"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { recordAudit } from "@/lib/audit";
import { emailAdapter } from "@/lib/notify";
import { loadScope } from "@/lib/scope";
import { resolveOrgMembership, type MembershipRole } from "@/lib/membership";
import {
  newInviteToken,
  expiryFromNow,
  validateDelegationDate,
  buildOrgInviteEmail,
  orgInviteLink,
} from "@/lib/org-invite";

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

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });
  const built = buildOrgInviteEmail({
    locale,
    orgName: org?.name ?? "your organization",
    inviterName: session.user.name ?? "An admin",
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
