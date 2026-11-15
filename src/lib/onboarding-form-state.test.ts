import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidPhone, normalisePhone, validateOnboarding } from "./onboarding-form-state";

test("phone: forgiving formats, at least 6 digits, at most 32 chars", () => {
  assert.equal(isValidPhone("+47 400 00 000"), true);
  assert.equal(isValidPhone("12345"), false);
  assert.equal(isValidPhone("1".repeat(33)), false);
  assert.equal(normalisePhone("  +47   400  00 000 "), "+47 400 00 000");
});

test("validateOnboarding reports each failing field", () => {
  const markets = ["NO", "SE"];
  assert.deepEqual(validateOnboarding({ market: "NO", phone: "+47 400 00 000" }, markets), {});
  assert.deepEqual(validateOnboarding({ market: "", phone: "+47 400 00 000" }, markets), { market: true });
  assert.deepEqual(validateOnboarding({ market: "XX", phone: "12" }, markets), { market: true, phone: true });
});
