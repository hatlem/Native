import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

export type ApiKeyScope = "catalog:read" | "pricing:admin";

export function parseScopes(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function hasScope(raw: string, scope: ApiKeyScope): boolean {
  return parseScopes(raw).includes(scope);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function authenticateApiKey(
  rawToken: string,
): Promise<{ id: string; scopes: string; createdBy: string } | null> {
  if (!rawToken) return null;
  const key = await prisma.apiKey.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { id: true, scopes: true, createdBy: true, revokedAt: true, expiresAt: true },
  });
  if (!key) return null;
  if (key.revokedAt) return null;
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) return null;
  // Best-effort last-used bump (don't await; don't fail on race)
  prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return { id: key.id, scopes: key.scopes, createdBy: key.createdBy };
}
