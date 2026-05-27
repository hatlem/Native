// Signup-time gate: only company email addresses are allowed. Personal
// providers (gmail, yahoo, …) and disposable/throwaway services
// (mailinator, 10minutemail, …) are rejected so we don't onboard
// accounts that can't be tied back to a real organisation. The async
// variant additionally rejects domains with no MX records (parked,
// dead, or typo'd domains like "gnail.com").
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

function domainOf(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
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
