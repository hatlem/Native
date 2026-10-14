import { test } from "node:test";
import assert from "node:assert/strict";
import { viewAsCommitConfirmed, isViewingAs, VIEW_AS_CONFIRM_FIELD } from "./view-as";
import type { Workspace } from "./workspace";

const ws = (viewingAsOrgId: string | null): Workspace => ({
  userId: "u1", isAgency: false, agencyOrgId: null, homeOrgId: "o1", homeRole: "ADMIN",
  activeOrgId: "o1", scopeOrgIds: ["o1"], editOrgIds: ["o1"], commitOrgIds: ["o1"],
  activeRole: "ADMIN", activeCanCommit: true, activeCanEdit: true, viewingAsOrgId,
});
const form = (confirmed: boolean) => {
  const fd = new FormData();
  if (confirmed) fd.set(VIEW_AS_CONFIRM_FIELD, "1");
  return fd;
};

test("a real customer commits without any confirmation", () => {
  assert.equal(viewAsCommitConfirmed(ws(null), "o1", form(false)), true);
  assert.equal(viewAsCommitConfirmed(null, "o1", form(false)), true);
});

test("a superadmin viewing as the org must confirm the commit", () => {
  assert.equal(viewAsCommitConfirmed(ws("o1"), "o1", form(false)), false);
  assert.equal(viewAsCommitConfirmed(ws("o1"), "o1", form(true)), true);
});

test("the confirmation only applies to the org being viewed", () => {
  assert.equal(isViewingAs(ws("o1"), "o2"), false);
  assert.equal(viewAsCommitConfirmed(ws("o1"), "o2", form(false)), true);
});

test("a wrong value is not a confirmation", () => {
  const fd = new FormData();
  fd.set(VIEW_AS_CONFIRM_FIELD, "on");
  assert.equal(viewAsCommitConfirmed(ws("o1"), "o1", fd), false);
});
