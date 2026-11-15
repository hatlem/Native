// Sanitizers for the two publisher-posted media-kit fields on the public
// rate-card form (an anonymous token holder submits them).

// The uploaded-file key must sit under the prefix this token's presign
// issued (`rate-cards/<token>/…`). Anything else — another token's upload,
// an unrelated object, a traversal — is dropped.
export function pinnedRateCardKey(raw: string, token: string): string | null {
  const key = raw.trim();
  if (!key || !token) return null;
  if (key.includes("..") || key.includes("\\") || key.includes("//")) return null;
  return key.startsWith(`rate-cards/${token}/`) ? key : null;
}

// A pasted media-kit link: http(s) only. A bare "example.com/kit.pdf" gets
// https:// prepended; anything that still isn't a safe absolute URL is dropped.
export function normalizeMediaKitUrl(
  raw: string,
  safeExternalUrl: (raw: string | null | undefined) => string | null,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const safe = safeExternalUrl(candidate);
  return safe && /^https?:\/\//i.test(safe) ? safe : null;
}
