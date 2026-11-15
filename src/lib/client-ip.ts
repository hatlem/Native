import { headers } from "next/headers";

// Best-effort client IP for rate-limit keys and audit rows, read from the
// proxy headers Railway/Cloudflare set.
//
// X-Forwarded-For is "client, proxy1, proxy2": each proxy APPENDS the address
// it received the request from. The leftmost entry is therefore whatever the
// client chose to send, and only the entries added by our own proxies can be
// trusted. TRUSTED_PROXY_HOPS says how many proxies sit in front of the app:
// with N hops the client address is the Nth entry from the RIGHT. Unset (the
// default) keeps the historical behaviour — the leftmost entry — which is
// correct only when the edge proxy overwrites the header instead of appending.
export function trustedProxyHops(raw: string | undefined = process.env.TRUSTED_PROXY_HOPS): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= 10 ? n : 0;
}

export function ipFromForwardedFor(
  forwardedFor: string | null | undefined,
  hops: number = trustedProxyHops(),
): string | null {
  const parts = (forwardedFor ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (hops <= 0) return parts[0];
  // Fewer entries than trusted hops: the request did not come through the
  // whole chain; the leftmost entry is the best remaining guess.
  return parts[Math.max(0, parts.length - hops)];
}

export function requestIp(h: Headers): string {
  return ipFromForwardedFor(h.get("x-forwarded-for")) || h.get("x-real-ip") || "unknown";
}

// The same, in server-action scope, where there is no request object to read.
// Route handlers pass their request's headers to requestIp instead.
export async function clientIp(): Promise<string> {
  return requestIp(await headers());
}
