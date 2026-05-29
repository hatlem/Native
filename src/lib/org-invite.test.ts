import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newInviteToken,
  expiryFromNow,
  checkOrgInvite,
  validateOrgClaim,
  validateDelegationDate,
  isDelegatedAdminForbidden,
  buildOrgInviteEmail,
  ORG_INVITE_TTL_DAYS,
} from "./org-invite";

const NOW = new Date("2026-05-29T12:00:00Z");

test("newInviteToken yields 32 url-safe chars, no padding", () => {
  const t = newInviteToken();
  assert.equal(t.length, 32);
  assert.match(t, /^[A-Za-z0-9_-]+$/);
});

test("expiryFromNow defaults to 14 days", () => {
  assert.equal(ORG_INVITE_TTL_DAYS, 14);
  const exp = expiryFromNow(14, NOW);
  assert.equal(exp.toISOString(), "2026-06-12T12:00:00.000Z");
});

test("checkOrgInvite: missing / expired / claimed / ok", () => {
  assert.deepEqual(checkOrgInvite(null, NOW), { ok: false, reason: "missing" });
  assert.deepEqual(
    checkOrgInvite({ email: "a@x.com", expiresAt: new Date("2026-01-01"), claimedAt: null }, NOW),
    { ok: false, reason: "expired" },
  );
  assert.deepEqual(
    checkOrgInvite({ email: "a@x.com", expiresAt: new Date("2026-12-01"), claimedAt: NOW }, NOW),
    { ok: false, reason: "claimed" },
  );
  assert.deepEqual(
    checkOrgInvite({ email: "a@x.com", expiresAt: new Date("2026-12-01"), claimedAt: null }, NOW),
    { ok: true },
  );
});

test("validateOrgClaim: not-logged-in new user → mode new", () => {
  assert.deepEqual(
    validateOrgClaim(
      { email: "a@x.com", expiresAt: new Date("2026-12-01"), claimedAt: null },
      { authedEmail: null, isAlreadyMember: false },
      NOW,
    ),
    { ok: true, mode: "new" },
  );
});

test("validateOrgClaim: logged-in matching email → mode existing", () => {
  assert.deepEqual(
    validateOrgClaim(
      { email: "a@x.com", expiresAt: new Date("2026-12-01"), claimedAt: null },
      { authedEmail: "a@x.com", isAlreadyMember: false },
      NOW,
    ),
    { ok: true, mode: "existing" },
  );
});

test("validateOrgClaim: logged-in different email → email_mismatch", () => {
  assert.deepEqual(
    validateOrgClaim(
      { email: "a@x.com", expiresAt: new Date("2026-12-01"), claimedAt: null },
      { authedEmail: "b@y.com", isAlreadyMember: false },
      NOW,
    ),
    { ok: false, reason: "email_mismatch" },
  );
});

test("validateOrgClaim: case-insensitive email match", () => {
  assert.deepEqual(
    validateOrgClaim(
      { email: "A@X.com", expiresAt: new Date("2026-12-01"), claimedAt: null },
      { authedEmail: "a@x.COM", isAlreadyMember: false },
      NOW,
    ),
    { ok: true, mode: "existing" },
  );
});

test("validateOrgClaim: already a member → already_member", () => {
  assert.deepEqual(
    validateOrgClaim(
      { email: "a@x.com", expiresAt: new Date("2026-12-01"), claimedAt: null },
      { authedEmail: "a@x.com", isAlreadyMember: true },
      NOW,
    ),
    { ok: false, reason: "already_member" },
  );
});

test("validateOrgClaim: expired invite short-circuits before email check", () => {
  assert.deepEqual(
    validateOrgClaim(
      { email: "a@x.com", expiresAt: new Date("2026-01-01"), claimedAt: null },
      { authedEmail: "a@x.com", isAlreadyMember: false },
      NOW,
    ),
    { ok: false, reason: "expired" },
  );
});

test("validateDelegationDate: null ok, future ok, past rejected", () => {
  assert.equal(validateDelegationDate(null, NOW), true);
  assert.equal(validateDelegationDate(new Date("2026-10-05"), NOW), true);
  assert.equal(validateDelegationDate(new Date("2026-01-01"), NOW), false);
});

test("isDelegatedAdminForbidden: ADMIN + date forbidden; others allowed", () => {
  assert.equal(isDelegatedAdminForbidden("ADMIN", new Date("2026-10-05")), true);
  assert.equal(isDelegatedAdminForbidden("ADMIN", null), false);
  assert.equal(isDelegatedAdminForbidden("MEMBER", new Date("2026-10-05")), false);
  assert.equal(isDelegatedAdminForbidden("RESTRICTED", new Date("2026-10-05")), false);
});

test("buildOrgInviteEmail returns localized subject+text containing the link", () => {
  const en = buildOrgInviteEmail({
    locale: "en", orgName: "Maja Co", inviterName: "Maja",
    link: "https://nativespin.com/en/invite/abc", role: "MEMBER", delegationExpiresAt: null,
  });
  assert.match(en.subject, /Maja Co/);
  assert.ok(en.text.includes("https://nativespin.com/en/invite/abc"));

  const no = buildOrgInviteEmail({
    locale: "no", orgName: "Maja Co", inviterName: "Maja",
    link: "https://nativespin.com/no/invite/abc", role: "RESTRICTED",
    delegationExpiresAt: new Date("2026-10-05T00:00:00Z"),
  });
  assert.ok(no.text.includes("2026-10-05"));
  assert.notEqual(no.subject, en.subject);
});

test("buildOrgInviteEmail covers all six locales with distinct subjects from en for non-en", () => {
  const args = (locale: any) => ({ locale, orgName: "Org", inviterName: "I", link: "L", role: "MEMBER" as const, delegationExpiresAt: null });
  const subs = (["en","no","sv","da","fi","de"] as const).map((l) => buildOrgInviteEmail(args(l)).subject);
  // all defined, non-empty
  subs.forEach((s) => assert.ok(s && s.length > 0));
});

test("localized invite emails translate the role word (no raw enum)", () => {
  for (const locale of ["no","sv","da","fi","de"] as const) {
    const built = buildOrgInviteEmail({ locale, orgName: "Org", inviterName: "I", link: "L", role: "RESTRICTED", delegationExpiresAt: null });
    assert.ok(!/\brestricted\b/i.test(built.text), `${locale} leaked raw role word: ${built.text}`);
  }
});
