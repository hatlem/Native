// Pure delivery core for partner webhooks (signing + bounded retry), kept
// free of next/server and Prisma so it is unit-testable. See webhooks.ts for
// the contract.
import crypto from "node:crypto";

const DELIVERY_TIMEOUT_MS = 5000;
// Wait before attempt 2 and attempt 3. Bounded so `after()` work stays short.
export const RETRY_DELAYS_MS = [1000, 4000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

// Exported for tests.
export function signatureHeaders(
  secret: string,
  body: string,
  timestampSec: number,
): Record<string, string> {
  const v0 = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const v1 = crypto.createHmac("sha256", secret).update(`${timestampSec}.${body}`).digest("hex");
  return {
    "X-NativeSpin-Signature": `sha256=${v0}`,
    "X-NativeSpin-Timestamp": String(timestampSec),
    "X-NativeSpin-Signature-V1": `sha256=${v1}`,
  };
}

// Exported for tests: is this HTTP status worth another attempt?
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

type AttemptResult = { ok: true } | { ok: false; retryable: boolean; error: string };

async function attempt(
  id: string,
  url: string,
  secret: string,
  body: string,
  attemptNo: number,
  fetchImpl: typeof fetch,
): Promise<AttemptResult> {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...signatureHeaders(secret, body, Math.floor(Date.now() / 1000)),
        "X-NativeSpin-Webhook-Id": id,
        "X-NativeSpin-Delivery-Attempt": String(attemptNo),
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    const text = (await res.text().catch(() => "")).slice(0, 1000);
    return { ok: false, retryable: isRetryableStatus(res.status), error: `HTTP ${res.status}: ${text}` };
  } catch (err) {
    return { ok: false, retryable: true, error: (err as Error).message?.slice(0, 1000) ?? "unknown" };
  }
}

// Exported for tests: the retry loop without the database. Resolves to the
// final outcome and how many attempts were made.
export async function deliverWithRetry(
  id: string,
  url: string,
  secret: string,
  body: string,
  opts: { fetchImpl?: typeof fetch; delaysMs?: number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ ok: boolean; attempts: number; error?: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const delays = opts.delaysMs ?? RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: AttemptResult = { ok: false, retryable: true, error: "not attempted" };
  for (let n = 1; n <= delays.length + 1; n++) {
    last = await attempt(id, url, secret, body, n, fetchImpl);
    if (last.ok) return { ok: true, attempts: n };
    if (!last.retryable || n > delays.length) return { ok: false, attempts: n, error: last.error };
    await sleep(delays[n - 1]);
  }
  return { ok: false, attempts: delays.length + 1, error: last.ok ? undefined : last.error };
}
