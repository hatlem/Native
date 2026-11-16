import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import type { DeskContext, SuperadminContext } from "@/lib/desk-guard";

// Integration test — skipped unless RUN_DB_IT=1 and module mocks are
// available (pnpm test:it passes --experimental-test-module-mocks). The desk
// loaders run only for a context minted by a guard:
//   1. requireDeskContext mints one for DESK and SUPERADMIN, and bounces
//      everyone else to sign-in without minting anything
//   2. a loader refuses an object that merely looks like a context
//   3. a SUPERADMIN-only loader refuses a desk context
//   4. superadminPageGate mints a superadmin context only for a superadmin
const RUN_DB_IT = process.env.RUN_DB_IT === "1";
const CAN_MOCK = typeof (mock as { module?: unknown }).module === "function";

if (!RUN_DB_IT || !CAN_MOCK) {
  test(
    "desk context integration (skipped — set RUN_DB_IT=1 and run with --experimental-test-module-mocks, as pnpm test:it does)",
    { skip: true },
    () => {},
  );
} else {
  let actingUser: { id: string; role: string; email: string } | null = null;
  let guard: typeof import("@/lib/desk-guard");
  let playbooks: typeof import("@/lib/data/desk/playbooks");
  let apiKeys: typeof import("@/lib/data/desk/api-keys");

  const NODE_MAJOR = Number(process.versions.node.split(".")[0]);
  function mockModule(specifier: string, exports: Record<string, unknown>) {
    mock.module(specifier, (NODE_MAJOR >= 26 ? { exports } : { namedExports: exports }) as never);
  }

  async function redirectOf(run: Promise<unknown>): Promise<string> {
    try {
      await run;
    } catch (err) {
      const digest = (err as { digest?: string }).digest ?? "";
      if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
      throw err;
    }
    return "(no redirect)";
  }

  before(async () => {
    mockModule("@/auth", {
      auth: async () =>
        actingUser ? { user: actingUser, expires: new Date(Date.now() + 3_600_000).toISOString() } : null,
    });
    guard = await import("@/lib/desk-guard");
    playbooks = await import("@/lib/data/desk/playbooks");
    apiKeys = await import("@/lib/data/desk/api-keys");
  });

  const as = (role: string | null) => {
    actingUser = role ? { id: `ctx-it-${role}`, role, email: `${role}@example.test` } : null;
  };

  test("requireDeskContext mints a context for desk and superadmin only", async () => {
    as("DESK");
    const desk = await guard.requireDeskContext("en");
    assert.equal(desk.role, "DESK");
    assert.equal(desk.userId, "ctx-it-DESK");
    assert.ok(Array.isArray(await playbooks.loadPlaybooks(desk)));

    as("SUPERADMIN");
    const superadmin = await guard.requireDeskContext("en");
    assert.equal(superadmin.role, "SUPERADMIN");
    assert.ok(Array.isArray(await playbooks.loadPlaybooks(superadmin)));

    for (const role of ["BUYER", "PUBLISHER", "CONTENT", null]) {
      as(role);
      assert.equal(await redirectOf(guard.requireDeskContext("en")), "/en/signin", `role ${role}`);
    }
    // requireDesk is the same gate, returning the user id for audit rows.
    as("DESK");
    assert.equal(await guard.requireDesk("en"), "ctx-it-DESK");
    as("BUYER");
    assert.equal(await redirectOf(guard.requireDesk("en")), "/en/signin");
    await assert.rejects(guard.requireDeskContextOrThrow(), /forbidden/);
  });

  test("a loader refuses an object that only looks like a context", async () => {
    const forged = { userId: "ctx-it-DESK", role: "DESK" } as unknown as DeskContext;
    await assert.rejects(playbooks.loadPlaybooks(forged), /without a desk context/);
    // A copy of a real context is not the real context either.
    as("DESK");
    const real = await guard.requireDeskContext("en");
    const copy = { ...real } as DeskContext;
    await assert.rejects(playbooks.loadPlaybooks(copy), /without a desk context/);
    await assert.rejects(
      playbooks.loadPlaybooks(undefined as unknown as DeskContext),
      /without a desk context/,
    );
  });

  test("a superadmin-only loader refuses a desk context", async () => {
    as("DESK");
    const desk = await guard.requireDeskContext("en");
    await assert.rejects(apiKeys.loadKeys(desk as unknown as SuperadminContext), /with a desk context/);
  });

  test("superadminPageGate mints a superadmin context only for a superadmin", async () => {
    as("DESK");
    assert.deepEqual(await guard.superadminPageGate("en"), { allowed: false });
    as(null);
    assert.equal(await redirectOf(guard.superadminPageGate("en")), "/en/signin");
    as("SUPERADMIN");
    const gate = await guard.superadminPageGate("en");
    assert.ok(gate.allowed);
    if (gate.allowed) {
      assert.equal(gate.userId, "ctx-it-SUPERADMIN");
      assert.ok(Array.isArray(await apiKeys.loadKeys(gate.ctx)));
    }
  });
}
