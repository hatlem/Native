// Pure query-string contract for GET /api/v1/catalog/titles. No DB, so the
// route stays thin and every rule here is unit-testable.
//
// Invalid input is a 400 BAD_PARAM with per-parameter details — never a
// silent fallback. Two regressions this closes: `?limit=abc` reached Prisma
// as `take: NaN` (HTTP 500, empty body), and `?market=XX` / `?format=BOGUS`
// were quietly dropped, so a partner filtering on a typo synced the WHOLE
// unfiltered catalog believing it was one market.
//
// Cursor: an opaque keyset token over the listing's sort key (name, id).
// Keyset rather than Prisma's `cursor: { id }` because the latter needs the
// cursor row to still match the filter: a title deactivated mid-sync (the
// exact case the stable sort exists for) made the next page come back empty
// with hasMore:false — i.e. "sync complete" — and so did any garbage cursor.

import { z } from "zod";
import { MarketCode, ProductType } from "@prisma/client";

export const CATALOG_MAX_LIMIT = 100;
export const CATALOG_DEFAULT_LIMIT = 50;

const MARKET_CODES = Object.values(MarketCode) as [MarketCode, ...MarketCode[]];
const PRODUCT_TYPES = Object.values(ProductType) as [ProductType, ...ProductType[]];

export type CatalogCursor =
  // Minted by this API: resume strictly after (name, id).
  | { kind: "keyset"; name: string; id: string }
  // A bare Title.id from before the keyset token (a sync that straddled the
  // deploy). The route resolves its name; an unknown id is a 400.
  | { kind: "legacy"; id: string };

export type CatalogQuery = {
  market: MarketCode | undefined;
  format: ProductType | undefined;
  limit: number;
  cursor: CatalogCursor | null;
};

export type ParamError = { param: string; message: string };

export type CatalogQueryResult =
  | { ok: true; query: CatalogQuery }
  | { ok: false; errors: ParamError[] };

// cuid()/cuid2-shaped ids: lowercase alphanumerics. Anything else can't be a
// Title.id, so a legacy cursor outside this shape is rejected up front.
const LEGACY_ID_RE = /^[a-z0-9]{20,40}$/;

export function encodeCatalogCursor(name: string, id: string): string {
  return Buffer.from(JSON.stringify([name, id]), "utf8").toString("base64url");
}

export function decodeCatalogCursor(raw: string): CatalogCursor | null {
  if (LEGACY_ID_RE.test(raw)) return { kind: "legacy", id: raw };
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string" &&
      parsed[1].length > 0
    ) {
      return { kind: "keyset", name: parsed[0], id: parsed[1] };
    }
  } catch {
    // Not base64url JSON — fall through to "invalid".
  }
  return null;
}

const schema = z.object({
  market: z
    .enum(MARKET_CODES, { error: `must be one of ${MARKET_CODES.join(", ")}` })
    .optional(),
  format: z
    .enum(PRODUCT_TYPES, { error: `must be one of ${PRODUCT_TYPES.join(", ")}` })
    .optional(),
  // A positive whole number. Values above the maximum are clamped (the
  // effective page size is echoed in page.limit), like most paged APIs —
  // but a non-number is an error, never a guess.
  limit: z
    .string()
    .regex(/^\d+$/, { error: `must be a whole number from 1 to ${CATALOG_MAX_LIMIT}` })
    .transform(Number)
    .pipe(z.number().int().min(1, { error: `must be a whole number from 1 to ${CATALOG_MAX_LIMIT}` }))
    .transform((n) => Math.min(n, CATALOG_MAX_LIMIT))
    .optional(),
  cursor: z
    .string()
    .transform((raw, ctx) => {
      const cursor = decodeCatalogCursor(raw);
      if (!cursor) {
        ctx.addIssue({
          code: "custom",
          message: "is not a pagination token from this API — pass page.nextCursor back unchanged",
        });
        return z.NEVER;
      }
      return cursor;
    })
    .optional(),
});

const KNOWN_PARAMS = ["market", "format", "limit", "cursor"] as const;

export function parseCatalogQuery(params: URLSearchParams): CatalogQueryResult {
  const errors: ParamError[] = [];
  const raw: Record<string, string> = {};
  for (const name of KNOWN_PARAMS) {
    const values = params.getAll(name);
    // `?market=NO&market=SE` used to filter on NO alone. A filter is one
    // value; say so rather than pick one.
    if (values.length > 1) errors.push({ param: name, message: "may only be given once" });
    else if (values.length === 1) raw[name] = values[0];
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push({ param: String(issue.path[0] ?? ""), message: issue.message });
    }
  }
  if (errors.length > 0 || !result.success) return { ok: false, errors };

  return {
    ok: true,
    query: {
      market: result.data.market,
      format: result.data.format,
      limit: result.data.limit ?? CATALOG_DEFAULT_LIMIT,
      cursor: result.data.cursor ?? null,
    },
  };
}

// "limit: must be …; market: must be …" — the human-readable 400 message.
export function describeParamErrors(errors: ParamError[]): string {
  return errors.map((e) => `${e.param}: ${e.message}`).join("; ");
}
