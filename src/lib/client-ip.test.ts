import { test } from "node:test";
import assert from "node:assert/strict";
import { ipFromForwardedFor, trustedProxyHops } from "./client-ip";

test("default (no trusted hops): leftmost entry", () => {
  assert.equal(ipFromForwardedFor("1.1.1.1, 2.2.2.2, 3.3.3.3", 0), "1.1.1.1");
  assert.equal(ipFromForwardedFor(null, 0), null);
  assert.equal(ipFromForwardedFor("  ", 0), null);
});

test("with N trusted hops: Nth entry from the right, so a spoofed prefix is ignored", () => {
  // client sent "9.9.9.9" itself; one proxy appended the real peer 2.2.2.2
  assert.equal(ipFromForwardedFor("9.9.9.9, 2.2.2.2", 1), "2.2.2.2");
  assert.equal(ipFromForwardedFor("9.9.9.9, 2.2.2.2, 3.3.3.3", 2), "2.2.2.2");
  // shorter chain than configured: fall back to the leftmost
  assert.equal(ipFromForwardedFor("2.2.2.2", 3), "2.2.2.2");
});

test("TRUSTED_PROXY_HOPS parsing", () => {
  assert.equal(trustedProxyHops(undefined), 0);
  assert.equal(trustedProxyHops("2"), 2);
  assert.equal(trustedProxyHops("-1"), 0);
  assert.equal(trustedProxyHops("abc"), 0);
  assert.equal(trustedProxyHops("1.5"), 0);
});
