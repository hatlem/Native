import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canWriteLine,
  canAssignWriter,
  isAssignmentActive,
  canWriteArticle,
} from "./access";

test("desk and superadmin can always write a line", () => {
  const base = { userId: "u1", assignedWriterUserId: null };
  assert.equal(canWriteLine({ role: "DESK", ...base }), true);
  assert.equal(canWriteLine({ role: "SUPERADMIN", ...base }), true);
});

test("CONTENT can write only its own assigned line", () => {
  assert.equal(
    canWriteLine({ role: "CONTENT", userId: "u1", assignedWriterUserId: "u1" }),
    true,
  );
  assert.equal(
    canWriteLine({ role: "CONTENT", userId: "u1", assignedWriterUserId: "u2" }),
    false,
  );
  assert.equal(
    canWriteLine({ role: "CONTENT", userId: "u1", assignedWriterUserId: null }),
    false,
  );
});

test("buyers and missing users cannot write", () => {
  assert.equal(
    canWriteLine({ role: "BUYER", userId: "u1", assignedWriterUserId: "u1" }),
    false,
  );
  assert.equal(
    canWriteLine({ role: "DESK", userId: undefined, assignedWriterUserId: null }),
    false,
  );
});

test("a writer can only be assigned if present in the pool", () => {
  assert.equal(canAssignWriter(["w1", "w2"], "w2"), true);
  assert.equal(canAssignWriter(["w1", "w2"], "w3"), false);
  assert.equal(canAssignWriter([], "w1"), false);
});

test("an assignment is active until its latest asset is FINAL/RETRACTED", () => {
  assert.equal(isAssignmentActive(null), true); // assigned, not yet written
  assert.equal(isAssignmentActive("DRAFT"), true);
  assert.equal(isAssignmentActive("IN_REVIEW"), true);
  assert.equal(isAssignmentActive("FINAL"), false);
});

test("canWriteArticle: DESK can always write", () => {
  assert.equal(
    canWriteArticle({
      role: "DESK",
      userId: "u1",
      organizationId: "org1",
      scopeOrgIds: [],
      assignedWriterUserId: null,
    }),
    true,
  );
});

test("canWriteArticle: SUPERADMIN can always write", () => {
  assert.equal(
    canWriteArticle({
      role: "SUPERADMIN",
      userId: "u1",
      organizationId: "org1",
      scopeOrgIds: [],
      assignedWriterUserId: null,
    }),
    true,
  );
});

test("canWriteArticle: CONTENT can write only if assigned to this article", () => {
  assert.equal(
    canWriteArticle({
      role: "CONTENT",
      userId: "writer1",
      organizationId: "org1",
      scopeOrgIds: [],
      assignedWriterUserId: "writer1",
    }),
    true,
  );
  assert.equal(
    canWriteArticle({
      role: "CONTENT",
      userId: "writer1",
      organizationId: "org1",
      scopeOrgIds: [],
      assignedWriterUserId: "someone-else",
    }),
    false,
  );
  assert.equal(
    canWriteArticle({
      role: "CONTENT",
      userId: "writer1",
      organizationId: "org1",
      scopeOrgIds: [],
      assignedWriterUserId: null,
    }),
    false,
  );
});

test("canWriteArticle: BUYER/APPROVER/ORG_ADMIN can write only within their org scope", () => {
  for (const role of ["BUYER", "APPROVER", "ORG_ADMIN"]) {
    assert.equal(
      canWriteArticle({
        role,
        userId: "buyer1",
        organizationId: "org1",
        scopeOrgIds: ["org1", "org2"],
        assignedWriterUserId: null,
      }),
      true,
      `${role} in scope should be able to write`,
    );
    assert.equal(
      canWriteArticle({
        role,
        userId: "buyer1",
        organizationId: "org3",
        scopeOrgIds: ["org1", "org2"],
        assignedWriterUserId: null,
      }),
      false,
      `${role} out of scope should not be able to write`,
    );
  }
});

test("canWriteArticle: PUBLISHER and unauthenticated cannot write", () => {
  assert.equal(
    canWriteArticle({
      role: "PUBLISHER",
      userId: "pub1",
      organizationId: "org1",
      scopeOrgIds: ["org1"],
      assignedWriterUserId: null,
    }),
    false,
  );
  assert.equal(
    canWriteArticle({
      role: "BUYER",
      userId: undefined,
      organizationId: "org1",
      scopeOrgIds: ["org1"],
      assignedWriterUserId: null,
    }),
    false,
  );
});
