// Retry timing for the job queue. Pure, so it is unit-tested without a DB.

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_BACKOFF_BASE_MS = 30_000;
export const MAX_BACKOFF_MS = 60 * 60_000;

// Delay before the next attempt, after `attempt` attempts have failed
// (attempt >= 1): base, 2×base, 4×base … capped at an hour. `jitter` in
// [0, 1) spreads retries so a recovered receiver isn't hit by every queued
// job in the same second (up to +20 %).
export function backoffDelayMs(
  attempt: number,
  baseMs: number = DEFAULT_BACKOFF_BASE_MS,
  jitter: number = Math.random(),
): number {
  const n = Math.max(1, Math.floor(attempt));
  const raw = baseMs * 2 ** Math.min(n - 1, 20);
  const capped = Math.min(raw, MAX_BACKOFF_MS);
  return Math.round(capped * (1 + 0.2 * Math.min(Math.max(jitter, 0), 0.999)));
}

// After a failed attempt: retry later, or give up (dead-letter)?
export function nextStepAfterFailure(args: {
  attempts: number;
  maxAttempts: number;
  nonRetryable: boolean;
}): "retry" | "dead-letter" {
  if (args.nonRetryable) return "dead-letter";
  return args.attempts >= args.maxAttempts ? "dead-letter" : "retry";
}
