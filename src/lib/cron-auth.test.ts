import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCronAuth } from "./cron-auth";

const SECRET = "a-long-enough-cron-secret-value";

test("checkCronAuth: disabled without a (long enough) secret", () => {
  assert.equal(checkCronAuth("Bearer x", undefined), "disabled");
  assert.equal(checkCronAuth("Bearer short", "short"), "disabled");
});

test("checkCronAuth: rejects missing and wrong tokens, accepts the right one", () => {
  assert.equal(checkCronAuth(null, SECRET), "unauthorized");
  assert.equal(checkCronAuth(SECRET, SECRET), "unauthorized", "scheme is required");
  assert.equal(checkCronAuth("Bearer nope", SECRET), "unauthorized");
  assert.equal(checkCronAuth(`Bearer ${SECRET}`, SECRET), "ok");
  assert.equal(checkCronAuth(`bearer ${SECRET}`, SECRET), "ok");
});
