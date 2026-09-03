import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emailChangeConfirmEmail,
  emailChangeNoticeEmail,
} from "./email-change";

const URL = "https://nativespin.com/en/account/confirm-email/abc123";
const NEW_EMAIL = "new@corp.com";

test("the confirmation mail carries the link and the new address", () => {
  const m = emailChangeConfirmEmail({
    url: URL,
    newEmail: NEW_EMAIL,
    locale: "en",
    appName: "NativeSpin",
  });
  assert.ok(m.subject.includes("NativeSpin"));
  assert.ok(m.text.includes(URL));
  assert.ok(m.text.includes(NEW_EMAIL));
  assert.ok(m.html.includes(URL));
});

test("the notice to the old address carries NO link", () => {
  // The old mailbox must not be able to confirm a change away from itself —
  // that's the whole point of confirming at the new address.
  const m = emailChangeNoticeEmail({
    newEmail: NEW_EMAIL,
    locale: "en",
    appName: "NativeSpin",
  });
  assert.ok(m.text.includes(NEW_EMAIL));
  assert.ok(!m.text.includes("confirm-email"));
  assert.ok(!m.html.includes("confirm-email"));
});

test("both mails fall back to English for an unknown locale", () => {
  for (const m of [
    emailChangeConfirmEmail({ url: URL, newEmail: NEW_EMAIL, locale: "klingon", appName: "NativeSpin" }),
    emailChangeNoticeEmail({ newEmail: NEW_EMAIL, locale: "klingon", appName: "NativeSpin" }),
  ]) {
    assert.ok(m.subject.length > 0);
    assert.ok(m.text.includes(NEW_EMAIL));
  }
});

test("every locale renders both mails with the new address interpolated", () => {
  for (const locale of ["en", "no", "sv", "da", "de", "fi"]) {
    const c = emailChangeConfirmEmail({ url: URL, newEmail: NEW_EMAIL, locale, appName: "NativeSpin" });
    const n = emailChangeNoticeEmail({ newEmail: NEW_EMAIL, locale, appName: "NativeSpin" });
    assert.ok(c.text.includes(NEW_EMAIL), `${locale} confirm`);
    assert.ok(n.text.includes(NEW_EMAIL), `${locale} notice`);
  }
});
