import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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

async function orgSeats(organizationId: string): Promise<MembershipRow[]> {
  return (await prisma.membership.findMany({
    where: { organizationId },
    select: SEAT_SELECT,
  })) as MembershipRow[];
}

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
  account: { name: string | null; passwordHash: string | null },
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
  if (wouldRemoveLastAdmin(await orgSeats(organizationId), targetUserId, now)) {
    return { ok: false, reason: "last_admin" };
  }
  await prisma.membership.updateMany({
    where: { organizationId, userId: targetUserId },
    data: { status: "REVOKED" },
  });
  return { ok: true };
}
