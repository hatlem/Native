import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ACCOUNT_OK_KEYS,
  ACCOUNT_ERROR_KEYS,
  accountOkKey,
  accountErrorKey,
} from "./account-messages";
import {
  DESK_USERS_OK_KEYS,
  DESK_USERS_ERROR_KEYS,
  deskUsersOkKey,
  deskUsersErrorKey,
} from "./desk-users-messages";
import en from "../messages/en.json";

// This file is the guard for a bug that shipped and sat unnoticed: six ?error=
// codes the account actions emit had no branch in the page's ternary chain, so
// those failures re-rendered the page with no banner at all — the user saw a
// button that did nothing. Half of them (`email`, `delegation`,
// `delegation_past`) were only found when this test was first run.
//
// Rather than trust review to catch the next one, the tests below read the
// action sources and assert that every literal code they redirect with is
// mapped, and that every mapped key exists in en.json (locale-parity.test.ts
// then extends that to the other five locales).

const ROOT = path.join(process.cwd(), "src");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

// Codes built by interpolation (`?error=${verdict.reason}`) can't be read out
// of the source. Their unions are small, closed, and TypeScript-checked at the
// call site, so they're listed here instead — and still asserted to be mapped.
const DYNAMIC_ACCOUNT_ERROR_CODES = [
  // EmailChangeDenyReason (@/lib/email-change)
  "email_invalid",
  "email_same",
  // consumeEmailChangeToken outcomes, mapped in the confirm-email route
  "email_taken",
  "email_expired",
];

// AdminDenyReason (@/lib/user-admin), passed through by denyCode().
const DYNAMIC_DESK_USERS_ERROR_CODES = ["self", "last_superadmin", "not_found"];

const ACCOUNT_ACTION_FILES = [
  "app/account-actions.ts",
  "app/account-email-actions.ts",
  "app/org-invite-actions.ts",
  "app/[locale]/account/confirm-email/[token]/route.ts",
];

/** Literal ?ok= / ?error= codes in redirects that target /account. */
function accountCodes(source: string, kind: "ok" | "error"): string[] {
  const re = new RegExp(`/account\\?${kind}=([A-Za-z0-9_]+)`, "g");
  return [...source.matchAll(re)].map((m) => m[1]);
}

test("every /account ?ok= code an action emits has a message", () => {
  for (const file of ACCOUNT_ACTION_FILES) {
    for (const code of accountCodes(read(file), "ok")) {
      assert.ok(
        ACCOUNT_OK_KEYS[code],
        `${file} redirects with ?ok=${code}, which has no entry in ACCOUNT_OK_KEYS`,
      );
    }
  }
});

test("every /account ?error= code an action emits has a message", () => {
  for (const file of ACCOUNT_ACTION_FILES) {
    for (const code of accountCodes(read(file), "error")) {
      assert.ok(
        ACCOUNT_ERROR_KEYS[code],
        `${file} redirects with ?error=${code}, which has no entry in ACCOUNT_ERROR_KEYS`,
      );
    }
  }
  for (const code of DYNAMIC_ACCOUNT_ERROR_CODES) {
    assert.ok(
      ACCOUNT_ERROR_KEYS[code],
      `interpolated code "${code}" has no entry in ACCOUNT_ERROR_KEYS`,
    );
  }
});

test("the codes that used to render silence are mapped", () => {
  for (const code of ["no_org", "role", "1", "email", "delegation", "delegation_past"]) {
    assert.ok(ACCOUNT_ERROR_KEYS[code], `${code} must map to a message`);
  }
});

test("an unmapped error code falls back to a generic message, never silence", () => {
  assert.equal(accountErrorKey("something_new"), "errGeneric");
  assert.equal(accountErrorKey(undefined), null);
  // Success is the one case where silence beats a wrong banner.
  assert.equal(accountOkKey("something_new"), null);
});

test("every account message key resolves in en.json", () => {
  const ns = (en as unknown as Record<string, Record<string, string>>).account;
  for (const key of [
    ...Object.values(ACCOUNT_OK_KEYS),
    ...Object.values(ACCOUNT_ERROR_KEYS),
    "errGeneric",
  ]) {
    assert.ok(ns[key], `account.${key} is missing from en.json`);
  }
});

test("every /desk/users code the actions emit has a message", () => {
  const source = read("app/user-admin-actions.ts");
  const ok = [...source.matchAll(/\{\s*ok:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  const err = [...source.matchAll(/\{\s*error:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(ok.length > 0 && err.length > 0, "scanner found no codes — did the actions move?");
  for (const code of ok) {
    assert.ok(
      DESK_USERS_OK_KEYS[code],
      `user-admin-actions emits ok=${code}, which has no entry in DESK_USERS_OK_KEYS`,
    );
  }
  for (const code of [...err, ...DYNAMIC_DESK_USERS_ERROR_CODES]) {
    assert.ok(
      DESK_USERS_ERROR_KEYS[code],
      `user-admin-actions emits error=${code}, which has no entry in DESK_USERS_ERROR_KEYS`,
    );
  }
});

test("desk-users messages behave like the account ones on unknown codes", () => {
  assert.equal(deskUsersErrorKey("who_knows"), "errGeneric");
  assert.equal(deskUsersOkKey("who_knows"), null);
});

test("every desk-users message key resolves in en.json", () => {
  const ns = (en as unknown as Record<string, Record<string, string>>).deskUsers;
  for (const key of [
    ...Object.values(DESK_USERS_OK_KEYS),
    ...Object.values(DESK_USERS_ERROR_KEYS),
    "errGeneric",
  ]) {
    assert.ok(ns[key], `deskUsers.${key} is missing from en.json`);
  }
});
