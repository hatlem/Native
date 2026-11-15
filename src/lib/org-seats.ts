import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { asNoticeLocale } from "@/lib/notices/messages";
import {
  commitGrantFor,
  resolveOrgMembership,
  wouldRemoveLastAdmin,
  type MembershipRole,
  type MembershipRow,
} from "@/lib/membership";

// Seat writes for org invites and team management. The server actions in
// app/org-invite-actions.ts are thin auth + redirect shells around these, so
// the rules that decide who can reach an org's data are exercised against the
// real database in org-seats.it.test.ts rather than only through a browser.

export type ClaimableInvite = {
  id: string;
  organizationId: string;
  email: string;
  role: MembershipRole;
  canCommit: boolean;
  delegationExpiresAt: Date | null;
  createdById: string | null;
};

const SEAT_SELECT = {
  userId: true,
  organizationId: true,
  role: true,
  canCommit: true,
  expiresAt: true,
  status: true,
} as const;

/** Does `userId` hold an active seat in `organizationId` right now? */
export async function hasActiveSeat(
  userId: string,
  organizationId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const rows = (await prisma.membership.findMany({
    where: { userId, organizationId },
    select: SEAT_SELECT,
  })) as MembershipRow[];
  return resolveOrgMembership(rows, organizationId, now) !== null;
}

// Give `userId` the seat an invite describes and burn the invite, in one
// transaction. Upsert, not create: a member who was removed (REVOKED) or
// whose delegation ran out (EXPIRED) still has their old row — the
// [userId, organizationId] pair is unique — and re-inviting them has to bring
// that row back to life with the NEW invite's terms rather than fail on the
// unique index. Everything about the seat comes from the invite; nothing
// from the dead row survives except its id and createdAt.
export async function grantSeatFromInvite(
  tx: Prisma.TransactionClient,
  invite: ClaimableInvite,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const seat = {
    role: invite.role,
    canCommit: commitGrantFor(invite.role, invite.canCommit),
    expiresAt: invite.delegationExpiresAt,
    status: "ACTIVE" as const,
    invitedById: invite.createdById ?? null,
  };
  await tx.membership.upsert({
    where: { userId_organizationId: { userId, organizationId: invite.organizationId } },
    create: { userId, organizationId: invite.organizationId, ...seat },
    update: seat,
  });
  await tx.orgInvite.update({
    where: { id: invite.id },
    data: { claimedAt: now, claimedByUserId: userId },
  });
}

// Brand-new account from an invite. The account's home org points at the
// inviting org — that's the team its favorites are shared with and the
// default org it opens in — but the pointer grants nothing on its own
// (lib/workspace resolveWorkspace): the seat created alongside it is what
// gives access, and revoking that seat is what takes it away.
// Throws on a unique-email violation; the caller treats that as "this address
// already has an account".
export async function createAccountFromInvite(
  invite: ClaimableInvite,
  // locale: the language the invite was opened in (User.locale).
  account: { name: string | null; passwordHash: string | null; locale?: string | null },
  now: Date = new Date(),
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: invite.email,
        name: account.name,
        role: "BUYER",
        passwordHash: account.passwordHash,
        organizationId: invite.organizationId,
        locale: asNoticeLocale(account.locale),
        // The invite link was opened from the invited mailbox — proof of
        // ownership, so the account starts verified.
        emailVerifiedAt: now,
      },
    });
    await grantSeatFromInvite(tx, invite, user.id, now);
    return user.id;
  });
}

export type RevokeResult = { ok: true } | { ok: false; reason: "last_admin" };

// Remove a member's seat. Access ends on their next request: the workspace
// only ever grants orgs with an active seat. The row is kept (REVOKED) for
// the audit trail and so the Team list can show who was removed.
export async function revokeSeat(
  organizationId: string,
  targetUserId: string,
  now: Date = new Date(),
): Promise<RevokeResult> {
  return prisma.$transaction(async (tx) => {
    await lockOrgSeats(tx, [organizationId]);
    if (wouldRemoveLastAdmin(await orgSeatsIn(tx, organizationId), targetUserId, now)) {
      return { ok: false, reason: "last_admin" } as const;
    }
    await tx.membership.updateMany({
      where: { organizationId, userId: targetUserId },
      data: { status: "REVOKED" },
    });
    return { ok: true } as const;
  });
}

export type SeatChangeResult = { ok: true } | { ok: false; reason: "last_admin" };

// Change a member's role / commit right. Same lock + re-check as revokeSeat:
// two admins demoting each other at the same moment must not both pass the
// "is another admin left?" check and leave the org with none.
export async function changeSeat(
  organizationId: string,
  targetUserId: string,
  role: MembershipRole,
  canCommit: boolean,
  now: Date = new Date(),
): Promise<SeatChangeResult> {
  return prisma.$transaction(async (tx) => {
    await lockOrgSeats(tx, [organizationId]);
    if (
      role !== "ADMIN" &&
      wouldRemoveLastAdmin(await orgSeatsIn(tx, organizationId), targetUserId, now)
    ) {
      return { ok: false, reason: "last_admin" } as const;
    }
    // Admins are always permanent: clear any expiry when promoting to ADMIN
    // so the membership can never silently expire and leave the org with
    // zero active admins.
    await tx.membership.updateMany({
      where: { organizationId, userId: targetUserId },
      data: role === "ADMIN" ? { role, canCommit, expiresAt: null } : { role, canCommit },
    });
    return { ok: true } as const;
  });
}

export type DeactivateResult = { ok: true } | { ok: false; reason: "last_admin" };

// Self-service deactivation. Refused while the user is the last active admin
// of any org — checked and written under the same per-org locks as the seat
// changes above, so it cannot race a concurrent demotion of the other admin.
export async function deactivateUserUnlessLastAdmin(
  userId: string,
  now: Date = new Date(),
): Promise<DeactivateResult> {
  return prisma.$transaction(async (tx) => {
    const mine = await tx.membership.findMany({
      where: { userId, role: "ADMIN" },
      select: { organizationId: true },
    });
    const orgIds = [...new Set(mine.map((m) => m.organizationId))];
    await lockOrgSeats(tx, orgIds);
    for (const orgId of orgIds) {
      if (wouldRemoveLastAdmin(await orgSeatsIn(tx, orgId), userId, now)) {
        return { ok: false, reason: "last_admin" } as const;
      }
    }
    await tx.user.update({ where: { id: userId }, data: { deactivatedAt: now } });
    return { ok: true } as const;
  });
}

// Serialize seat changes per organization for the rest of the transaction.
// Sorted so two transactions locking several orgs can't deadlock.
async function lockOrgSeats(tx: Prisma.TransactionClient, organizationIds: string[]) {
  for (const id of [...organizationIds].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"org-seats:" + id}))`;
  }
}

async function orgSeatsIn(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<MembershipRow[]> {
  return (await tx.membership.findMany({
    where: { organizationId },
    select: SEAT_SELECT,
  })) as MembershipRow[];
}
