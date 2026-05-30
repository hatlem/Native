import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfirmEmail } from "./email";

const urls = {
  confirmUrl: "https://nativespin.com/api/newsletter/confirm?token=abc",
  unsubUrl: "https://nativespin.com/api/newsletter/unsubscribe?token=xyz",
};

test("buildConfirmEmail includes both links in text and html", () => {
  const msg = buildConfirmEmail(urls);
  assert.ok(msg.subject.length > 0);
  assert.ok(msg.text.includes(urls.confirmUrl));
  assert.ok(msg.text.includes(urls.unsubUrl));
  assert.ok(msg.html.includes(urls.confirmUrl));
  assert.ok(msg.html.includes(urls.unsubUrl));
});
