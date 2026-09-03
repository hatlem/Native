import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseEmail, validateEmailChange } from "./email-change";

test("normaliseEmail lowercases and trims", () => {
  assert.equal(normaliseEmail("  Ada@Corp.COM \n"), "ada@corp.com");
});

test("a valid new address is accepted and returned normalised", () => {
  const v = validateEmailChange("old@corp.com", "  New@Corp.com ");
  assert.deepEqual(v, { ok: true, email: "new@corp.com" });
});

test("a case-only edit is rejected as a no-op, not sent as a confirmation", () => {
  // Addresses are stored lowercased, so "Ada@corp.com" would confirm into the
  // value already on the row — a link that changes nothing.
  assert.deepEqual(validateEmailChange("ada@corp.com", "Ada@Corp.com"), {
    ok: false,
    reason: "email_same",
  });
});

test("malformed addresses are rejected before any mail goes out", () => {
  for (const bad of ["", "   ", "no-at-sign", "two@@corp.com", "a@b", "a b@corp.com"]) {
    assert.deepEqual(
      validateEmailChange("old@corp.com", bad),
      { ok: false, reason: "email_invalid" },
      `${JSON.stringify(bad)} should be rejected`,
    );
  }
});

test("absurdly long addresses are rejected", () => {
  const long = `${"a".repeat(250)}@corp.com`;
  assert.deepEqual(validateEmailChange("old@corp.com", long), {
    ok: false,
    reason: "email_invalid",
  });
});
