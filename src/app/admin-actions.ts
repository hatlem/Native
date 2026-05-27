"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import {
  generateApiToken,
  hashApiToken,
  parseScopes,
} from "@/lib/api-key";

// One-time flash cookie for surfacing a freshly issued API token.
// Previously we redirected to `/desk/api-keys?token=atn_…`, but the
// raw bearer in the URL leaks to browser history, server access logs,
// and any Referer header fired before the user closes the page. The
// flash cookie is httpOnly + path-scoped + short-lived so the page can
// read it server-side exactly once and then clear it.
const ISSUED_KEY_COOKIE = "ns_issued_key";
const ISSUED_KEY_TTL_SECONDS = 120;

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function requireSuperadmin(locale: string): Promise<string> {
  const session = await auth();
  if (session?.user?.role !== "SUPERADMIN") {
    redirect(`/${locale}/signin`);
  }
  return session.user.id;
}

// Server-side allowlist of API-key scopes. Anything not in this set is
// rejected at issuance — that's how we keep a typo'd "catlog:read" or a
// hand-rolled "admin:*" from silently landing in the DB.
//
// `pricing:admin` is internal-only — it grants global mutation across
// every publisher's pricing graph via the MCP server (no per-publisher
// scoping in the v1 schema). The createApiKey action refuses to mint a
// pricing:admin key for any organization other than the NativeSpin
// platform itself (organizationId === null) so a misclicked "issue key
// for Acme Corp" can't accidentally hand a partner ring-0 pricing
// powers.
const VALID_SCOPES: ReadonlySet<string> = new Set([
  "catalog:read",
  "catalog:*",
  "pricing:admin",
]);
const INTERNAL_ONLY_SCOPES: ReadonlySet<string> = new Set(["pricing:admin"]);

// Issue a new public-catalog API key. The raw token is surfaced
// exactly once via an httpOnly flash cookie — NOT a URL query string,
// which would leak the bearer into browser history, server access
// logs, and outbound Referer headers. The page reads the cookie on
// first render, displays the value, and clears the cookie so a refresh
// shows nothing.
//
// Closes Tobias's "no API key auth" gap. Scopes are kept minimal in
// v1: "catalog:read" is the only documented value; the form accepts
// the more permissive "catalog:*" / "*" for future expansion but the
// UI doesn't surface them yet.
export async function createApiKey(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const name = field(formData, "name") || "untitled";
  const organizationId = field(formData, "organizationId") || null;
  const scopesRaw = field(formData, "scopes") || "catalog:read";
  const ttlDaysRaw = field(formData, "ttlDays");

  // Validate scopes upfront so a typo fails loudly rather than at
  // first request when the partner wonders why their key 403s.
  const scopeSet = parseScopes(scopesRaw);
  if (scopeSet.size === 0) {
    redirect(`/${locale}/desk/api-keys?error=scopes`);
  }
  // Reject any scope not in the allowlist. Keeps "admin:*"-shaped typos
  // and undocumented wildcards out of the DB.
  for (const s of scopeSet) {
    if (!VALID_SCOPES.has(s)) {
      redirect(`/${locale}/desk/api-keys?error=scopes`);
    }
  }
  // Internal-only scopes (pricing:admin) MUST be platform keys — the
  // MCP mutation surface has no per-publisher scoping, so handing a
  // pricing:admin key to a customer org would give them mutation
  // power across every publisher in the catalog.
  if (organizationId !== null) {
    for (const s of scopeSet) {
      if (INTERNAL_ONLY_SCOPES.has(s)) {
        redirect(`/${locale}/desk/api-keys?error=internal_only_scope`);
      }
    }
  }

  let expiresAt: Date | null = null;
  if (ttlDaysRaw) {
    const days = Math.trunc(Number(ttlDaysRaw));
    if (Number.isFinite(days) && days > 0 && days <= 365 * 5) {
      expiresAt = new Date();
      expiresAt.setUTCDate(expiresAt.getUTCDate() + days);
    }
  }

  const token = generateApiToken();
  const tokenHash = hashApiToken(token);

  const created = await prisma.apiKey.create({
    data: {
      name,
      organizationId,
      scopes: Array.from(scopeSet).join(","),
      tokenHash,
      createdBy: userId,
      expiresAt,
    },
  });

  await recordAudit(userId, "api_key.create", `ApiKey:${created.id}`, {
    name,
    organizationId,
    scopes: Array.from(scopeSet),
    expiresAt: expiresAt?.toISOString() ?? null,
  });

  // Raw token surfaced once via httpOnly flash cookie — see the
  // ISSUED_KEY_COOKIE comment at the top of this file for the rationale.
  const cookieStore = await cookies();
  cookieStore.set(ISSUED_KEY_COOKIE, JSON.stringify({ id: created.id, token }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/${locale}/desk/api-keys`,
    maxAge: ISSUED_KEY_TTL_SECONDS,
  });
  redirect(`/${locale}/desk/api-keys`);
}

export async function revokeApiKey(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const keyId = field(formData, "keyId");

  const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
  if (!key) redirect(`/${locale}/desk/api-keys`);

  await prisma.apiKey.update({
    where: { id: key.id },
    data: { revokedAt: new Date() },
  });
  await recordAudit(userId, "api_key.revoke", `ApiKey:${key.id}`, {
    name: key.name,
  });
  redirect(`/${locale}/desk/api-keys`);
}
