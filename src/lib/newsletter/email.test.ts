import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfirmEmail } from "./email";

const urls = {
  confirmUrl: "https://nativespin.com/api/newsletter/confirm?token=abc&lang=no",
  unsubUrl: "https://nativespin.com/api/newsletter/unsubscribe?token=xyz&lang=no",
};
const escaped = (u: string) => u.replaceAll("&", "&amp;");

test("buildConfirmEmail includes both links in text and html", () => {
  const msg = buildConfirmEmail({ ...urls, locale: "en" });
  assert.ok(msg.subject.length > 0);
  assert.ok(msg.text.includes(urls.confirmUrl));
  assert.ok(msg.text.includes(urls.unsubUrl));
  assert.ok(msg.html.includes(escaped(urls.confirmUrl)));
  assert.ok(msg.html.includes(escaped(urls.unsubUrl)));
});

test("buildConfirmEmail is written in the subscriber's language", () => {
  const en = buildConfirmEmail({ ...urls, locale: "en" });
  for (const locale of ["no", "sv", "da", "fi", "de"]) {
    const msg = buildConfirmEmail({ ...urls, locale });
    assert.notEqual(msg.subject, en.subject, `${locale}: subject still English`);
    assert.ok(msg.text.includes(urls.unsubUrl), `${locale}: lost the unsubscribe link`);
  }
  assert.equal(buildConfirmEmail({ ...urls, locale: "xx" }).subject, en.subject);
});
