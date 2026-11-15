import { test } from "node:test";
import assert from "node:assert/strict";
import { signupErrorField, signupErrorMessageKey } from "./signup-form-state";

const filled = { orgName: "Acme AS", email: "a@acme.no" };

test("email policy errors attach to the email field", () => {
  for (const code of ["email_business", "email_invalid", "email_domain", "email_typo"]) {
    assert.equal(signupErrorField(code, filled), "email", code);
  }
  assert.equal(signupErrorField("password_length", filled), "password");
});

test("missing-input error points at the first empty required field", () => {
  assert.equal(signupErrorField("1", { orgName: "", email: "" }), "orgName");
  assert.equal(signupErrorField("1", { orgName: "Acme", email: "" }), "email");
  assert.equal(signupErrorField("1", filled), null);
});

test("rate limit and unknown codes are form-level", () => {
  assert.equal(signupErrorField("rate", filled), null);
  assert.equal(signupErrorField("whatever", filled), null);
  assert.equal(signupErrorMessageKey("rate", null), "regRateLimited");
  assert.equal(signupErrorMessageKey("whatever", null), "regFailed");
});

test("message keys: typo prompt has none, required fields get their own", () => {
  assert.equal(signupErrorMessageKey(null, null), null);
  assert.equal(signupErrorMessageKey("email_typo", "email"), null);
  assert.equal(signupErrorMessageKey("1", "orgName"), "regOrgRequired");
  assert.equal(signupErrorMessageKey("1", "email"), "regEmailRequired");
});
