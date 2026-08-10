// Shared buyer-facing display name for titles: append the domain-style brand
// name ("Anlegg & Transport (AT.no)") when we know it. A domain-shaped alias
// wins (curated casing, e.g. "AT.no"); otherwise fall back to the hostname of
// websiteUrl with protocol/www stripped. Pure — safe for RSC and node:test.

/** Matches a bare domain like "at.no", "tu.no" or "salmon-business.com". */
export const DOMAIN_RE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

type TitleDomainSource = {
  websiteUrl?: string | null;
  aliases?: string[];
};

type TitleDisplaySource = TitleDomainSource & { name: string };

/**
 * The domain-style brand name for a title, or null when none can be derived.
 * Prefers a domain-shaped alias (casing preserved), then the websiteUrl
 * hostname with any protocol and leading "www." stripped.
 */
export function titleDomain(t: TitleDomainSource): string | null {
  const alias = t.aliases?.find((a) => DOMAIN_RE.test(a.trim()));
  if (alias) return alias.trim();
  const raw = t.websiteUrl?.trim();
  if (!raw) return null;
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname
      .replace(/^www\./i, "");
    // Reject non-domain hosts (e.g. "localhost", IPs, junk that parsed).
    return DOMAIN_RE.test(host) ? host : null;
  } catch {
    return null;
  }
}

/**
 * "Name (domain)" when a domain is known and not already part of the name,
 * otherwise the plain name — avoids "TU.no (TU.no)".
 */
export function titleDisplayName(t: TitleDisplaySource): string {
  const domain = titleDomain(t);
  if (!domain) return t.name;
  if (t.name.toLowerCase().includes(domain.toLowerCase())) return t.name;
  return `${t.name} (${domain})`;
}
