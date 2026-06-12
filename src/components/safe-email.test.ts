import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { SafeEmail, withSafeEmails } from "./safe-email";

test("SafeEmail SSR output never contains a matchable email pattern", () => {
  const html = renderToString(createElement(SafeEmail, { address: "hello@nativespin.com" }));
  // Comment separators break Cloudflare's email regex…
  assert.doesNotMatch(html, /[\w.+-]+@[\w-]+\.[\w-]+/);
  assert.match(html, /<!-- -->/);
  // …while the visible text still reads as the full address.
  assert.equal(html.replace(/<!-- -->/g, ""), "hello@nativespin.com");
});

test("SafeEmail passes through strings without an @", () => {
  const html = renderToString(createElement(SafeEmail, { address: "not-an-email" }));
  assert.equal(html, "not-an-email");
});

test("withSafeEmails guards every address embedded in prose", () => {
  const text = "Write to hello@nativespin.com or partners@nativespin.com today.";
  const html = renderToString(createElement("p", null, withSafeEmails(text)));
  assert.doesNotMatch(html, /[\w.+-]+@[\w-]+\.[\w-]+/);
  assert.equal(
    html.replace(/<!-- -->/g, "").replace(/<\/?p>/g, ""),
    text,
  );
});

test("withSafeEmails returns plain string untouched when no email present", () => {
  assert.equal(withSafeEmails("no addresses here"), "no addresses here");
});
