import { test } from "node:test";
import assert from "node:assert/strict";
import { NotificationKind } from "@prisma/client";
import {
  NOTIFICATION_CATEGORIES,
  categoryOf,
  emailEnabledFor,
  mutedFromEnabled,
} from "./notification-prefs";

test("every notification kind maps to a known category", () => {
  for (const kind of Object.values(NotificationKind)) {
    assert.ok(NOTIFICATION_CATEGORIES.includes(categoryOf(kind)), kind);
  }
});

test("emailEnabledFor: on by default, off only for a muted category", () => {
  assert.equal(emailEnabledFor("INVOICE_ISSUED", []), true);
  assert.equal(emailEnabledFor("INVOICE_ISSUED", null), true);
  assert.equal(emailEnabledFor("INVOICE_ISSUED", ["billing"]), false);
  assert.equal(emailEnabledFor("QUOTE_READY", ["billing"]), true);
  assert.equal(emailEnabledFor("QUOTE_READY", ["nonsense"]), true);
});

test("mutedFromEnabled keeps only known categories that were unchecked", () => {
  assert.deepEqual(mutedFromEnabled([...NOTIFICATION_CATEGORIES]), []);
  assert.deepEqual(mutedFromEnabled(["quotes", "orders", "bogus"]), ["content", "billing", "planning"]);
  assert.deepEqual(mutedFromEnabled([]), [...NOTIFICATION_CATEGORIES]);
});
