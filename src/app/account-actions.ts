"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { MarketCode } from "@prisma/client";
import { AuthError } from "next-auth";
import { auth, signIn, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { wouldRemoveLastAdmin, type MembershipRow } from "@/lib/membership";
import { canDeactivateSelf } from "@/lib/user-admin";
import { companySeat, getWorkspace } from "@/lib/workspace";
import { normaliseEmail } from "@/lib/email-change";
import { SUPPORTED_MARKETS } from "@/lib/markets";

const MARKET_CODES: readonly string[] = SUPPORTED_MARKETS;

// Same lenient phone validator as onboarding — keep both in sync.
function normalisePhone(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}
function isValidPhone(raw: string): boolean {
  if (raw.length === 0) return true; // clearing phone is allowed
  const digits = raw.match(/\d/g)?.length ?? 0;
  return raw.length <= 32 && digits >= 6;
}

export async function updateProfile(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const name = String(formData.get("name") || "").trim();
  const phoneRaw = String(formData.get("phone") || "");
  const phone = normalisePhone(phoneRaw);

  if (!isValidPhone(phone)) {
    redirect(`/${locale}/account?error=phone#profile`);
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      name: name || null,
      phone: phone || null,
    },
  });
  await recordAudit(session.user.id, "user.profile_updated", `User:${session.user.id}`, {
    fields: ["name", "phone"],
  });
  redirect(`/${locale}/account?ok=profile#profile`);
}

export async function updateCompany(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const orgName = String(formData.get("orgName") || "").trim();
  const market = String(formData.get("market") || "").trim();

  if (!orgName || !MARKET_CODES.includes(market)) {
    redirect(`/${locale}/account?error=company#company`);
  }

  // The company is the org the user is working in (lib/workspace companySeat)
  // — the same one /account shows — and only an ADMIN seat in it may edit.
  // Resolving it from the workspace rather than User.organizationId matters
  // twice over: a member of several orgs edits the org they switched to, and
  // a removed member (no workspace) edits nothing.
  const ws = await getWorkspace(session.user.id);
  const seat = ws ? companySeat(ws) : null;
  if (!seat?.orgId) {
    redirect(`/${locale}/account?error=no_org#company`);
  }
  if (!seat.isAdmin) {
    redirect(`/${locale}/account?error=forbidden#company`);
  }
  await prisma.organization.update({
    where: { id: seat.orgId },
    data: {
      name: orgName,
      marketCode: market as MarketCode,
    },
  });
  await recordAudit(session.user.id, "organization.updated", `Organization:${seat.orgId}`, {
    name: orgName,
    market,
  });
  redirect(`/${locale}/account?ok=company#company`);
}

// Set or change the user's password. If the user signed up via magic-
// link and has no password yet, currentPassword is not required. If a
// password already exists, we verify the current one before accepting
// the new one — same UX as resetPassword but in the signed-in flow.
export async function setPassword(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const current = String(formData.get("currentPassword") || "");
  const next = String(formData.get("newPassword") || "");
  if (next.length < 8) {
    redirect(`/${locale}/account?error=password_length#password`);
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, passwordHash: true, email: true },
  });
  if (!user) redirect(`/${locale}/signin`);

  if (user.passwordHash) {
    // Existing-password users must prove they know it.
    const ok = await bcrypt.compare(current, user.passwordHash);
    if (!ok) {
      redirect(`/${locale}/account?error=current_password#password`);
    }
  }

  // Bumping the session version ends every other session on the account —
  // including a stolen one, which is usually why people change a password.
  // It ends this browser's session too, so re-mint it straight away with the
  // password the user just chose (see @/lib/session-version).
  const hash = await bcrypt.hash(next, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hash, sessionVersion: { increment: 1 } },
  });
  await recordAudit(user.id, "user.password_set", `User:${user.id}`, {
    hadPasswordBefore: !!user.passwordHash,
  });
  try {
    await signIn("credentials", { email: user.email, password: next, redirect: false });
  } catch (error) {
    // The change itself is saved; only the re-mint failed (e.g. the sign-in
    // limiter). Signing in again with the new password is the honest way on.
    if (error instanceof AuthError) redirect(`/${locale}/signin`);
    throw error;
  }
  redirect(`/${locale}/account?ok=password#password`);
}

// Self-service off-boarding. Deactivation, not deletion: orders, quotes and
// invoices this user signed are financial records the platform has to keep,
// and an anonymised-user cascade through those tables is a different (and
// much larger) piece of work than "let me out". What the user gets is the
// thing they actually asked for — the account stops working immediately, on
// every sign-in route — and it is reversible by a super-admin if they come
// back, which a delete would not be.
//
// Two guards stand between the button and the stamp, both of which exist to
// stop a single click stranding other people:
//   - the last active super-admin can't walk out (nobody left to let anyone
//     back in, including them)
//   - the last admin of an org can't either, or that org's team, billing and
//     seats become unmanageable for everyone in it
export async function deactivateOwnAccount(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);
  const userId = session.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, deactivatedAt: true },
  });
  if (!user) redirect(`/${locale}/signin`);
  if (user.deactivatedAt) {
    // Already off-boarded in another tab: nothing to do but end the session.
    await signOut({ redirectTo: `/${locale}` });
    return;
  }

  // Typed confirmation. The one destructive control on this page that isn't
  // undoable by the user themselves, so it asks for the address rather than
  // trusting a single click — the pattern the desk's order-cancel form uses
  // for the same reason.
  const typed = normaliseEmail(String(formData.get("confirmEmail") || ""));
  if (typed !== normaliseEmail(user.email)) {
    redirect(`/${locale}/account?error=confirm#danger`);
  }

  const allUsers = await prisma.user.findMany({
    where: { role: "SUPERADMIN" },
    select: { id: true, role: true, deactivatedAt: true },
  });
  if (!canDeactivateSelf(user, allUsers).ok) {
    redirect(`/${locale}/account?error=last_superadmin#danger`);
  }

  // Org side: check every org where this user holds an active ADMIN seat.
  const myMemberships = await prisma.membership.findMany({
    where: { userId },
    select: {
      userId: true,
      organizationId: true,
      role: true,
      canCommit: true,
      expiresAt: true,
      status: true,
    },
  });
  const now = new Date();
  const adminOrgIds = myMemberships
    .filter((m) => m.role === "ADMIN")
    .map((m) => m.organizationId);
  if (adminOrgIds.length > 0) {
    const peers = (await prisma.membership.findMany({
      where: { organizationId: { in: adminOrgIds } },
      select: {
        userId: true,
        organizationId: true,
        role: true,
        canCommit: true,
        expiresAt: true,
        status: true,
      },
    })) as MembershipRow[];
    for (const orgId of adminOrgIds) {
      const rows = peers.filter((m) => m.organizationId === orgId);
      if (wouldRemoveLastAdmin(rows, userId, now)) {
        redirect(`/${locale}/account?error=last_admin#danger`);
      }
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { deactivatedAt: now },
  });
  await recordAudit(userId, "user.deactivated_self", `User:${userId}`, {
    email: user.email,
  });

  await signOut({ redirectTo: `/${locale}` });
}
