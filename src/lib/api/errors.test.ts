import { test } from "node:test";
import assert from "node:assert/strict";
import { errJson, rateLimitedJson, retryAfterSeconds } from "./errors";

test("errJson: uniform envelope, details only when given", async () => {
  const a = errJson(404, "NOT_FOUND", "nope");
  assert.equal(a.status, 404);
  assert.deepEqual(await a.json(), { error: { code: "NOT_FOUND", message: "nope" } });
  const b = errJson(422, "INVALID", "bad", [{ path: "x" }]);
  assert.deepEqual(await b.json(), { error: { code: "INVALID", message: "bad", details: [{ path: "x" }] } });
});

test("rateLimitedJson: 429 with Retry-After in whole seconds (min 1)", async () => {
  const r = rateLimitedJson(2300);
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("Retry-After"), "3");
  assert.equal((await r.json()).error.code, "RATE_LIMITED");
  assert.equal(retryAfterSeconds(0), 1);
  assert.equal(rateLimitedJson(10).headers.get("Retry-After"), "1");
});
