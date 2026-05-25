// Startup guard for production: refuse to boot with the placeholder
// AUTH_SECRET from .env.example so a misconfigured deploy can't sign
// JWTs with a known value. Dev/test/CI/build-time are unaffected —
// `next build` sets NEXT_PHASE so we can tell collection from runtime.

const PLACEHOLDER = "change-me";

export function assertSecret(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  // Skip during `next build` page-data collection; the runtime check
  // still fires when the server actually serves a request.
  if (env.NEXT_PHASE === "phase-production-build") return;
  const secret = env.AUTH_SECRET ?? "";
  if (!secret || secret === PLACEHOLDER || secret.length < 24) {
    throw new Error(
      "AUTH_SECRET is missing or insecure in production. Set a 32-byte random value (openssl rand -base64 32).",
    );
  }
}

// Allow-list URL sanitiser. Publisher-supplied URLs (e.g. PublisherBooking
// `liveUrl`) flow into <a href> in buyer-visible pages and into the
// notification inbox; without a scheme check a malicious publisher could
// set `javascript:alert(...)` and trigger XSS on a buyer's session.
// Returns the trimmed URL when it parses cleanly to http/https/mailto,
// else null.
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"]);
export function safeExternalUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  // Bare paths (publisher could paste a relative URL) are safe to render.
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!SAFE_SCHEMES.has(url.protocol)) return null;
  return url.toString();
}
