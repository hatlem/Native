// API key issuance + verification for /api/v1/* (Tobias's GroupM
// integration gap from the scenario coverage matrix).
//
// Token format: "atn_<48 url-safe chars>".
//   - The `atn_` prefix lets us spot leaked tokens in logs / git
//     history / GitHub secret scanning without false positives.
//   - 48 url-safe chars = ~288 bits of entropy; well above any
//     guessing-attack concern.
//
// Storage: the *raw* token is shown to the creator at issuance only.
// What lands in the DB is `tokenHash` (sha-256 hex) so a DB leak does
// not hand an attacker working keys.

import { createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "atn_";
const TOKEN_BYTES = 36; // 36 bytes → 48 url-safe base64 chars

export function generateApiToken(): string {
  const raw = randomBytes(TOKEN_BYTES)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return TOKEN_PREFIX + raw;
}

// Stable hash for DB lookup. We use plain sha-256 (not bcrypt) because
// the entropy in the token itself (288 bits) already makes brute force
// implausible — bcrypt's slowness exists to compensate for low-entropy
// human passwords and is wasted here.
export function hashApiToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// What the Authorization header should look like:
//   Authorization: Bearer atn_<token>
// We accept just the raw token too (some HTTP clients omit the
// "Bearer " prefix), but Bearer is the documented form.
export function extractApiToken(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed) return null;
  // "Bearer" with nothing after — including trailing whitespace
  // that gets removed by the outer trim — is not a token.
  if (/^bearer$/i.test(trimmed)) return null;
  // Standard "Bearer <token>" form — split on the first run of spaces.
  const match = trimmed.match(/^bearer\s+(\S+)\s*$/i);
  if (match) return match[1];
  // Bare token (some HTTP clients omit Bearer). Reject anything with
  // internal whitespace — that's not a single token.
  if (/\s/.test(trimmed)) return null;
  return trimmed;
}

export function looksLikeApiToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX) && value.length > TOKEN_PREFIX.length + 20;
}

// Parse the comma-separated scopes column into a Set for O(1) checks.
export function parseScopes(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function hasScope(scopes: Set<string>, required: string): boolean {
  if (scopes.has(required)) return true;
  // Wildcard support: "catalog:*" grants "catalog:read", "catalog:write", etc.
  const [head] = required.split(":");
  return scopes.has(`${head}:*`) || scopes.has("*");
}

// ---------- Issuance rules (desk /desk/api-keys → createApiKey) ----------

// The scopes the issuance form offers, each matching an endpoint family:
//   catalog:read  — GET /api/v1/catalog/*, /api/v1/quotes/{id}
//   catalog:write — PUT/GET /api/v1/publisher/products (ingestion)
//   orders:write  — POST /api/v1/orders
//   pricing:admin — the internal MCP server (/api/mcp)
export const ISSUABLE_SCOPES = ["catalog:read", "catalog:write", "orders:write", "pricing:admin"] as const;

// Also accepted at issuance: the catalog wildcard older keys were minted
// with. Anything else ("admin:*", a typo'd "catlog:read") is refused so it
// can't silently land in the DB and 403 at the partner's first request.
const VALID_SCOPES: ReadonlySet<string> = new Set<string>([...ISSUABLE_SCOPES, "catalog:*"]);

// Who a key acts for. Exactly one — never both an organization and a
// publisher, which is why this is one union and not two nullable ids.
export type KeyBinding =
  | { kind: "platform" }
  | { kind: "organization"; id: string }
  | { kind: "publisher"; id: string };

// The form posts one "binding" select value: "" (platform), "org:<id>" or
// "pub:<id>". Null for anything else.
export function parseKeyBinding(raw: string): KeyBinding | null {
  if (raw === "") return { kind: "platform" };
  const [kind, id] = [raw.slice(0, 4), raw.slice(4)];
  if (!id) return null;
  if (kind === "org:") return { kind: "organization", id };
  if (kind === "pub:") return { kind: "publisher", id };
  return null;
}

export type KeyGrantError =
  | "scopes"
  | "internal_only_scope"
  | "org_required_scope"
  | "publisher_required_scope";

// Every scope must be usable by the binding it's issued with — otherwise
// the key is minted fine and dead-ends at runtime:
//   pricing:admin → platform only (global pricing mutation, no tenant scoping)
//   orders:write  → an organization (POST /orders answers NO_ORG otherwise)
//   catalog:write → a publisher (ingestion answers NOT_PUBLISHER_KEY otherwise;
//                   the publisher comes from the key, never the body)
export function validateKeyGrant(scopes: Set<string>, binding: KeyBinding): KeyGrantError | null {
  if (scopes.size === 0) return "scopes";
  for (const s of scopes) if (!VALID_SCOPES.has(s)) return "scopes";
  if (scopes.has("pricing:admin") && binding.kind !== "platform") return "internal_only_scope";
  if (scopes.has("orders:write") && binding.kind !== "organization") return "org_required_scope";
  if (scopes.has("catalog:write") && binding.kind !== "publisher") return "publisher_required_scope";
  return null;
}
