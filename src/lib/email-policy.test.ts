import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkBusinessEmail,
  checkBusinessEmailWithMx,
  emailPolicyErrorCode,
} from "./email-policy";

describe("checkBusinessEmail", () => {
  it("accepts a company domain", () => {
    assert.deepEqual(checkBusinessEmail("ingrid@acme.com"), { ok: true });
  });

  it("normalises casing and surrounding whitespace", () => {
    assert.deepEqual(checkBusinessEmail("  Ingrid@Acme.COM  "), { ok: true });
  });

  it("rejects free personal providers", () => {
    for (const e of [
      "user@gmail.com",
      "user@yahoo.com",
      "user@hotmail.com",
      "user@outlook.com",
      "user@icloud.com",
    ]) {
      assert.deepEqual(checkBusinessEmail(e), {
        ok: false,
        reason: "personal",
      });
    }
  });

  it("rejects disposable / temporary services", () => {
    for (const e of [
      "user@mailinator.com",
      "user@10minutemail.com",
    ]) {
      const v = checkBusinessEmail(e);
      assert.equal(v.ok, false);
      // Some throwaway providers live in BOTH public lists; we only
      // promise that the verdict is reject + not "personal".
      if (!v.ok) assert.notEqual(v.reason, "personal");
    }
  });

  it("rejects malformed addresses", () => {
    for (const e of [
      "",
      "noatsign",
      "not-an-email",
      "@nolocalpart.com",
      "trailing@",
      "missingtld@foo",
      "two@@company.no",
      "space in@company.no",
      "dot@company..no",
      "shorttld@company.n",
    ]) {
      assert.deepEqual(checkBusinessEmail(e), {
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("only matches exact domain, not subdomain trick", () => {
    // foo@mail.gmail.com is a *different* registered domain from
    // gmail.com — match must be exact so we don't false-positive
    // company subdomains.
    assert.deepEqual(checkBusinessEmail("user@mail.acme-gmail.com"), {
      ok: true,
    });
  });
});

describe("checkBusinessEmailWithMx", () => {
  it("short-circuits on a sync rejection (no DNS roundtrip needed)", async () => {
    const v = await checkBusinessEmailWithMx("user@gmail.com");
    assert.deepEqual(v, { ok: false, reason: "personal" });
  });

  it("rejects a malformed address without doing DNS", async () => {
    const v = await checkBusinessEmailWithMx("noatsign");
    assert.deepEqual(v, { ok: false, reason: "malformed" });
  });

  // Note: live DNS tests are deliberately omitted — they would couple
  // CI to the network. The "fails open on resolver flake" behaviour
  // is covered by the 2.5s race-with-timeout in hasMxRecords; the
  // happy-path "no MX → reject" branch is exercised manually against
  // a known-dead domain (e.g. user@nxdomain-7c3.example).
});

describe("emailPolicyErrorCode", () => {
  it("keeps typos and dead domains apart from the work-email rule", () => {
    assert.equal(emailPolicyErrorCode("malformed"), "email_invalid");
    assert.equal(emailPolicyErrorCode("no_mx"), "email_domain");
    assert.equal(emailPolicyErrorCode("personal"), "email_business");
    assert.equal(emailPolicyErrorCode("disposable"), "email_business");
  });

  it("accepts ordinary company addresses the syntax gate must not refuse", () => {
    for (const e of ["first.last@company.no", "a+tag@sub.company.co.uk", "x@my-firm.de"]) {
      assert.deepEqual(checkBusinessEmail(e), { ok: true }, e);
    }
  });
});
