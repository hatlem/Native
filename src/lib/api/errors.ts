// The one error envelope of the public API (/api/v1): every non-2xx answer is
//   { "error": { "code": "...", "message": "...", "details"?: ... } }
// Shared by all v1 route handlers (it used to be re-declared in each).
import { NextResponse } from "next/server";

export function errJson(
  status: number,
  code: string,
  message: string,
  details?: unknown,
  headers?: Record<string, string>,
) {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status, ...(headers ? { headers } : {}) },
  );
}

// Whole seconds a client should wait, never less than 1.
export function retryAfterSeconds(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}

// 429 with the standard Retry-After header, so client libraries can back off
// without parsing the message.
export function rateLimitedJson(retryAfterMs: number, message?: string) {
  const secs = retryAfterSeconds(retryAfterMs);
  return errJson(429, "RATE_LIMITED", message ?? `Slow down — retry after ${secs}s.`, undefined, {
    "Retry-After": String(secs),
  });
}
