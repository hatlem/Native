import { test } from "node:test";
import assert from "node:assert/strict";
import { makeGetMailerAdapter, type FetchLike } from "./getmailer";
import { EmailSendError } from "./resend";

const ENV = {
  NODE_ENV: "test",
  GETMAILER_API_KEY: "gm_test_key",
  AUTH_EMAIL_FROM: "NativeSpin <hello@nativespin.com>",
  AUTH_EMAIL_REPLY_TO: "NativeSpin <hello@nativespin.com>",
} as NodeJS.ProcessEnv;

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

function fakeFetch(status: number, payload: unknown) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  };
  return { calls, fetchImpl };
}

test("returns null when GETMAILER_API_KEY is absent or blank", () => {
  assert.equal(makeGetMailerAdapter({ NODE_ENV: "test" } as NodeJS.ProcessEnv), null);
  assert.equal(makeGetMailerAdapter({ NODE_ENV: "test", GETMAILER_API_KEY: "  " } as NodeJS.ProcessEnv), null);
});

test("posts to the GetMailer API with the key, default from and reply-to", async () => {
  const fake = fakeFetch(200, { id: "em_1", status: "sent" });
  const adapter = makeGetMailerAdapter(ENV, { fetchImpl: fake.fetchImpl });
  assert.ok(adapter);

  await adapter({ to: "buyer@example.com", subject: "Hi", text: "Body", html: "<p>Body</p>" });

  assert.equal(fake.calls.length, 1);
  const [call] = fake.calls;
  assert.equal(call.url, "https://api.getmailer.co/api/emails");
  assert.equal(call.init.method, "POST");
  assert.equal((call.init.headers as Record<string, string>).Authorization, "Bearer gm_test_key");
  assert.deepEqual(call.body, {
    from: "NativeSpin <hello@nativespin.com>",
    to: "buyer@example.com",
    subject: "Hi",
    text: "Body",
    html: "<p>Body</p>",
    replyTo: "NativeSpin <hello@nativespin.com>",
  });
});

test("honours GETMAILER_API_URL without doubling slashes", async () => {
  const fake = fakeFetch(200, { id: "em_1" });
  const adapter = makeGetMailerAdapter({ ...ENV, GETMAILER_API_URL: "https://mail.example.test/" }, { fetchImpl: fake.fetchImpl });
  assert.ok(adapter);
  await adapter({ to: "a@example.com", subject: "s", text: "t" });
  assert.equal(fake.calls[0].url, "https://mail.example.test/api/emails");
});

test("per-message from, replyTo and headers override the defaults; absent ones are omitted", async () => {
  const fake = fakeFetch(200, { id: "em_1" });
  const adapter = makeGetMailerAdapter({ NODE_ENV: "test", GETMAILER_API_KEY: "k" } as NodeJS.ProcessEnv, {
    fetchImpl: fake.fetchImpl,
  });
  assert.ok(adapter);

  await adapter({ to: "a@example.com", subject: "s", text: "t" });
  assert.equal("replyTo" in fake.calls[0].body, false);
  assert.equal("headers" in fake.calls[0].body, false);
  assert.equal("html" in fake.calls[0].body, false);
  assert.equal(fake.calls[0].body.from, "NativeSpin <noreply@nativespin.com>");

  await adapter({
    to: "editor@example.no",
    subject: "Rate card",
    text: "Body",
    from: "Elias <elias@nativespin.com>",
    replyTo: "elias@nativespin.com",
    headers: { "List-Unsubscribe": "<https://nativespin.com/u/x>" },
  });
  const sent = fake.calls[1].body;
  assert.equal(sent.from, "Elias <elias@nativespin.com>");
  assert.equal(sent.replyTo, "elias@nativespin.com");
  assert.deepEqual(sent.headers, { "List-Unsubscribe": "<https://nativespin.com/u/x>" });
});

test("a queued (202) send counts as accepted", async () => {
  const fake = fakeFetch(202, { id: "em_1", status: "queued" });
  const adapter = makeGetMailerAdapter(ENV, { fetchImpl: fake.fetchImpl });
  assert.ok(adapter);
  await adapter({ to: "a@example.com", subject: "s", text: "t" });
});

test("throws EmailSendError with GetMailer's code, status and message", async () => {
  const fake = fakeFetch(400, { error: "DNS records missing", code: "DNS_RECORDS_MISSING" });
  const adapter = makeGetMailerAdapter(ENV, { fetchImpl: fake.fetchImpl });
  assert.ok(adapter);
  await assert.rejects(adapter({ to: "a@example.com", subject: "s", text: "t" }), (err: unknown) => {
    assert.ok(err instanceof EmailSendError);
    assert.equal(err.code, "DNS_RECORDS_MISSING");
    assert.equal(err.statusCode, 400);
    assert.equal(err.message, "GetMailer rejected email (DNS_RECORDS_MISSING 400): DNS records missing");
    return true;
  });
});

test("a fully suppressed recipient is mirrored and reported as recipient_suppressed", async () => {
  const fake = fakeFetch(400, { error: "All recipients are on the suppression list", suppressed: ["dead@example.com"] });
  const mirrored: string[][] = [];
  const adapter = makeGetMailerAdapter(ENV, {
    fetchImpl: fake.fetchImpl,
    onSuppressed: async (emails) => {
      mirrored.push(emails);
    },
  });
  assert.ok(adapter);
  await assert.rejects(adapter({ to: "dead@example.com", subject: "s", text: "t" }), (err: unknown) => {
    assert.ok(err instanceof EmailSendError);
    assert.equal(err.code, "recipient_suppressed");
    return true;
  });
  assert.deepEqual(mirrored, [["dead@example.com"]]);
});

test("suppressed recipients on an otherwise successful send are mirrored", async () => {
  const fake = fakeFetch(200, { id: "em_1", suppressedRecipients: ["old@example.com"] });
  const mirrored: string[][] = [];
  const adapter = makeGetMailerAdapter(ENV, {
    fetchImpl: fake.fetchImpl,
    onSuppressed: async (emails) => {
      mirrored.push(emails);
    },
  });
  assert.ok(adapter);
  await adapter({ to: "a@example.com", subject: "s", text: "t" });
  assert.deepEqual(mirrored, [["old@example.com"]]);
});

test("network failures surface as EmailSendError without a status", async () => {
  const adapter = makeGetMailerAdapter(ENV, {
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });
  assert.ok(adapter);
  await assert.rejects(adapter({ to: "a@example.com", subject: "s", text: "t" }), (err: unknown) => {
    assert.ok(err instanceof EmailSendError);
    assert.equal(err.code, "network_error");
    assert.equal(err.statusCode, null);
    return true;
  });
});

test("throws when GetMailer reports success without an email id", async () => {
  const fake = fakeFetch(200, { status: "sent" });
  const adapter = makeGetMailerAdapter(ENV, { fetchImpl: fake.fetchImpl });
  assert.ok(adapter);
  await assert.rejects(adapter({ to: "a@example.com", subject: "s", text: "t" }), EmailSendError);
});

test("a non-JSON error body still yields a useful error", async () => {
  const adapter = makeGetMailerAdapter(ENV, {
    fetchImpl: async () => new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" }),
  });
  assert.ok(adapter);
  await assert.rejects(adapter({ to: "a@example.com", subject: "s", text: "t" }), (err: unknown) => {
    assert.ok(err instanceof EmailSendError);
    assert.equal(err.code, "http_502");
    assert.equal(err.statusCode, 502);
    return true;
  });
});
