import { test } from "node:test";
import assert from "node:assert/strict";
import type { CreateEmailOptions, CreateEmailResponse } from "resend";
import { EmailSendError, makeResendAdapter, type ResendEmailClient } from "./resend";

const ENV = {
  NODE_ENV: "test",
  RESEND_API_KEY: "re_test_key",
  AUTH_EMAIL_FROM: "NativeSpin <noreply@nativespin.com>",
  AUTH_EMAIL_REPLY_TO: "support@nativespin.com",
} as NodeJS.ProcessEnv;

function fakeClient(response: CreateEmailResponse) {
  const calls: CreateEmailOptions[] = [];
  const keys: string[] = [];
  const client: ResendEmailClient = {
    emails: {
      send: async (payload) => {
        calls.push(payload);
        return response;
      },
    },
  };
  const create = (key: string) => {
    keys.push(key);
    return client;
  };
  return { calls, keys, create };
}

const OK: CreateEmailResponse = { data: { id: "email_123" }, error: null, headers: null };

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

test("sends with the configured key, default from and reply-to", async () => {
  const fake = fakeClient(OK);
  const adapter = makeResendAdapter(ENV, fake.create);
  assert.ok(adapter);

  await adapter({ to: "buyer@example.com", subject: "Hi", text: "Body", html: "<p>Body</p>" });

  assert.deepEqual(fake.keys, ["re_test_key"]);
  assert.deepEqual(fake.calls, [
    {
      from: "NativeSpin <noreply@nativespin.com>",
      to: "buyer@example.com",
      subject: "Hi",
      text: "Body",
      html: "<p>Body</p>",
      replyTo: "support@nativespin.com",
    },
  ]);
});

test("per-message from, replyTo and headers override the defaults", async () => {
  const fake = fakeClient(OK);
  const adapter = makeResendAdapter(ENV, fake.create);
  assert.ok(adapter);

  await adapter({
    to: "editor@example.no",
    subject: "Rate card",
    text: "Body",
    from: "Elias <partnerships@nativespin.com>",
    replyTo: "partnerships@nativespin.com",
    headers: { "List-Unsubscribe": "<https://nativespin.com/u/x>" },
  });

  const [sent] = fake.calls;
  assert.equal(sent.from, "Elias <partnerships@nativespin.com>");
  assert.equal(sent.replyTo, "partnerships@nativespin.com");
  assert.deepEqual(sent.headers, { "List-Unsubscribe": "<https://nativespin.com/u/x>" });
});

test("omits replyTo entirely when neither message nor env sets one", async () => {
  const fake = fakeClient(OK);
  const adapter = makeResendAdapter({ NODE_ENV: "test", RESEND_API_KEY: "re_test_key" } as NodeJS.ProcessEnv, fake.create);
  assert.ok(adapter);

  await adapter({ to: "a@example.com", subject: "s", text: "t" });

  assert.equal("replyTo" in fake.calls[0], false);
  assert.equal("headers" in fake.calls[0], false);
});

test("throws EmailSendError carrying the Resend error name, status and message", async () => {
  const fake = fakeClient({
    data: null,
    error: {
      name: "validation_error",
      statusCode: 403,
      message: "The nativespin.com domain is not verified.",
    },
    headers: null,
  });
  const adapter = makeResendAdapter(ENV, fake.create);
  assert.ok(adapter);

  await assert.rejects(
    adapter({ to: "a@example.com", subject: "s", text: "t" }),
    (err: unknown) => {
      assert.ok(err instanceof EmailSendError);
      assert.equal(err.name, "EmailSendError");
      assert.equal(err.code, "validation_error");
      assert.equal(err.statusCode, 403);
      assert.match(err.message, /validation_error 403/);
      assert.match(err.message, /domain is not verified/);
      return true;
    },
  );
});

test("throws on errors without an HTTP status (network failure)", async () => {
  const fake = fakeClient({
    data: null,
    error: { name: "application_error", statusCode: null, message: "fetch failed" },
    headers: null,
  });
  const adapter = makeResendAdapter(ENV, fake.create);
  assert.ok(adapter);

  await assert.rejects(adapter({ to: "a@example.com", subject: "s", text: "t" }), (err: unknown) => {
    assert.ok(err instanceof EmailSendError);
    assert.equal(err.statusCode, null);
    assert.equal(err.message, "Resend rejected email (application_error): fetch failed");
    return true;
  });
});

test("throws when Resend reports success without an email id", async () => {
  const fake = fakeClient({ data: { id: "" }, error: null, headers: null });
  const adapter = makeResendAdapter(ENV, fake.create);
  assert.ok(adapter);

  await assert.rejects(adapter({ to: "a@example.com", subject: "s", text: "t" }), EmailSendError);
});
