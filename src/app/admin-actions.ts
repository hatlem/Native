"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import {
  generateApiToken,
  hashApiToken,
  parseScopes,
} from "@/lib/api-key";

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

// Issue a new public-catalog API key. Returns by redirecting to
// /desk/api-keys with the raw token in the search params — that's the
// only time the value is shown, and the page reads it from the URL
// once before the user navigates away. (We deliberately don't email
// the raw token; partner ops gets it copy-pasted in-session.)
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

  // Raw token surfaced once via search param so the admin can copy
  // it. The hash is what's persisted; the raw value lives in the URL
  // for ~one navigation and then is gone.
  redirect(
    `/${locale}/desk/api-keys?created=` +
      encodeURIComponent(created.id) +
      `&token=` +
      encodeURIComponent(token),
  );
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
