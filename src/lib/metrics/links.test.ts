import { test } from "node:test";
import assert from "node:assert/strict";
import { extractLinks, rewriteBodyLinks, goPath } from "./links";

test("extractLinks finds distinct external http(s) urls", () => {
  const body =
    'See <a href="https://shop.example.com/x">shop</a> and <a href="https://shop.example.com/x">again</a> plus <a href="http://other.test">o</a>.';
  assert.deepEqual(extractLinks(body), [
    "https://shop.example.com/x",
    "http://other.test",
  ]);
});

test("extractLinks ignores relative + mailto + anchors", () => {
  const body =
    '<a href="/local">a</a> <a href="mailto:x@y.z">m</a> <a href="#top">t</a>';
  assert.deepEqual(extractLinks(body), []);
});

test("rewriteBodyLinks swaps only mapped urls for their go path", () => {
  const body = '<a href="https://a.test">a</a> <a href="https://b.test">b</a>';
  const out = rewriteBodyLinks(body, { "https://a.test": "tok1" });
  assert.equal(out.includes('href="/go/tok1"'), true);
  assert.equal(out.includes('href="https://b.test"'), true);
  assert.equal(out.includes('href="https://a.test"'), false);
});

test("goPath builds the redirect path", () => {
  assert.equal(goPath("abc"), "/go/abc");
});
