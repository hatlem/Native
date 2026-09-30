"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import {
  generateApiToken,
  hashApiToken,
  parseKeyBinding,
  parseScopes,
  validateKeyGrant,
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

// A previous issuance's token must never outlive the next action: the flash
// cookie lives 120 s, so an error redirect straight after a successful issue
// showed the OLD token beside the new error — reading as if the failed
// attempt had produced a key. Every action on the page clears it first.
async function clearIssuedKey(locale: string) {
  const cookieStore = await cookies();
  cookieStore.delete({ name: ISSUED_KEY_COOKIE, path: `/${locale}/desk/api-keys` });
}

// Issue a new API key. The raw token is surfaced exactly once via an
// httpOnly flash cookie — NOT a URL query string, which would leak the
// bearer into browser history, server access logs, and outbound Referer
// headers.
//
// Scope/binding rules live in lib/api-key.ts (validateKeyGrant) so a key
// can't be minted that its own endpoint would refuse: pricing:admin is
// platform-only (global pricing mutation via MCP, no tenant scoping),
// orders:write needs an organization, catalog:write a publisher.
export async function createApiKey(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  await clearIssuedKey(locale);
  const fail = (code: string): never => redirect(`/${locale}/desk/api-keys?error=${code}`);

  const name = field(formData, "name") || "untitled";
  const ttlDaysRaw = field(formData, "ttlDays");
  // Checkboxes post one "scopes" entry each; a comma list still parses.
  const scopeSet = parseScopes(
    formData
      .getAll("scopes")
      .filter((v): v is string => typeof v === "string")
      .join(","),
  );
  const binding = parseKeyBinding(field(formData, "binding"));
  if (!binding) return fail("binding");

  const grantError = validateKeyGrant(scopeSet, binding);
  if (grantError) return fail(grantError);

  // The bound org/publisher must exist — a stale option from a page loaded
  // before a delete would otherwise FK-fail as an unhandled 500.
  const organizationId = binding.kind === "organization" ? binding.id : null;
  const publisherId = binding.kind === "publisher" ? binding.id : null;
  const bindingExists =
    binding.kind === "platform" ||
    (organizationId !== null &&
      (await prisma.organization.count({ where: { id: organizationId } })) > 0) ||
    (publisherId !== null && (await prisma.publisher.count({ where: { id: publisherId } })) > 0);
  if (!bindingExists) return fail("binding");

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
      publisherId,
      scopes: Array.from(scopeSet).join(","),
      tokenHash,
      createdBy: userId,
      expiresAt,
    },
  });

  await recordAudit(userId, "api_key.create", `ApiKey:${created.id}`, {
    name,
    organizationId,
    publisherId,
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
  await clearIssuedKey(locale);
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
