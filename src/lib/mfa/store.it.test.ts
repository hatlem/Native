import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { timeStep, totpAt } from "./totp";
import {
  cancelEnrolment,
  confirmEnrolment,
  disableMfa,
  getMfaStatus,
  isMfaEnabled,
  pendingSecret,
  regenerateRecoveryCodes,
  startEnrolment,
  verifySecondFactor,
} from "./store";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only against
// a DISPOSABLE database. Proves the two-factor rules that live in the
// database: a secret only counts once confirmed, a TOTP time-step and a
// recovery code are each accepted exactly once (also under a race), and
// turning two-factor on or off revokes existing sessions.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("mfa store integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  process.env.AUTH_SECRET ||= "it-test-secret-it-test-secret-it";
  let userId: string;
  // A fixed clock, so codes are deterministic and steps can be walked.
  const T0 = 1_800_000_000_000;
  const stepMs = 30_000;

  before(async () => {
    const user = await prisma.user.create({
      data: { email: `mfa-it-${Date.now()}@example.test`, role: "DESK", emailVerifiedAt: new Date() },
    });
    userId = user.id;
  });

  after(async () => {
    await prisma.notification.deleteMany({ where: { user: { id: userId } } });
    await prisma.user.deleteMany({ where: { id: userId } }); // recovery codes cascade
  });

  const sv = async () =>
    (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { sessionVersion: true } }))
      .sessionVersion;

  test("enrolment: a generated secret is pending, stored encrypted, and not yet enforced", async () => {
    const secret = await startEnrolment(userId);
    assert.ok(secret);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.ok(row.mfaSecretEnc?.startsWith("v1."));
    assert.ok(!row.mfaSecretEnc!.includes(secret!));
    assert.equal(row.mfaEnabledAt, null);
    assert.equal(await pendingSecret(userId), secret);
    assert.deepEqual(await getMfaStatus(userId), { enabled: false, pending: true, recoveryCodesLeft: 0 });
    assert.equal(await isMfaEnabled(userId), false);
    // No second factor exists to verify against until it is confirmed.
    const r = await verifySecondFactor(userId, totpAt(secret!, timeStep(T0))!, T0);
    assert.deepEqual(r, { ok: false, reason: "not_enabled" });
  });

  test("enrolment: cancel forgets the pending secret", async () => {
    await cancelEnrolment(userId);
    assert.equal(await pendingSecret(userId), null);
    assert.deepEqual(await getMfaStatus(userId), { enabled: false, pending: false, recoveryCodesLeft: 0 });
  });

  let secret: string;
  let recoveryCodes: string[];

  test("enrolment: a wrong code does not enable; the right one does, issues codes and revokes sessions", async () => {
    secret = (await startEnrolment(userId))!;
    const before = await sv();

    assert.deepEqual(await confirmEnrolment(userId, "000000", T0), { ok: false });
    assert.equal(await isMfaEnabled(userId), false);
    assert.equal(await sv(), before);

    const result = await confirmEnrolment(userId, totpAt(secret, timeStep(T0))!, T0);
    assert.ok(result.ok);
    if (!result.ok) return;
    recoveryCodes = result.recoveryCodes;
    assert.equal(recoveryCodes.length, 10);
    assert.equal(result.sessionVersion, before + 1);
    assert.equal(await sv(), before + 1);
    assert.deepEqual(await getMfaStatus(userId), { enabled: true, pending: false, recoveryCodesLeft: 10 });

    // Codes are stored hashed only.
    const rows = await prisma.mfaRecoveryCode.findMany({ where: { userId } });
    assert.equal(rows.length, 10);
    for (const r of rows) assert.ok(!recoveryCodes.some((c) => r.codeHash.includes(c.replace("-", ""))));
  });

  test("enrolment cannot be restarted (secret swapped) while two-factor is on", async () => {
    assert.equal(await startEnrolment(userId), null);
    assert.equal(await pendingSecret(userId), null);
    await cancelEnrolment(userId); // no-op on an enabled account
    assert.equal(await isMfaEnabled(userId), true);
  });

  test("replay: the code that confirmed enrolment cannot also sign in", async () => {
    const r = await verifySecondFactor(userId, totpAt(secret, timeStep(T0))!, T0);
    assert.deepEqual(r, { ok: false, reason: "replay" });
  });

  test("totp: next step is accepted once; the same and any older code are then refused", async () => {
    const t1 = T0 + stepMs;
    const code1 = totpAt(secret, timeStep(t1))!;
    const ok = await verifySecondFactor(userId, code1, t1);
    assert.deepEqual(ok, { ok: true, method: "totp", recoveryCodesLeft: 10 });
    assert.deepEqual(await verifySecondFactor(userId, code1, t1), { ok: false, reason: "replay" });

    // Two steps on: the previous step's code is still inside the ±1 window
    // by time, but sits below the last accepted step — refused.
    const t2 = T0 + 2 * stepMs;
    assert.ok((await verifySecondFactor(userId, totpAt(secret, timeStep(t2))!, t2)).ok);
    assert.deepEqual(await verifySecondFactor(userId, code1, t2), { ok: false, reason: "replay" });
  });

  test("totp: wrong codes are invalid and consume nothing", async () => {
    const t = T0 + 10 * stepMs;
    const right = totpAt(secret, timeStep(t))!;
    const wrong = right === "000000" ? "000001" : "000000";
    assert.deepEqual(await verifySecondFactor(userId, wrong, t), { ok: false, reason: "invalid" });
    assert.deepEqual(await verifySecondFactor(userId, "", t), { ok: false, reason: "invalid" });
    assert.ok((await verifySecondFactor(userId, right, t)).ok);
  });

  test("totp: two concurrent submissions of one code — exactly one wins", async () => {
    const t = T0 + 20 * stepMs;
    const code = totpAt(secret, timeStep(t))!;
    const results = await Promise.all([
      verifySecondFactor(userId, code, t),
      verifySecondFactor(userId, code, t),
      verifySecondFactor(userId, code, t),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1);
  });

  test("recovery code: works once (any casing), then never again; others stay valid", async () => {
    const t = T0 + 30 * stepMs;
    const first = await verifySecondFactor(userId, recoveryCodes[0].toUpperCase(), t);
    assert.deepEqual(first, { ok: true, method: "recovery", recoveryCodesLeft: 9 });
    assert.deepEqual(await verifySecondFactor(userId, recoveryCodes[0], t), { ok: false, reason: "invalid" });
    assert.deepEqual(await verifySecondFactor(userId, "zzzzz-zzzzz", t), { ok: false, reason: "invalid" });

    const race = await Promise.all([
      verifySecondFactor(userId, recoveryCodes[1], t),
      verifySecondFactor(userId, recoveryCodes[1], t),
    ]);
    assert.equal(race.filter((r) => r.ok).length, 1);
    assert.equal((await getMfaStatus(userId)).recoveryCodesLeft, 8);
  });

  test("recovery code: belongs to its account only", async () => {
    const other = await prisma.user.create({
      data: { email: `mfa-it-other-${Date.now()}@example.test`, role: "BUYER" },
    });
    try {
      const s = (await startEnrolment(other.id))!;
      const confirmed = await confirmEnrolment(other.id, totpAt(s, timeStep(T0))!, T0);
      assert.ok(confirmed.ok);
      // A valid, unused code of the first user does nothing on the second.
      assert.deepEqual(await verifySecondFactor(other.id, recoveryCodes[2], T0), { ok: false, reason: "invalid" });
      assert.equal((await getMfaStatus(userId)).recoveryCodesLeft, 8);
    } finally {
      await prisma.user.deleteMany({ where: { id: other.id } });
    }
  });

  test("regenerate: a fresh set replaces the old one", async () => {
    const fresh = await regenerateRecoveryCodes(userId);
    assert.equal(fresh?.length, 10);
    const t = T0 + 40 * stepMs;
    assert.deepEqual(await verifySecondFactor(userId, recoveryCodes[3], t), { ok: false, reason: "invalid" });
    assert.ok((await verifySecondFactor(userId, fresh![0], t)).ok);
  });

  test("disable: clears secret and codes, revokes sessions, and stops being enforced", async () => {
    const before = await sv();
    assert.equal(await disableMfa(userId), before + 1);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(row.mfaEnabledAt, null);
    assert.equal(row.mfaSecretEnc, null);
    assert.equal(row.mfaLastStep, null);
    assert.equal(await prisma.mfaRecoveryCode.count({ where: { userId } }), 0);
    assert.equal(await isMfaEnabled(userId), false);
    assert.equal(await regenerateRecoveryCodes(userId), null);
    // Nothing left to disable: no further session bump.
    assert.equal(await disableMfa(userId), null);
    assert.equal(await sv(), before + 1);
  });
}
