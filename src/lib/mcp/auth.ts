import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

export type ApiKeyScope =
  | "catalog:read"
  | "pricing:admin"
  | "pricing:read"
  | "pricing:draft"
  | "pricing:apply";

export function parseScopes(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function hasScope(raw: string, scope: ApiKeyScope): boolean {
  return parseScopes(raw).includes(scope);
}

// What a key may do on the MCP surface. One all-powerful grant was too
// much for an agent that reads publisher replies and web pages: an injected
// instruction could change live prices or send email. The tiers:
//   pricing:read  — read tools only
//   pricing:draft — read + record things for a human to review (contacts,
//                   quote drafts, contact logs, unsent price requests)
//   pricing:apply — draft + what takes effect outside the desk: applying a
//                   quote to live prices, activating products, sending email
//   pricing:admin — everything (the original scope; existing keys keep it)
export type McpGrants = { read: boolean; draft: boolean; apply: boolean };

export function mcpGrants(raw: string): McpGrants {
  const scopes = new Set(parseScopes(raw));
  const admin = scopes.has("pricing:admin");
  const apply = admin || scopes.has("pricing:apply");
  const draft = apply || scopes.has("pricing:draft");
  const read = draft || scopes.has("pricing:read");
  return { read, draft, apply };
}

const SECRET_KEY_RE = /token|secret|password|passwd|api[-_]?key|authorization/i;
const MAX_LOGGED_STRING = 300;

// Tool arguments as they go into the audit log: enough to see what the
// agent did, with anything secret-looking removed and long text cut.
export function redactToolArgs(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.length > MAX_LOGGED_STRING ? `${value.slice(0, MAX_LOGGED_STRING)}…` : value;
  }
  if (depth >= 4) return "[…]";
  if (Array.isArray(value)) {
    const head = value.slice(0, 50).map((v) => redactToolArgs(v, depth + 1));
    return value.length > 50 ? [...head, `[+${value.length - 50} more]`] : head;
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEY_RE.test(k) ? "[redacted]" : redactToolArgs(v, depth + 1),
      ]),
    );
  }
  return String(value);
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
