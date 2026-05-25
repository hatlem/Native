// Request-time API-key authentication for /api/v1/*. Lives separate
// from src/lib/api-key.ts (pure helpers) so DB access stays out of
// anything the test suite would want to import.

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  extractApiToken,
  hashApiToken,
  hasScope,
  parseScopes,
} from "@/lib/api-key";

export type AuthOk = {
  ok: true;
  keyId: string;
  organizationId: string | null;
  scopes: Set<string>;
};
export type AuthErr = {
  ok: false;
  // What to return as the HTTP status + JSON body.
  status: 401 | 403;
  reason: "missing" | "invalid" | "expired" | "revoked" | "scope";
};

// Validate the Authorization header, return either a structured ok
// payload (with scopes preloaded for cheap checks downstream) or a
// structured error with the right HTTP status. Updates lastUsedAt
// asynchronously — we don't block the response on the write because
// best-effort observability shouldn't slow down a read API.
export async function authenticateRequest(
  req: NextRequest,
  requiredScope: string,
): Promise<AuthOk | AuthErr> {
  const raw = extractApiToken(req.headers.get("authorization"));
  if (!raw) {
    return { ok: false, status: 401, reason: "missing" };
  }
  const tokenHash = hashApiToken(raw);
  const key = await prisma.apiKey.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      organizationId: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  if (!key) {
    return { ok: false, status: 401, reason: "invalid" };
  }
  if (key.revokedAt) {
    return { ok: false, status: 401, reason: "revoked" };
  }
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
    return { ok: false, status: 401, reason: "expired" };
  }
  const scopes = parseScopes(key.scopes);
  if (!hasScope(scopes, requiredScope)) {
    return { ok: false, status: 403, reason: "scope" };
  }

  // Best-effort lastUsedAt — don't await; if it errors, the request
  // still succeeds because the key really is valid right now.
  prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch((err) => {
      console.error("api_key.lastUsedAt_failed", { keyId: key.id, err });
    });

  return {
    ok: true,
    keyId: key.id,
    organizationId: key.organizationId,
    scopes,
  };
}
