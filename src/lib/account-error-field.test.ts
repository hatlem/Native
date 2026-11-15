import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountErrorFieldId } from "./account-error-field";

test("field errors map to an input that exists on the account page", () => {
  const page = readFileSync("src/app/[locale]/account/page.tsx", "utf8");
  for (const code of [
    "phone",
    "company",
    "password_length",
    "current_password",
    "email_invalid",
    "email_taken",
    "email_password",
    "confirm",
  ]) {
    const id = accountErrorFieldId(code);
    assert.ok(id, code);
    assert.ok(page.includes(`id="${id}"`), `${code} → #${id} missing from the page`);
  }
});

test("form-level and unknown codes have no field", () => {
  assert.equal(accountErrorFieldId(undefined), null);
  assert.equal(accountErrorFieldId("rate"), null);
  assert.equal(accountErrorFieldId("last_admin"), null);
  assert.equal(accountErrorFieldId("toString"), null);
});
