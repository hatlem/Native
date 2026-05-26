import { test } from "node:test";
import assert from "node:assert/strict";
import { makeResendAdapter } from "./resend";

test("makeResendAdapter returns null when RESEND_API_KEY is absent", () => {
  const adapter = makeResendAdapter({ NODE_ENV: "test", RESEND_API_KEY: "" } as NodeJS.ProcessEnv);
  assert.equal(adapter, null);
});

test("makeResendAdapter returns a function when RESEND_API_KEY is set", () => {
  const adapter = makeResendAdapter({
    NODE_ENV: "test",
    RESEND_API_KEY: "re_test_key",
  } as NodeJS.ProcessEnv);
  assert.equal(typeof adapter, "function");
});
