import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseContactInput, type ContactRaw } from "./validate";
import { buildContactNotification, contactInbox, DEFAULT_CONTACT_INBOX } from "./email";

const valid: ContactRaw = {
  name: "Marte Berg",
  email: " Marte@Abax.no ",
  organisation: "ABAX",
  role: "advertiser",
  message: "We want native in trade press for Q1.",
  website: "",
};

describe("parseContactInput", () => {
  it("accepts and normalises a valid message", () => {
    const r = parseContactInput(valid);
    assert.ok(r.ok);
    assert.equal(r.data.email, "marte@abax.no");
    assert.equal(r.data.role, "advertiser");
  });

  it("treats a filled honeypot as a bot", () => {
    assert.deepEqual(parseContactInput({ ...valid, website: "http://spam" }), {
      ok: false,
      honeypot: true,
    });
  });

  it("reports one error per field", () => {
    const r = parseContactInput({
      ...valid,
      name: "  ",
      email: "not-an-email",
      role: "hacker",
      message: "",
    });
    assert.ok(!r.ok && !r.honeypot);
    assert.deepEqual(r.fieldErrors, {
      name: "required",
      email: "invalid",
      role: "invalid",
      message: "required",
    });
  });

  it("an empty email is required, not invalid", () => {
    const r = parseContactInput({ ...valid, email: "" });
    assert.ok(!r.ok && !r.honeypot);
    assert.equal(r.fieldErrors.email, "required");
  });

  it("caps the message length", () => {
    const r = parseContactInput({ ...valid, message: "x".repeat(5001) });
    assert.ok(!r.ok && !r.honeypot);
    assert.equal(r.fieldErrors.message, "too_long");
  });

  it("folds line breaks out of single-line fields (subject-line safety)", () => {
    const r = parseContactInput({ ...valid, name: "Marte\r\nBcc: x@y.z" });
    assert.ok(r.ok);
    assert.equal(r.data.name.includes("\n"), false);
  });

  it("company is optional", () => {
    assert.ok(parseContactInput({ ...valid, organisation: "" }).ok);
  });
});

describe("buildContactNotification", () => {
  it("addresses the reply to the sender and carries every field", () => {
    const r = parseContactInput(valid);
    assert.ok(r.ok);
    const n = buildContactNotification(r.data, { locale: "no" });
    assert.equal(n.replyTo, "marte@abax.no");
    assert.match(n.subject, /Advertiser · Marte Berg \(ABAX\)/);
    assert.ok(n.text.includes("We want native in trade press for Q1."));
    assert.ok(n.text.includes("Language: no"));
  });

  it("uses the published inbox unless CONTACT_INBOX overrides it", () => {
    assert.equal(contactInbox({}), DEFAULT_CONTACT_INBOX);
    assert.equal(contactInbox({ CONTACT_INBOX: " desk@example.com " }), "desk@example.com");
  });
});
