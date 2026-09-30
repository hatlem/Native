// Signup-time gate: only company email addresses are allowed. Personal
// providers (gmail, yahoo, …) and disposable/throwaway services
// (mailinator, 10minutemail, …) are rejected so we don't onboard
// accounts that can't be tied back to a real organisation. The async
// variant additionally rejects domains with no MX records (parked,
// dead, or typo'd domains). Typo-squatted lookalikes of the big providers
// ("gnail.com") DO have MX records, so `suggestEmailDomain` catches those
// separately and the caller asks the user to confirm.
//
// Lists come from canonical public sources synced through npm:
//   - disposable-email-domains  → github.com/disposable-email-domains/disposable-email-domains
//   - free-email-domains        → github.com/Kikobeats/free-email-domains
//
// `checkBusinessEmail` is pure (no I/O) and covers most rejections
// instantly. `checkBusinessEmailWithMx` adds a DNS round-trip — call
// it from server actions where the extra ~50–200ms is acceptable.

import disposable from "disposable-email-domains";
import free from "free-email-domains";
import { resolveMx } from "node:dns/promises";

const DISPOSABLE: ReadonlySet<string> = new Set(disposable);
const FREE: ReadonlySet<string> = new Set(free);

// Escape valve for the rare case a real customer's domain ends up on
// one of the public lists. Keep it small + reviewed in code rather
// than carrying a runtime allowlist table.
const EXTRA_ALLOWED: ReadonlySet<string> = new Set<string>([]);

export type EmailPolicyVerdict =
  | { ok: true }
  | { ok: false; reason: "personal" | "disposable" | "malformed" | "no_mx" };

// Syntax gate ahead of the policy lists. Deliberately the pragmatic shape
// (one @, no whitespace, a dotted domain with a 2+ letter TLD, no empty
// labels) rather than full RFC 5322: it has to reject typos like
// "name@company" or "name@@company.no" without refusing a real address.
const EMAIL_SHAPE =
  /^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

function domainOf(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  if (!EMAIL_SHAPE.test(trimmed)) return null;
  const at = trimmed.lastIndexOf("@");
  if (at < 1 || at === trimmed.length - 1) return null;
  const domain = trimmed.slice(at + 1);
  if (!domain.includes(".")) return null;
  return domain;
}

export function checkBusinessEmail(email: string): EmailPolicyVerdict {
  const domain = domainOf(email);
  if (!domain) return { ok: false, reason: "malformed" };

  if (EXTRA_ALLOWED.has(domain)) return { ok: true };
  // Disposable check first: free-email-domains overlaps with disposable
  // for some providers, and "disposable" is the more actionable reason
  // to surface in logs/audits.
  if (DISPOSABLE.has(domain)) return { ok: false, reason: "disposable" };
  if (FREE.has(domain)) return { ok: false, reason: "personal" };
  return { ok: true };
}

// Lookalikes of the big mail providers. Typo-squatters register domains
// like "gnail.com" and give them MX records on purpose, so the MX check
// below lets them through and a mistyped signup mails its magic link to a
// stranger. The public lists already cover the common misspellings they
// know about (gmial.com, hotmial.com are listed as free mail), so this
// only has to catch the unknown ones.
//
// Ordered by how often buyers in our markets use them: ties go to the
// earlier, likelier provider.
const POPULAR_MAIL_DOMAINS: readonly string[] = [
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "yahoo.com",
  "live.com",
  "googlemail.com",
  "online.no",
  "hotmail.no",
  "live.no",
  "hotmail.se",
  "telia.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "t-online.de",
  "bluewin.ch",
  "hotmail.co.uk",
  "yahoo.co.uk",
  "btinternet.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
];

// Optimal-string-alignment distance: Levenshtein plus adjacent swaps, so
// "gmial" is one edit from "gmail", the way a fast typist gets it wrong.
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

// One slip for short domains; two for longer ones, where two slips still
// leave the name unmistakable ("hotmaill.con"). Short real domains sit
// too close together for a second edit ("gmx.de" / "gmx.at").
function typoBudget(target: string): number {
  return target.length >= 10 ? 2 : 1;
}

// Returns the corrected address when the domain looks like a typo of a
// big mail provider, or null. A suggestion, never a verdict: a real
// company can own a domain one letter away from a provider, so callers
// ask the user to confirm and must let the address through when they do.
// Domains on the public lists are real (or already rejected) and never
// count as typos: "mail.com" is not a misspelt "gmail.com".
export function suggestEmailDomain(email: string): string | null {
  const domain = domainOf(email);
  if (!domain) return null;
  if (EXTRA_ALLOWED.has(domain) || FREE.has(domain) || DISPOSABLE.has(domain)) return null;

  let best: { domain: string; distance: number } | null = null;
  for (const candidate of POPULAR_MAIL_DOMAINS) {
    if (candidate === domain) return null;
    const distance = editDistance(domain, candidate);
    if (distance > typoBudget(candidate)) continue;
    if (!best || distance < best.distance) best = { domain: candidate, distance };
  }
  if (!best) return null;
  const trimmed = email.trim().toLowerCase();
  return `${trimmed.slice(0, trimmed.lastIndexOf("@"))}@${best.domain}`;
}

export function emailDomain(email: string): string | null {
  return domainOf(email);
}

// DNS resolver timeout — Node's default for resolveMx falls through to
// the system resolver which can hang on misbehaving auth servers.
// 2.5s is a generous budget for any healthy domain and short enough
// that a slow signup form stays usable.
const MX_TIMEOUT_MS = 2500;

async function hasMxRecords(domain: string): Promise<boolean> {
  const lookup = (async () => {
    try {
      const records = await resolveMx(domain);
      return records.length > 0;
    } catch {
      // NXDOMAIN, NODATA, SERVFAIL, etc. → treat as no MX.
      return false;
    }
  })();
  const timeout = new Promise<boolean>((resolve) =>
    setTimeout(() => resolve(true), MX_TIMEOUT_MS),
  );
  // Open on timeout: prefer to let a signup through on resolver
  // flakiness rather than block a real customer.
  return Promise.race([lookup, timeout]);
}

export async function checkBusinessEmailWithMx(
  email: string,
): Promise<EmailPolicyVerdict> {
  const v = checkBusinessEmail(email);
  if (!v.ok) return v;
  const domain = domainOf(email)!;
  if (!(await hasMxRecords(domain))) return { ok: false, reason: "no_mx" };
  return { ok: true };
}

// The user-facing error for each rejection. A typo and a dead domain get
// "check the address", not the work-email rule: telling someone who typed
// "name@company" to stop using Gmail sends them the wrong way.
export type EmailPolicyErrorCode = "email_invalid" | "email_domain" | "email_business";

export function emailPolicyErrorCode(
  reason: Extract<EmailPolicyVerdict, { ok: false }>["reason"],
): EmailPolicyErrorCode {
  switch (reason) {
    case "malformed":
      return "email_invalid";
    case "no_mx":
      return "email_domain";
    case "personal":
    case "disposable":
      return "email_business";
  }
}
