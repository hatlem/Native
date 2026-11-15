import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { deliverWithRetry, isRetryableStatus, signatureHeaders } from "./webhooks-core";

test("signatureHeaders: v0 signs the body, v1 signs timestamp.body", () => {
  const h = signatureHeaders("s3cret", '{"a":1}', 1700000000);
  const v0 = crypto.createHmac("sha256", "s3cret").update('{"a":1}').digest("hex");
  const v1 = crypto.createHmac("sha256", "s3cret").update('1700000000.{"a":1}').digest("hex");
  assert.equal(h["X-NativeSpin-Signature"], `sha256=${v0}`);
  assert.equal(h["X-NativeSpin-Timestamp"], "1700000000");
  assert.equal(h["X-NativeSpin-Signature-V1"], `sha256=${v1}`);
});

test("isRetryableStatus: 408/429/5xx retry, other 4xx do not", () => {
  for (const s of [408, 429, 500, 502, 503]) assert.equal(isRetryableStatus(s), true);
  for (const s of [400, 401, 404, 410, 422]) assert.equal(isRetryableStatus(s), false);
});

function fakeFetch(statuses: Array<number | Error>) {
  const calls: Array<Record<string, string>> = [];
  const impl = (async (_url: unknown, init?: RequestInit) => {
    calls.push(init?.headers as Record<string, string>);
    const next = statuses.shift();
    if (next instanceof Error) throw next;
    return new Response("x", { status: next ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const noSleep = async () => {};

test("deliverWithRetry: retries a 503 then succeeds, numbering attempts", async () => {
  const f = fakeFetch([503, new Error("ECONNRESET"), 200]);
  const res = await deliverWithRetry("wh1", "http://x", "k", "{}", { fetchImpl: f.impl, sleep: noSleep });
  assert.deepEqual(res, { ok: true, attempts: 3 });
  assert.deepEqual(f.calls.map((h) => h["X-NativeSpin-Delivery-Attempt"]), ["1", "2", "3"]);
});

test("deliverWithRetry: a 4xx rejection is final after one attempt", async () => {
  const f = fakeFetch([422, 200]);
  const res = await deliverWithRetry("wh1", "http://x", "k", "{}", { fetchImpl: f.impl, sleep: noSleep });
  assert.equal(res.ok, false);
  assert.equal(res.attempts, 1);
  assert.match(res.error ?? "", /HTTP 422/);
});

test("deliverWithRetry: gives up after the bounded number of attempts", async () => {
  const f = fakeFetch([500, 500, 500, 200]);
  const res = await deliverWithRetry("wh1", "http://x", "k", "{}", { fetchImpl: f.impl, sleep: noSleep });
  assert.equal(res.ok, false);
  assert.equal(res.attempts, 3);
});
