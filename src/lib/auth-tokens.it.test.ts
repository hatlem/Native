import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { generateToken, hashToken, tokenExpiry } from "@/lib/tokens";
import {
  consumeMagicLinkToken,
  consumePasswordResetToken,
} from "@/lib/auth-tokens";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only
// against a DISPOSABLE database. Proves the single-use token semantics
// the auth flows depend on: atomic consume (double-click loses), expiry,
// emailVerifiedAt stamping, and sibling reset-token invalidation.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("auth-token integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  let userId: string;
  let userEmail: string;

  before(async () => {
    userEmail = `at-it-${Date.now()}@example.test`;
    const user = await prisma.user.create({
      data: {
        email: userEmail,
        role: "BUYER",
        passwordHash: "x-old-hash",
        emailVerifiedAt: null,
      },
    });
    userId = user.id;
  });

  after(async () => {
    // Token rows cascade off the user.
    // notifyDesk/notifyOrg from parallel suites can stamp Notification rows on
    // transient test users mid-run — clear them or the user delete FK-faults.
    await prisma.notification.deleteMany({ where: { user: { id: userId } } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function mintMagicToken(expiresAt = tokenExpiry()): Promise<string> {
    const raw = generateToken();
    await prisma.magicLinkToken.create({
      data: { userId, tokenHash: hashToken(raw), expiresAt },
    });
    return raw;
  }

  async function mintResetToken(expiresAt = tokenExpiry()): Promise<string> {
    const raw = generateToken();
    await prisma.passwordResetToken.create({
      data: { userId, tokenHash: hashToken(raw), expiresAt },
    });
    return raw;
  }

  test("magic-link consume is single-use and stamps emailVerifiedAt", async () => {
    const raw = await mintMagicToken();

    const first = await consumeMagicLinkToken(raw);
    assert.ok(first, "first consume should win");
    assert.equal(first.id, userId);
    assert.equal(first.email, userEmail);

    // The inbox click is the proof of address ownership.
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.ok(fresh.emailVerifiedAt, "emailVerifiedAt should be stamped");

    const row = await prisma.magicLinkToken.findUniqueOrThrow({
      where: { tokenHash: hashToken(raw) },
    });
    assert.ok(row.consumedAt, "token should be marked consumed");

    // Replay (double-click / forwarded link) must lose.
    assert.equal(await consumeMagicLinkToken(raw), null);
  });

  test("magic-link consume rejects expired and unknown tokens", async () => {
    const expired = await mintMagicToken(new Date(Date.now() - 1000));
    assert.equal(await consumeMagicLinkToken(expired), null);
    assert.equal(await consumeMagicLinkToken(generateToken()), null);
    assert.equal(await consumeMagicLinkToken(""), null);
  });

  test("password-reset consume swaps the hash and invalidates siblings", async () => {
    const winner = await mintResetToken();
    const sibling = await mintResetToken();

    const outcome = await consumePasswordResetToken(winner, "x-new-hash");
    assert.ok(outcome.ok, "valid token should consume");
    assert.equal(outcome.ok && outcome.userId, userId);
    assert.equal(outcome.ok && outcome.email, userEmail);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(fresh.passwordHash, "x-new-hash");

    // A stale link from an earlier email must not undo the change later.
    const siblingRow = await prisma.passwordResetToken.findUniqueOrThrow({
      where: { tokenHash: hashToken(sibling) },
    });
    assert.ok(siblingRow.consumedAt, "open sibling tokens should be invalidated");
    const replaySibling = await consumePasswordResetToken(sibling, "x-evil-hash");
    assert.equal(replaySibling.ok, false);

    // Replay of the winner must lose too.
    const replay = await consumePasswordResetToken(winner, "x-evil-hash");
    assert.equal(replay.ok, false);
    const after2 = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(after2.passwordHash, "x-new-hash");
  });

  test("password-reset consume rejects expired tokens without touching the hash", async () => {
    const expired = await mintResetToken(new Date(Date.now() - 1000));
    const before2 = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const outcome = await consumePasswordResetToken(expired, "x-too-late");
    assert.equal(outcome.ok, false);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(fresh.passwordHash, before2.passwordHash);
  });
}
