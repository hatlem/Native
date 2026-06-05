import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canWriteLine,
  canAssignWriter,
  isAssignmentActive,
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
  assert.equal(isAssignmentActive("RETRACTED"), false);
});
