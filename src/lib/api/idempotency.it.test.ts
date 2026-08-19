import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { generateApiToken, hashApiToken } from "@/lib/api-key";
import {
  completeIdempotencyKey,
  hashRequestBody,
  releaseIdempotencyKey,
  reserveIdempotencyKey,
} from "./idempotency";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only
// against a DISPOSABLE database. Exercises the reserve/complete/release
// round-trips the order API's double-charge protection depends on, at the
// lib level (no HTTP): fresh reservation, replay of a completed response,
// in-progress backoff, hash-mismatch rejection, per-key isolation, and the
// concurrent-race arbitration the unique constraint provides.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("idempotency integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  let apiKeyId: string;
  let otherApiKeyId: string;

  before(async () => {
    const mk = (n: number) =>
      prisma.apiKey.create({
        data: {
          name: `idempotency-it ${n}`,
          tokenHash: hashApiToken(generateApiToken()),
          scopes: "orders:write",
          createdBy: "idempotency-it",
        },
      });
    apiKeyId = (await mk(1)).id;
    otherApiKeyId = (await mk(2)).id;
  });

  after(async () => {
    // ApiIdempotencyKey rows cascade with the keys.
    await prisma.apiKey.deleteMany({ where: { id: { in: [apiKeyId, otherApiKeyId] } } });
  });

  const hash = hashRequestBody('{"items":[{"productId":"p1","quantity":1}]}');
  const otherHash = hashRequestBody('{"items":[{"productId":"p2","quantity":9}]}');

  test("first reserve is fresh; a duplicate while pending is in-progress", async () => {
    const key = "it-pending-1";
    assert.deepEqual(await reserveIdempotencyKey({ apiKeyId, key, requestHash: hash }), {
      kind: "fresh",
    });
    assert.deepEqual(await reserveIdempotencyKey({ apiKeyId, key, requestHash: hash }), {
      kind: "in-progress",
    });
  });

  test("pending + different hash is mismatch (key reuse beats in-progress)", async () => {
    const key = "it-pending-mismatch";
    await reserveIdempotencyKey({ apiKeyId, key, requestHash: hash });
    assert.deepEqual(
      await reserveIdempotencyKey({ apiKeyId, key, requestHash: otherHash }),
      { kind: "mismatch" },
    );
  });

  test("completed + same hash replays the stored status and body verbatim", async () => {
    const key = "it-replay";
    await reserveIdempotencyKey({ apiKeyId, key, requestHash: hash });
    const body = { requestId: "req_1", orderIds: ["ord_1", "ord_2"] };
    await completeIdempotencyKey({ apiKeyId, key, responseStatus: 201, responseBody: body });

    const again = await reserveIdempotencyKey({ apiKeyId, key, requestHash: hash });
    assert.equal(again.kind, "replay");
    if (again.kind === "replay") {
      assert.equal(again.responseStatus, 201);
      assert.deepEqual(again.responseBody, body);
    }
    // Replay is repeatable — the row is never consumed.
    const third = await reserveIdempotencyKey({ apiKeyId, key, requestHash: hash });
    assert.equal(third.kind, "replay");
  });

  test("completed error responses replay too (deterministic business failures)", async () => {
    const key = "it-replay-409";
    await reserveIdempotencyKey({ apiKeyId, key, requestHash: hash });
    const body = { error: { code: "PRODUCT_UNAVAILABLE", message: "gone" } };
    await completeIdempotencyKey({ apiKeyId, key, responseStatus: 409, responseBody: body });

    const again = await reserveIdempotencyKey({ apiKeyId, key, requestHash: hash });
    assert.equal(again.kind, "replay");
    if (again.kind === "replay") {
      assert.equal(again.responseStatus, 409);
      assert.deepEqual(again.responseBody, body);
    }
  });

  test("completed + different hash is mismatch, never a replay", async () => {
    const key = "it-completed-mismatch";
    await reserveIdempotencyKey({ apiKeyId, key, requestHash: hash });
    await completeIdempotencyKey({ apiKeyId, key, responseStatus: 201, responseBody: { ok: 1 } });
    assert.deepEqual(
      await reserveIdempotencyKey({ apiKeyId, key, requestHash: otherHash }),
      { kind: "mismatch" },
    );
  });

  test("release frees a pending reservation so a retry gets fresh again", async () => {
    const key = "it-release";
    await reserveIdempotencyKey({ apiKeyId, key, requestHash: hash });
    await releaseIdempotencyKey({ apiKeyId, key });
    assert.deepEqual(await reserveIdempotencyKey({ apiKeyId, key, requestHash: hash }), {
      kind: "fresh",
    });
  });

  test("release refuses to delete a completed row — stored responses are permanent", async () => {
    const key = "it-release-completed";
    await reserveIdempotencyKey({ apiKeyId, key, requestHash: hash });
    await completeIdempotencyKey({ apiKeyId, key, responseStatus: 201, responseBody: { ok: 1 } });
    await releaseIdempotencyKey({ apiKeyId, key });
    const again = await reserveIdempotencyKey({ apiKeyId, key, requestHash: hash });
    assert.equal(again.kind, "replay");
  });

  test("keys are scoped per ApiKey — the same key string is independent across keys", async () => {
    const key = "it-cross-key";
    await reserveIdempotencyKey({ apiKeyId, key, requestHash: hash });
    assert.deepEqual(
      await reserveIdempotencyKey({ apiKeyId: otherApiKeyId, key, requestHash: hash }),
      { kind: "fresh" },
    );
  });

  test("concurrent reserves of the same key resolve to exactly one fresh", async () => {
    const key = "it-race";
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        reserveIdempotencyKey({ apiKeyId, key, requestHash: hash }),
      ),
    );
    const fresh = results.filter((r) => r.kind === "fresh");
    const inProgress = results.filter((r) => r.kind === "in-progress");
    assert.equal(fresh.length, 1, "the unique constraint must admit exactly one winner");
    assert.equal(inProgress.length, 7);
  });
}
