import { test } from "node:test";
import assert from "node:assert/strict";
import { hasSessionCookie, requiresSession, safeNext, signinPath } from "./auth-gate";

test("requiresSession: app pages need an account, marketing and token pages don't", () => {
  for (const p of ["home", "plan", "plan/abc", "requests/x", "account", "desk/users", "publisher", "writer/profile", "catalog/aftenposten-no", "catalog/compare"]) {
    assert.equal(requiresSession(p), true, p);
  }
  for (const p of ["", "catalog", "pricing", "signin", "invite/tok", "share/tok", "publisher/claim/tok", "writer/claim/tok", "rate-card/tok", "not-a-page"]) {
    assert.equal(requiresSession(p), false, p);
  }
});

test("hasSessionCookie: plain, secure and chunked Auth.js cookies", () => {
  assert.equal(hasSessionCookie(["authjs.session-token"]), true);
  assert.equal(hasSessionCookie(["__Secure-authjs.session-token.0"]), true);
  assert.equal(hasSessionCookie(["NEXT_LOCALE", "authjs.csrf-token"]), false);
});

test("signinPath carries a same-origin next and drops anything else", () => {
  assert.equal(signinPath("no", "/no/plan?x=1"), "/no/signin?next=%2Fno%2Fplan%3Fx%3D1");
  assert.equal(signinPath("no", "https://evil.com"), "/no/signin");
  assert.equal(signinPath("no", "//evil.com"), "/no/signin");
  assert.equal(signinPath("no", "/\\evil.com"), "/no/signin");
  assert.equal(signinPath("no", null), "/no/signin");
  assert.equal(safeNext("/no/home", "/x"), "/no/home");
});
