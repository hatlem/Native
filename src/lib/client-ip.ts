import { headers } from "next/headers";

// Best-effort client IP for rate-limit keys and audit rows, read from the
// proxy headers Railway/Cloudflare set. Server-action scope only — route
// handlers read the same headers off their NextRequest instead.
export async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}
