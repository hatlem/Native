"use server";

import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { generateToken, hashToken, tokenExpiry } from "@/lib/tokens";
import { emailAdapter } from "@/lib/notify";
import { magicLinkEmail } from "@/lib/mail/templates/magic-link";
import { passwordResetEmail } from "@/lib/mail/templates/password-reset";
import { appUrl, appName } from "@/lib/url";
import { clientIp } from "@/lib/client-ip";
import {
  canChangeRole,
  canRebind,
  canSetDeactivated,
  type AdminDenyReason,
  type AdminUserRow,
} from "@/lib/user-admin";

// Super-admin user console (/desk/users). Everything a support case needs that
// previously meant `pnpm tsx scripts/promote-to-desk.ts` against the production
// DATABASE_URL: platform role, org / publisher binding, off-boarding, and the
// two "help me get back in" emails.
//
// SUPERADMIN-only, not DESK: these actions grant access rather than move
// commerce along, so they sit with API-key issuance rather than with the
// order desk. Every one of them is audited with the acting user.

const VALID_ROLES = Object.values(UserRole) as string[];
const ORG_ROLES = ["ADMIN", "MEMBER", "RESTRICTED"] as const;
type OrgRole = (typeof ORG_ROLES)[number];

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function requireSuperadmin(locale: string): Promise<string> {
  const session = await auth();
  if (session?.user?.role !== "SUPERADMIN") {
    redirect(`/${locale}/signin`);
  }
  return session.user.id;
}

// Every redirect keeps the list's search + page so an admin working through a
// filtered list isn't thrown back to page 1 of everything after each save.
function back(
  locale: string,
  formData: FormData,
  outcome: { ok: string } | { error: string },
): never {
  const params = new URLSearchParams();
  const q = field(formData, "q");
  const page = field(formData, "page");
  if (q) params.set("q", q);
  if (page && page !== "1") params.set("page", page);
  if ("ok" in outcome) params.set("ok", outcome.ok);
  else params.set("error", outcome.error);
  redirect(`/${locale}/desk/users?${params.toString()}`);
}

// The guards take every SUPERADMIN row so "would this leave the platform with
// no way back in?" is answerable. Deactivated super-admins are loaded too —
// isActiveSuperadmin filters them out, because an account that can't sign in
// is not a way back in.
async function loadGuardRows(): Promise<AdminUserRow[]> {
  return (await prisma.user.findMany({
    where: { role: "SUPERADMIN" },
    select: { id: true, role: true, deactivatedAt: true },
  })) as AdminUserRow[];
}

async function loadTarget(userId: string): Promise<AdminUserRow | null> {
  if (!userId) return null;
  return (await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, deactivatedAt: true },
  })) as AdminUserRow | null;
}

function denyCode(reason: AdminDenyReason): string {
  return reason;
}

export async function updateUserRole(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const actorId = await requireSuperadmin(locale);
  const targetId = field(formData, "userId");
  const role = field(formData, "role");

  if (!VALID_ROLES.includes(role)) back(locale, formData, { error: "role" });

  const [target, guardRows] = await Promise.all([
    loadTarget(targetId),
    loadGuardRows(),
  ]);
  const verdict = canChangeRole(actorId, target, role as UserRole, guardRows);
  if (!verdict.ok) back(locale, formData, { error: denyCode(verdict.reason) });

  await prisma.user.update({
    where: { id: targetId },
    data: { role: role as UserRole },
  });
  await recordAudit(actorId, "user.role_changed", `User:${targetId}`, {
    from: target!.role,
    to: role,
  });
  back(locale, formData, { ok: "role" });
}

// Home organisation + (optionally) the org-level seat. Binding without a
// membership gives read scope but no authority, which is exactly the state
// that leaves a customer org unmanageable when its last admin walks out —
// so the seat is set in the same action rather than in a second screen.
export async function updateUserOrg(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const actorId = await requireSuperadmin(locale);
  const targetId = field(formData, "userId");
  const organizationId = field(formData, "organizationId");
  const orgRoleRaw = field(formData, "orgRole");

  const target = await loadTarget(targetId);
  const verdict = canRebind(actorId, target);
  if (!verdict.ok) back(locale, formData, { error: denyCode(verdict.reason) });

  if (!organizationId) {
    await prisma.user.update({
      where: { id: targetId },
      data: { organizationId: null },
    });
    await recordAudit(actorId, "user.org_cleared", `User:${targetId}`, {});
    back(locale, formData, { ok: "org" });
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!org) back(locale, formData, { error: "not_found" });

  const orgRole = (ORG_ROLES as readonly string[]).includes(orgRoleRaw)
    ? (orgRoleRaw as OrgRole)
    : null;

  await prisma.user.update({
    where: { id: targetId },
    data: { organizationId },
  });

  if (orgRole) {
    // Upsert rather than create: re-running the same fix (a support case that
    // bounces) must not blow up on the [userId, organizationId] unique index.
    // canCommit is only set when the row is created — an existing seat's
    // commit grant is the org admin's call, not ours to silently reset.
    await prisma.membership.upsert({
      where: {
        userId_organizationId: { userId: targetId, organizationId },
      },
      create: {
        userId: targetId,
        organizationId,
        role: orgRole,
        canCommit: orgRole === "ADMIN",
        status: "ACTIVE",
        invitedById: actorId,
      },
      update: {
        role: orgRole,
        status: "ACTIVE",
        // An ADMIN seat is permanent by construction (same rule as
        // updateMembership in org-invite-actions) — otherwise an org can end
        // up with zero active admins the moment a delegation lapses.
        ...(orgRole === "ADMIN" ? { expiresAt: null } : {}),
      },
    });
  }

  await recordAudit(actorId, "user.org_set", `User:${targetId}`, {
    organizationId,
    orgRole,
  });
  back(locale, formData, { ok: "org" });
}

export async function updateUserPublisher(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const actorId = await requireSuperadmin(locale);
  const targetId = field(formData, "userId");
  const publisherId = field(formData, "publisherId");

  const target = await loadTarget(targetId);
  const verdict = canRebind(actorId, target);
  if (!verdict.ok) back(locale, formData, { error: denyCode(verdict.reason) });

  if (publisherId) {
    const publisher = await prisma.publisher.findUnique({
      where: { id: publisherId },
      select: { id: true },
    });
    if (!publisher) back(locale, formData, { error: "not_found" });
  }

  await prisma.user.update({
    where: { id: targetId },
    data: { publisherId: publisherId || null },
  });
  await recordAudit(actorId, "user.publisher_set", `User:${targetId}`, {
    publisherId: publisherId || null,
  });
  back(locale, formData, { ok: "publisher" });
}

// Off-boarding, and the way back from it. Deactivation is a stamp, not a
// delete: the user's orders, quotes and audit trail stay attached to a real
// row, and a returning employee is one click from working again.
export async function setUserDeactivated(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const actorId = await requireSuperadmin(locale);
  const targetId = field(formData, "userId");
  const deactivate = field(formData, "deactivate") === "1";

  const [target, guardRows] = await Promise.all([
    loadTarget(targetId),
    loadGuardRows(),
  ]);
  const verdict = canSetDeactivated(actorId, target, deactivate, guardRows);
  if (!verdict.ok) back(locale, formData, { error: denyCode(verdict.reason) });

  await prisma.user.update({
    where: { id: targetId },
    data: { deactivatedAt: deactivate ? new Date() : null },
  });
  await recordAudit(
    actorId,
    deactivate ? "user.deactivated" : "user.reactivated",
    `User:${targetId}`,
    {},
  );
  back(locale, formData, { ok: deactivate ? "deactivated" : "reactivated" });
}

// "They can't get in" — the two mails support actually needs to send. Both go
// to the address on file and neither reveals anything to the admin, so a
// compromised console can't be used to read someone's mailbox.
export async function sendUserPasswordReset(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const actorId = await requireSuperadmin(locale);
  const targetId = field(formData, "userId");
  const ip = await clientIp();

  const user = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, email: true, passwordHash: true, deactivatedAt: true },
  });
  if (!user) back(locale, formData, { error: "not_found" });
  // A reset link for an account that can't sign in is a dead end — and worse,
  // it reads to the recipient as "you're back", which they aren't.
  if (user.deactivatedAt) back(locale, formData, { error: "deactivated_target" });

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
    await emailAdapter({
      to: user.email,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  } catch (err) {
    console.error("admin.password_reset_email_failed", { targetId, err });
    back(locale, formData, { error: "email_failed" });
  }
  await recordAudit(actorId, "user.password_reset_sent", `User:${targetId}`, {
    ip,
  });
  back(locale, formData, { ok: "reset_sent" });
}

// Doubles as "resend the verification email": consuming a magic link stamps
// emailVerifiedAt (see consumeMagicLinkToken), which is exactly what an
// account stuck behind the verification gate needs.
export async function sendUserSignInLink(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const actorId = await requireSuperadmin(locale);
  const targetId = field(formData, "userId");
  const ip = await clientIp();

  const user = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, email: true, deactivatedAt: true },
  });
  if (!user) back(locale, formData, { error: "not_found" });
  if (user.deactivatedAt) back(locale, formData, { error: "deactivated_target" });

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
    await emailAdapter({
      to: user.email,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  } catch (err) {
    console.error("admin.magic_link_email_failed", { targetId, err });
    back(locale, formData, { error: "email_failed" });
  }
  await recordAudit(actorId, "user.signin_link_sent", `User:${targetId}`, { ip });
  back(locale, formData, { ok: "link_sent" });
}
