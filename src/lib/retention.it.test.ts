import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { anonymiseUser, anonymisedEmail, runRetentionSweep } from "@/lib/retention";
import { withAiBudget } from "@/lib/ai-usage";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only
// against a DISPOSABLE database. Covers the retention sweep (spent tokens,
// dead invites, audit PII scrub, daily latch), user erasure, and the
// database-counted AI budget.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("retention integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  const REF = `ret-it-${Date.now()}`;
  const DAY = 24 * 60 * 60 * 1000;
  // A day far from today, so the latch never collides with a real sweep.
  const NOW = new Date("2031-03-15T12:00:00.000Z");
  const userIds: string[] = [];
  const orgIds: string[] = [];

  after(async () => {
    await prisma.auditLog.deleteMany({
      where: { OR: [{ entity: { contains: REF } }, { entity: { startsWith: "RetentionSweep:daily:2031-03-15" } }, { actor: { in: userIds } }] },
    });
    await prisma.aiCallLog.deleteMany({ where: { scope: { contains: REF } } });
    await prisma.orgInvite.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  async function makeUser(tag: string) {
    const user = await prisma.user.create({
      data: { email: `${REF}-${tag}@example.test`, name: `Ret ${tag}`, phone: "+4712345678", passwordHash: "x" },
    });
    userIds.push(user.id);
    return user;
  }

  test("the sweep deletes spent tokens and dead invites, scrubs old audit PII, once a day", async () => {
    const user = await makeUser("sweep");
    const org = await prisma.organization.create({ data: { name: `RET org ${REF}`, type: "ADVERTISER" } });
    orgIds.push(org.id);
    const old = new Date(NOW.getTime() - 40 * DAY);
    const recent = new Date(NOW.getTime() - 5 * DAY);

    const [oldToken, liveToken] = await Promise.all([
      prisma.magicLinkToken.create({ data: { userId: user.id, tokenHash: `${REF}-old`, expiresAt: old } }),
      prisma.magicLinkToken.create({
        data: { userId: user.id, tokenHash: `${REF}-live`, expiresAt: new Date(NOW.getTime() + DAY) },
      }),
    ]);
    const emailChange = await prisma.emailChangeToken.create({
      data: { userId: user.id, newEmail: `${REF}-new@example.test`, tokenHash: `${REF}-ec`, expiresAt: old },
    });
    const [deadInvite, claimedInvite] = await Promise.all([
      prisma.orgInvite.create({
        data: { organizationId: org.id, email: "a@example.test", token: `${REF}-dead`, expiresAt: old, createdById: user.id },
      }),
      prisma.orgInvite.create({
        data: {
          organizationId: org.id,
          email: "b@example.test",
          token: `${REF}-claimed`,
          expiresAt: old,
          claimedAt: old,
          createdById: user.id,
        },
      }),
    ]);
    const [oldAudit, recentAudit] = await Promise.all([
      prisma.auditLog.create({
        data: {
          actor: user.id,
          action: "auth.signin_failed",
          entity: `User:${REF}-sweep@example.test`,
          detail: JSON.stringify({ ip: "203.0.113.7", attempt: 2 }),
          createdAt: new Date(NOW.getTime() - 120 * DAY),
        },
      }),
      prisma.auditLog.create({
        data: {
          actor: user.id,
          action: "auth.signin_failed",
          entity: `User:${REF}-sweep@example.test`,
          detail: JSON.stringify({ ip: "203.0.113.7" }),
          createdAt: recent,
        },
      }),
    ]);

    const first = await runRetentionSweep(NOW);
    assert.equal(first.ran, true);
    assert.ok(first.tokens >= 2);
    assert.ok(first.invites >= 1);
    assert.ok(first.auditScrubbed >= 1);

    assert.equal(await prisma.magicLinkToken.findUnique({ where: { id: oldToken.id } }), null);
    assert.ok(await prisma.magicLinkToken.findUnique({ where: { id: liveToken.id } }));
    assert.equal(await prisma.emailChangeToken.findUnique({ where: { id: emailChange.id } }), null);
    assert.equal(await prisma.orgInvite.findUnique({ where: { id: deadInvite.id } }), null);
    assert.ok(await prisma.orgInvite.findUnique({ where: { id: claimedInvite.id } }), "claimed invites are history");

    const scrubbed = await prisma.auditLog.findUniqueOrThrow({ where: { id: oldAudit.id } });
    assert.equal(scrubbed.entity, "User:[redacted]");
    assert.equal(scrubbed.detail, JSON.stringify({ attempt: 2 }));
    const untouched = await prisma.auditLog.findUniqueOrThrow({ where: { id: recentAudit.id } });
    assert.match(untouched.detail ?? "", /203\.0\.113\.7/, "inside 90 days: kept");

    // Latched for the day.
    assert.equal((await runRetentionSweep(NOW)).ran, false);
  });

  test("anonymiseUser erases the person and keeps the row", async () => {
    const user = await makeUser("erase");
    const org = await prisma.organization.create({ data: { name: `RET erase org ${REF}`, type: "ADVERTISER" } });
    orgIds.push(org.id);
    await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: "MEMBER" } });
    await prisma.notification.create({ data: { userId: user.id, kind: "QUOTE_READY", title: "hello" } });
    await prisma.auditLog.create({
      data: { actor: user.id, action: "user.updated", entity: `User:${REF}-erase`, detail: JSON.stringify({ email: user.email, ip: "198.51.100.1" }) },
    });

    assert.equal(await anonymiseUser(user.id, NOW), true);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.email, anonymisedEmail(user.id));
    assert.equal(after.name, null);
    assert.equal(after.phone, null);
    assert.equal(after.passwordHash, null);
    assert.ok(after.deactivatedAt);
    assert.equal(after.sessionVersion, user.sessionVersion + 1);
    assert.equal(await prisma.membership.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.notification.count({ where: { userId: user.id } }), 0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { actor: user.id, action: "user.updated" } });
    assert.equal(audit.detail, "{}");

    assert.equal(await anonymiseUser("no-such-user"), false);
  });

  test("the AI budget is counted in the database and refuses without calling", async () => {
    const scope = `org:${REF}`;
    const prev = process.env.AI_DAILY_BUDGET_PER_ORG;
    process.env.AI_DAILY_BUDGET_PER_ORG = "2";
    try {
      let calls = 0;
      const call = async () => {
        calls++;
        return { value: "answer", outcome: "ok" as const };
      };
      const meta = { feature: "brief-match" as const, model: "test-model", scope };
      assert.equal(await withAiBudget(meta, call), "answer");
      assert.equal(await withAiBudget(meta, call), "answer");
      // Third call of the day for this organisation: refused, model not called.
      assert.equal(await withAiBudget(meta, call), null);
      assert.equal(calls, 2);
      const rows = await prisma.aiCallLog.findMany({ where: { scope }, orderBy: { createdAt: "asc" } });
      assert.deepEqual(rows.map((r) => r.outcome), ["ok", "ok", "budget_scope"]);
      // A failed call still counts (it cost a request) and returns null.
      const other = { ...meta, scope: `org:${REF}-b` };
      assert.equal(await withAiBudget(other, async () => ({ value: null, outcome: "timeout" as const })), null);
      assert.equal((await prisma.aiCallLog.findFirstOrThrow({ where: { scope: other.scope } })).outcome, "timeout");
    } finally {
      if (prev === undefined) delete process.env.AI_DAILY_BUDGET_PER_ORG;
      else process.env.AI_DAILY_BUDGET_PER_ORG = prev;
    }
  });
}
