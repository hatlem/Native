import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifySvixSignature, suppressionsFromEvent, type SvixHeaders } from "./resend-webhook";

const SECRET = "whsec_" + Buffer.from("super-secret-signing-key").toString("base64");

function sign(id: string, timestamp: string, payload: string): string {
  const secretBytes = Buffer.from(SECRET.replace(/^whsec_/, ""), "base64");
  const sig = crypto.createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${payload}`).digest("base64");
  return `v1,${sig}`;
}

const NOW_MS = 1_900_000_000_000;
const TS = String(Math.floor(NOW_MS / 1000));

test("verifySvixSignature accepts a correctly signed payload", () => {
  const payload = JSON.stringify({ type: "email.bounced" });
  const headers: SvixHeaders = { id: "msg_1", timestamp: TS, signature: sign("msg_1", TS, payload) };
  assert.equal(verifySvixSignature({ secret: SECRET, payload, headers, nowMs: NOW_MS }), true);
});

test("verifySvixSignature accepts when one of several v1 sigs matches", () => {
  const payload = JSON.stringify({ type: "email.complained" });
  const good = sign("msg_1", TS, payload).slice(3); // strip "v1,"
  const headers: SvixHeaders = { id: "msg_1", timestamp: TS, signature: `v1,deadbeef v1,${good}` };
  assert.equal(verifySvixSignature({ secret: SECRET, payload, headers, nowMs: NOW_MS }), true);
});

test("verifySvixSignature rejects a tampered payload", () => {
  const payload = JSON.stringify({ type: "email.bounced" });
  const headers: SvixHeaders = { id: "msg_1", timestamp: TS, signature: sign("msg_1", TS, payload) };
  assert.equal(
    verifySvixSignature({ secret: SECRET, payload: payload + "x", headers, nowMs: NOW_MS }),
    false,
  );
});

test("verifySvixSignature rejects a stale timestamp (replay guard)", () => {
  const payload = JSON.stringify({ type: "email.bounced" });
  const headers: SvixHeaders = { id: "msg_1", timestamp: TS, signature: sign("msg_1", TS, payload) };
  // 10 minutes later — outside the 5-minute tolerance
  assert.equal(verifySvixSignature({ secret: SECRET, payload, headers, nowMs: NOW_MS + 600_000 }), false);
});

test("verifySvixSignature rejects missing headers/secret", () => {
  const payload = "{}";
  assert.equal(
    verifySvixSignature({ secret: "", payload, headers: { id: null, timestamp: null, signature: null } }),
    false,
  );
});

test("suppressionsFromEvent: complaint suppresses every recipient", () => {
  const out = suppressionsFromEvent({ type: "email.complained", data: { to: ["a@x.com", "b@x.com"] } });
  assert.deepEqual(out, [
    { email: "a@x.com", reason: "complaint" },
    { email: "b@x.com", reason: "complaint" },
  ]);
});

test("suppressionsFromEvent: permanent bounce suppresses; transient does not", () => {
  const perm = suppressionsFromEvent({ type: "email.bounced", data: { to: "dead@x.com", bounce: { type: "Permanent" } } });
  assert.deepEqual(perm, [{ email: "dead@x.com", reason: "bounce" }]);

  const soft = suppressionsFromEvent({ type: "email.bounced", data: { to: "full@x.com", bounce: { type: "Transient" } } });
  assert.deepEqual(soft, []);

  // A bare bounce with no subtype is treated as hard.
  const bare = suppressionsFromEvent({ type: "email.bounced", data: { to: "dead2@x.com" } });
  assert.deepEqual(bare, [{ email: "dead2@x.com", reason: "bounce" }]);
});

test("suppressionsFromEvent: delivered/opened yield nothing", () => {
  assert.deepEqual(suppressionsFromEvent({ type: "email.delivered", data: { to: "a@x.com" } }), []);
  assert.deepEqual(suppressionsFromEvent({ type: "email.opened", data: { to: "a@x.com" } }), []);
});
