import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { addSuppression, isSuppressed, suppressedEmailSet } from "./suppression";

const TEST_EMAILS = ["sup1@example.com", "sup2@example.com"];

before(async () => {
  await prisma.outreachSuppression.deleteMany({ where: { email: { in: TEST_EMAILS } } });
});
after(async () => {
  await prisma.outreachSuppression.deleteMany({ where: { email: { in: TEST_EMAILS } } });
});

test("addSuppression upserts (idempotent) and isSuppressed reflects it", async () => {
  await addSuppression({ email: "  SUP1@Example.COM  ", reason: "unsubscribe" });
  assert.equal(await isSuppressed("sup1@example.com"), true);
  // Re-add — must not throw and must keep first reason
  await addSuppression({ email: "sup1@example.com", reason: "bounce" });
  const row = await prisma.outreachSuppression.findUnique({ where: { email: "sup1@example.com" } });
  assert.equal(row?.reason, "unsubscribe");
});

test("suppressedEmailSet returns the normalised email set", async () => {
  await addSuppression({ email: "sup2@example.com", reason: "manual" });
  const set = await suppressedEmailSet();
  assert.ok(set.has("sup1@example.com"));
  assert.ok(set.has("sup2@example.com"));
});
