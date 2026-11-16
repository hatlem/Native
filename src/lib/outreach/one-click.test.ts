import { test } from "node:test";
import assert from "node:assert/strict";
import { isOneClickKind, oneClickApiPath, oneClickUnsubscribeTarget } from "./one-click";

test("a one-click POST to an opt-out page is recognised for both outreach flows", () => {
  assert.deepEqual(
    oneClickUnsubscribeTarget({ method: "POST", pathname: "/no/rate-card/abc123/unsubscribe", isServerAction: false }),
    { kind: "rate-card", token: "abc123" },
  );
  assert.deepEqual(
    oneClickUnsubscribeTarget({ method: "POST", pathname: "/en/price-request/t%2Bk/unsubscribe/", isServerAction: false }),
    { kind: "price-request", token: "t+k" },
  );
});

test("page views, server actions and other paths are left alone", () => {
  const path = "/en/rate-card/abc/unsubscribe";
  assert.equal(oneClickUnsubscribeTarget({ method: "GET", pathname: path, isServerAction: false }), null);
  assert.equal(oneClickUnsubscribeTarget({ method: "POST", pathname: path, isServerAction: true }), null);
  for (const pathname of ["/en/rate-card/abc", "/en/rate-card/abc/thanks", "/en/newsletter/abc/unsubscribe", "/rate-card/abc/unsubscribe", "/en/rate-card/a/b/unsubscribe", "/en/rate-card/%E0%A4%A/unsubscribe"]) {
    assert.equal(oneClickUnsubscribeTarget({ method: "POST", pathname, isServerAction: false }), null, pathname);
  }
});

test("the API path carries the kind and the encoded token", () => {
  assert.equal(
    oneClickApiPath({ kind: "price-request", token: "a b/c" }),
    "/api/outreach/unsubscribe?kind=price-request&token=a%20b%2Fc",
  );
  assert.equal(isOneClickKind("rate-card"), true);
  assert.equal(isOneClickKind("newsletter"), false);
  assert.equal(isOneClickKind(null), false);
});
