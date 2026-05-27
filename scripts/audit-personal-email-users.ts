// Read-only audit: count how many existing User rows have an email
// address that the new email-policy gate would have rejected
// (personal providers like gmail.com, disposable services like
// mailinator.com). Run before deciding whether to grandfather, force
// a domain change, or restrict feature access for those accounts.
//
// Usage:
//   pnpm tsx scripts/audit-personal-email-users.ts
//
// Prints a per-reason count + the top 10 offending domains by user
// count, plus a small sample of affected emails (masked) so you can
// eyeball the kind of accounts caught.

import { prisma } from "@/lib/prisma";
import { checkBusinessEmail, type EmailPolicyVerdict } from "@/lib/email-policy";

function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 2) return "***@" + email.slice(at + 1);
  return email.slice(0, 1) + "***" + email.slice(at - 1);
}

type Bucket = { reason: Exclude<EmailPolicyVerdict, { ok: true }>["reason"]; emails: string[]; domains: Map<string, number> };

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const buckets: Record<string, Bucket> = {
    personal: { reason: "personal", emails: [], domains: new Map() },
    disposable: { reason: "disposable", emails: [], domains: new Map() },
    malformed: { reason: "malformed", emails: [], domains: new Map() },
  };
  let ok = 0;

  for (const u of users) {
    const v = checkBusinessEmail(u.email);
    if (v.ok) {
      ok++;
      continue;
    }
    if (v.reason === "no_mx") continue; // sync function never emits no_mx
    const b = buckets[v.reason];
    b.emails.push(u.email);
    const domain = u.email.split("@")[1]?.toLowerCase() ?? "";
    b.domains.set(domain, (b.domains.get(domain) ?? 0) + 1);
  }

  const total = users.length;
  console.log(`Audited ${total} user(s).`);
  console.log(`  ok (business email):  ${ok}`);
  for (const reason of ["personal", "disposable", "malformed"] as const) {
    const b = buckets[reason];
    const pct = total ? ((b.emails.length / total) * 100).toFixed(1) : "0.0";
    console.log(`  ${reason.padEnd(20)} ${b.emails.length.toString().padStart(5)}  (${pct}%)`);
  }

  for (const reason of ["personal", "disposable", "malformed"] as const) {
    const b = buckets[reason];
    if (b.emails.length === 0) continue;
    console.log(`\n--- ${reason.toUpperCase()} ---`);
    const topDomains = [...b.domains.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    console.log("Top domains:");
    for (const [domain, count] of topDomains) {
      console.log(`  ${count.toString().padStart(4)}  ${domain}`);
    }
    console.log(`Sample (first 5, masked):`);
    for (const e of b.emails.slice(0, 5)) {
      console.log(`  ${maskEmail(e)}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
