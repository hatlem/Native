// Idempotency-Key support for the public order API (POST /api/v1/orders).
//
// Contract: the client sends an opaque `Idempotency-Key` header it minted
// for ONE logical order. The route reserves the key (a "pending" row) before
// any money-minting work, stores the final response on it ("completed"), and
// replays that stored response verbatim on any retry — a network-retried
// request can therefore never create (and charge) a second order.
//
// The reservation is race-safe: the @@unique([apiKeyId, key]) constraint is
// the arbiter, so two concurrent requests with the same key resolve to one
// "fresh" and one "in-progress" no matter how they interleave.
//
// Crash window (deliberate): if the process dies between reserving and
// completing, the row stays "pending" and every retry of that key gets
// "in-progress" (409 at the route) until the client mints a new key. A stuck
// 409 is strictly better than a possible double charge.

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Visible ASCII (0x21–0x7E): no spaces, control chars, or non-ASCII. 255 is
// the conventional header-value cap (matches Stripe's documented limit).
const KEY_PATTERN = /^[\x21-\x7E]{1,255}$/;

export function isValidIdempotencyKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

// Hash of the RAW request body (before JSON parsing) so key reuse with a
// different payload is detected byte-exactly — a retry must resend the
// identical body, which is what every HTTP client's automatic retry does.
export function hashRequestBody(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export type ReserveResult =
  | { kind: "fresh" }
  | { kind: "replay"; responseStatus: number; responseBody: unknown }
  | { kind: "in-progress" }
  | { kind: "mismatch" };

/** Claim (apiKeyId, key) for this request. Exactly one caller ever gets
 *  "fresh"; everyone else is told what to do instead: replay the stored
 *  response, back off ("in-progress"), or reject the reuse ("mismatch"). */
export async function reserveIdempotencyKey(args: {
  apiKeyId: string;
  key: string;
  requestHash: string;
}): Promise<ReserveResult> {
  const { apiKeyId, key, requestHash } = args;
  try {
    await prisma.apiIdempotencyKey.create({
      data: { apiKeyId, key, requestHash, status: "pending" },
    });
    return { kind: "fresh" };
  } catch (e) {
    const isUniqueViolation =
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
    if (!isUniqueViolation) throw e;
  }
  const row = await prisma.apiIdempotencyKey.findUnique({
    where: { apiKeyId_key: { apiKeyId, key } },
  });
  if (!row) {
    // The unique violation proves the row existed a moment ago; a concurrent
    // failure-path release can delete it between our create and this read.
    // Report in-progress — the client's next retry gets a clean reservation.
    return { kind: "in-progress" };
  }
  if (row.requestHash !== requestHash) return { kind: "mismatch" };
  if (row.status === "completed") {
    return {
      kind: "replay",
      // responseStatus is always set alongside status="completed"; the
      // fallback only guards a manually-mangled row.
      responseStatus: row.responseStatus ?? 500,
      responseBody: row.responseBody,
    };
  }
  return { kind: "in-progress" };
}

/** Store the response on the reservation. From this point every retry of the
 *  key replays exactly this status + body. */
export async function completeIdempotencyKey(args: {
  apiKeyId: string;
  key: string;
  responseStatus: number;
  responseBody: unknown;
}): Promise<void> {
  await prisma.apiIdempotencyKey.update({
    where: { apiKeyId_key: { apiKeyId: args.apiKeyId, key: args.key } },
    data: {
      status: "completed",
      responseStatus: args.responseStatus,
      responseBody:
        args.responseBody === null || args.responseBody === undefined
          ? Prisma.JsonNull
          : (args.responseBody as Prisma.InputJsonValue),
    },
  });
}

/** Free a still-pending reservation after an unexpected failure so the
 *  client's retry isn't wedged on 409. Deliberately refuses to touch a
 *  "completed" row — a stored response must never be un-stored. */
export async function releaseIdempotencyKey(args: {
  apiKeyId: string;
  key: string;
}): Promise<void> {
  await prisma.apiIdempotencyKey.deleteMany({
    where: { apiKeyId: args.apiKeyId, key: args.key, status: "pending" },
  });
}
