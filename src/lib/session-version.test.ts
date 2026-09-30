import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { JWT } from "next-auth/jwt";
import {
  reconcileSessionToken,
  tokenSessionVersion,
  type SessionUserState,
} from "./session-version";

const live: SessionUserState = {
  sessionVersion: 2,
  deactivatedAt: null,
  role: "BUYER",
  orgId: "org_1",
  orgType: "ADVERTISER",
};

const token = (over: Partial<JWT> = {}): JWT => ({
  uid: "u_1",
  role: "BUYER",
  orgId: "org_1",
  orgType: "ADVERTISER",
  sv: 2,
  ...over,
});

describe("reconcileSessionToken", () => {
  test("keeps a token minted under the current version", () => {
    const out = reconcileSessionToken(token(), live);
    assert.ok(out);
    assert.equal(out.uid, "u_1");
    assert.equal(out.sv, 2);
  });

  test("ends a session minted before a password reset bumped the version", () => {
    assert.equal(reconcileSessionToken(token({ sv: 1 }), live), null);
  });

  test("ends the session of a deactivated account", () => {
    assert.equal(
      reconcileSessionToken(token(), { ...live, deactivatedAt: new Date() }),
      null,
    );
  });

  test("ends the session of a deleted user", () => {
    assert.equal(reconcileSessionToken(token(), null), null);
  });

  test("refreshes role and org claims from the row", () => {
    const out = reconcileSessionToken(token(), {
      ...live,
      role: "SUPERADMIN",
      orgId: null,
      orgType: null,
    });
    assert.ok(out);
    assert.equal(out.role, "SUPERADMIN");
    assert.equal(out.orgId, null);
    assert.equal(out.orgType, null);
  });

  test("a pre-claim token reads as version 0: valid until the first bump", () => {
    const legacy = token({ sv: undefined });
    assert.equal(tokenSessionVersion(legacy), 0);
    assert.ok(reconcileSessionToken(legacy, { ...live, sessionVersion: 0 }));
    assert.equal(reconcileSessionToken(legacy, { ...live, sessionVersion: 1 }), null);
  });
});
