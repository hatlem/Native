import { test } from "node:test";
import assert from "node:assert/strict";
import { isStaticTreePath, staticPublicRewrite, STATIC_PUBLIC_PATHS } from "./static-public";
import { requiresSession } from "./auth-gate";

const base = { method: "GET", locales: ["en", "no"], hasSession: false, isServerAction: false, dev: false };

test("a signed-out page load of a listed page goes to the prerendered tree", () => {
  assert.equal(staticPublicRewrite({ ...base, pathname: "/en" }), "/static/en");
  assert.equal(staticPublicRewrite({ ...base, pathname: "/en/" }), "/static/en");
  assert.equal(staticPublicRewrite({ ...base, pathname: "/no/pricing" }), "/static/no/pricing");
  assert.equal(staticPublicRewrite({ ...base, pathname: "/en/catalog" }), "/static/en/catalog");
  assert.equal(staticPublicRewrite({ ...base, pathname: "/en/resources/creative-specs" }), "/static/en/resources/creative-specs");
  assert.equal(staticPublicRewrite({ ...base, method: "HEAD", pathname: "/en/about" }), "/static/en/about");
});

test("everything else renders the [locale] page", () => {
  assert.equal(staticPublicRewrite({ ...base, hasSession: true, pathname: "/en/pricing" }), null);
  assert.equal(staticPublicRewrite({ ...base, dev: true, pathname: "/en/pricing" }), null);
  assert.equal(staticPublicRewrite({ ...base, isServerAction: true, method: "POST", pathname: "/en/contact" }), null);
  assert.equal(staticPublicRewrite({ ...base, method: "POST", pathname: "/en/contact" }), null);
  assert.equal(staticPublicRewrite({ ...base, pathname: "/en/signin" }), null);
  assert.equal(staticPublicRewrite({ ...base, pathname: "/en/catalog/vg-no" }), null);
  assert.equal(staticPublicRewrite({ ...base, pathname: "/xx/pricing" }), null);
  assert.equal(staticPublicRewrite({ ...base, pathname: "/" }), null);
});

test("no listed page needs a session", () => {
  for (const path of STATIC_PUBLIC_PATHS) assert.equal(requiresSession(path), false, path);
});

test("the internal tree is recognised for the 404", () => {
  assert.ok(isStaticTreePath("/static"));
  assert.ok(isStaticTreePath("/static/en/pricing"));
  assert.ok(!isStaticTreePath("/staticky"));
  assert.ok(!isStaticTreePath("/en/static"));
});
