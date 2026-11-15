// fetch() with a hard deadline. A server-side call to a third party that
// never answers would otherwise hold the request (and its DB connection) open
// until the platform kills it. Rejects with a TimeoutError DOMException when
// the deadline passes; a caller-supplied signal is honoured as well.
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

export function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  return fetch(input, { ...init, signal });
}

export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}
