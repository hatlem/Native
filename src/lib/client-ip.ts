import { headers } from "next/headers";

// Best-effort client IP for rate-limit keys and audit rows, read from the
// proxy headers Railway/Cloudflare set.
export function requestIp(h: Headers): string {
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

// The same, in server-action scope, where there is no request object to read.
// Route handlers pass their request's headers to requestIp instead.
export async function clientIp(): Promise<string> {
  return requestIp(await headers());
}
