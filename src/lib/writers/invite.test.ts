import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWriterInviteForm, writerClaimPath } from "./invite";
import { writerInviteEmail, writerAssignedEmail } from "../mail/templates/writer";

function form(email: string, inviteLocale: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("inviteLocale", inviteLocale);
  return fd;
}

test("parseWriterInviteForm normalizes the address and validates it", () => {
  assert.deepEqual(parseWriterInviteForm(form("  Writer@Example.COM ", "no")), {
    ok: true,
    email: "writer@example.com",
    locale: "no",
  });
  assert.deepEqual(parseWriterInviteForm(form("not-an-email", "no")), { ok: false });
});

test("parseWriterInviteForm falls back to English for an unknown language", () => {
  const r = parseWriterInviteForm(form("w@example.com", "xx"));
  assert.ok(r.ok && r.locale === "en");
});

test("writerClaimPath is locale-prefixed and encodes the token", () => {
  assert.equal(writerClaimPath("sv", "a/b"), "/sv/writer/claim/a%2Fb");
});

test("writer emails are localized and carry the absolute link", () => {
  const invite = writerInviteEmail({
    locale: "no",
    inviterName: "Kari",
    url: "https://nativespin.com/no/writer/claim/tok",
    validDays: 14,
    appName: "NativeSpin",
  });
  assert.match(invite.subject, /skrive for NativeSpin/);
  assert.match(invite.text, /Kari/);
  assert.match(invite.text, /https:\/\/nativespin\.com\/no\/writer\/claim\/tok/);
  assert.match(invite.html, /href="https:\/\/nativespin\.com\/no\/writer\/claim\/tok"/);

  const assigned = writerAssignedEmail({
    locale: "de",
    format: "Native-Artikel",
    titleName: "Der Spiegel",
    url: "https://nativespin.com/de/writer/lines/l1",
    appName: "NativeSpin",
  });
  assert.equal(assigned.subject, "Neuer Auftrag: Der Spiegel");
  assert.match(assigned.text, /Native-Artikel/);
  assert.match(assigned.text, /\/de\/writer\/lines\/l1/);
});
