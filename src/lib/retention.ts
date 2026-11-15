// Data retention — the automated half of what the privacy policy promises:
// short-lived credentials are deleted once they are no use to anyone, and
// the audit trail keeps WHAT happened but drops the IP addresses and email
// addresses it recorded after 90 days. Plus `anonymiseUser`, the "delete my
// data" path: personal fields are erased while orders, quotes and invoices
// (seven-year accounting records) stay, pointing at a now-anonymous user row.
//
// The sweep runs from lib/sweeps.ts under the same advisory-lock + daily
// latch pattern as the metrics sweep. RETENTION_SWEEP=0 turns it off.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

// Consumed or expired sign-in / reset / email-change links, expired
// unclaimed invites and finished idempotency keys: kept 30 days for
// debugging, then gone.
export const TOKEN_RETENTION_DAYS = 30;
// IPs and email addresses inside audit rows (privacy policy: 90 days).
export const AUDIT_PII_RETENTION_DAYS = 90;
// One tick scrubs at most this many audit rows; a backlog drains over days.
const AUDIT_SCRUB_BATCH = 2000;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Detail keys that hold an IP or an email address.
const PII_DETAIL_KEYS = ["ip", "requestedIp", "email", "newEmail", "oldEmail", "to", "recipient"];

export function redactEmails(value: string): string {
  return value.replace(EMAIL_RE, "[redacted]");
}

// Pure: an audit row with its personal data removed. `detail` loses the PII
// keys (everything else — ids, amounts, statuses — stays); emails anywhere
// else in the row are redacted. Returns null when nothing changes.
export function scrubAuditRow(row: {
  actor: string;
  entity: string;
  detail: string | null;
}): { actor: string; entity: string; detail: string | null } | null {
  let detail = row.detail;
  if (detail) {
    try {
      const parsed: unknown = JSON.parse(detail);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const obj = { ...(parsed as Record<string, unknown>) };
        for (const key of PII_DETAIL_KEYS) delete obj[key];
        detail = redactEmails(JSON.stringify(obj));
      } else {
        detail = redactEmails(detail);
      }
    } catch {
      // Free-text detail.
      detail = redactEmails(detail);
    }
  }
  const actor = redactEmails(row.actor);
  const entity = redactEmails(row.entity);
  if (actor === row.actor && entity === row.entity && detail === row.detail) return null;
  return { actor, entity, detail };
}

export type RetentionSweepResult = {
  ran: boolean;
  tokens: number;
  invites: number;
  idempotencyKeys: number;
  auditScrubbed: number;
};

const LATCH_ACTION = "retention.sweep";
const latchEntity = (now: Date) => `RetentionSweep:daily:${now.toISOString().slice(0, 10)}`;

export async function runRetentionSweep(now: Date = new Date()): Promise<RetentionSweepResult> {
  const entity = latchEntity(now);
  const already = await prisma.auditLog.findFirst({
    where: { entity, action: LATCH_ACTION },
    select: { id: true },
  });
  if (already) return { ran: false, tokens: 0, invites: 0, idempotencyKeys: 0, auditScrubbed: 0 };

  const tokenCutoff = new Date(now.getTime() - TOKEN_RETENTION_DAYS * DAY_MS);
  const spent = { OR: [{ consumedAt: { lt: tokenCutoff } }, { expiresAt: { lt: tokenCutoff } }] };
  const [magic, reset, emailChange] = await Promise.all([
    prisma.magicLinkToken.deleteMany({ where: spent }),
    prisma.passwordResetToken.deleteMany({ where: spent }),
    prisma.emailChangeToken.deleteMany({ where: spent }),
  ]);

  // Invites nobody claimed, long past their expiry. Claimed ones are the
  // record of how an account came to exist and stay.
  const deadInvite = { claimedAt: null, expiresAt: { lt: tokenCutoff } };
  const [orgInvites, publisherInvites, writerInvites] = await Promise.all([
    prisma.orgInvite.deleteMany({ where: deadInvite }),
    prisma.publisherInvite.deleteMany({ where: deadInvite }),
    prisma.writerInvite.deleteMany({ where: deadInvite }),
  ]);

  // A retry with the same Idempotency-Key a month later is a new request.
  const idem = await prisma.apiIdempotencyKey.deleteMany({
    where: { createdAt: { lt: tokenCutoff } },
  });

  // Audit rows past 90 days that still carry an IP or an email address.
  // Scrubbed rows no longer match, so each tick only sees what is left.
  const auditCutoff = new Date(now.getTime() - AUDIT_PII_RETENTION_DAYS * DAY_MS);
  const candidates = await prisma.$queryRaw<
    { id: string; actor: string; entity: string; detail: string | null }[]
  >`
    SELECT "id", "actor", "entity", "detail" FROM "AuditLog"
    WHERE "createdAt" < ${auditCutoff}
      AND ("actor" LIKE '%@%' OR "entity" LIKE '%@%' OR "detail" LIKE '%@%'
           OR "detail" ~ '"(ip|requestedIp)"')
    ORDER BY "createdAt" ASC
    LIMIT ${AUDIT_SCRUB_BATCH}`;
  let auditScrubbed = 0;
  for (const row of candidates) {
    const scrubbed = scrubAuditRow(row);
    if (!scrubbed) continue;
    await prisma.auditLog.update({ where: { id: row.id }, data: scrubbed });
    auditScrubbed++;
  }

  const result = {
    ran: true,
    tokens: magic.count + reset.count + emailChange.count,
    invites: orgInvites.count + publisherInvites.count + writerInvites.count,
    idempotencyKeys: idem.count,
    auditScrubbed,
  };
  // The latch — and the record of what the sweep removed.
  await prisma.auditLog.create({
    data: { actor: "system", action: LATCH_ACTION, entity, detail: JSON.stringify(result) },
  });
  return result;
}

/** The sweep behind the same xact-scoped advisory lock as the other sweeps:
 *  null = another instance holds the lock this tick. */
export async function runRetentionSweepWithLock(
  now: Date = new Date(),
): Promise<RetentionSweepResult | null> {
  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<[{ locked: boolean }]>`
        SELECT pg_try_advisory_xact_lock(hashtext('retention-sweep')) AS locked`;
      if (!locked) return null;
      return runRetentionSweep(now);
    },
    { timeout: 5 * 60_000, maxWait: 10_000 },
  );
}

// ---------- Erasure ("delete my data") ----------

export function anonymisedEmail(userId: string): string {
  return `deleted-${userId}@deleted.invalid`;
}

// Erase a user's personal data. The row itself stays — orders, quotes,
// invoices and audit rows reference it and are records we must keep — but
// nothing on it identifies a person any more, and the account can never be
// signed in to again. Callers run their own guards first (last admin of an
// organisation, last super admin): see deactivateOwnAccount.
export async function anonymiseUser(userId: string, now: Date = new Date()): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!user) return false;

    await Promise.all([
      tx.magicLinkToken.deleteMany({ where: { userId } }),
      tx.passwordResetToken.deleteMany({ where: { userId } }),
      tx.emailChangeToken.deleteMany({ where: { userId } }),
      tx.mfaRecoveryCode.deleteMany({ where: { userId } }),
      tx.notification.deleteMany({ where: { userId } }),
      tx.favoriteList.deleteMany({ where: { userId } }),
      tx.favorite.deleteMany({ where: { userId } }),
      // Their seats: the organisations carry on without them.
      tx.membership.deleteMany({ where: { userId } }),
    ]);

    await tx.user.update({
      where: { id: userId },
      data: {
        email: anonymisedEmail(userId),
        name: null,
        phone: null,
        passwordHash: null,
        lastSignInIp: null,
        locale: null,
        mfaSecretEnc: null,
        mfaEnabledAt: null,
        mfaLastStep: null,
        emailMutedCategories: [],
        organizationId: null,
        deactivatedAt: now,
        // Ends every session the user still has open.
        sessionVersion: { increment: 1 },
      },
    });

    await scrubAuditRowsFor(tx, userId, user.email);
    return true;
  });
}

// The user's own audit rows keep what happened, not who from where.
async function scrubAuditRowsFor(tx: Prisma.TransactionClient, userId: string, email: string) {
  const rows = await tx.auditLog.findMany({
    where: {
      OR: [{ actor: userId }, { actor: email }, { entity: `User:${email}` }, { entity: `User:${userId}` }],
    },
    select: { id: true, actor: true, entity: true, detail: true },
  });
  for (const row of rows) {
    const scrubbed = scrubAuditRow(row);
    if (scrubbed) await tx.auditLog.update({ where: { id: row.id }, data: scrubbed });
  }
}
