// Pure validation for the publisher ingestion API (PUT /api/v1/publisher/
// products). Defines the wire contract with Zod and a parse helper that
// returns either typed data or a flat list of field errors. No DB access
// so it can be unit-tested in isolation; the route performs the upsert.

import { z } from "zod";

const MARKET_CODES = [
  "NO",
  "SE",
  "DK",
  "FI",
  "DE",
  "AT",
  "CH",
  "UK",
  "IE",
] as const;

const PRODUCT_TYPES = [
  "NATIVE_ARTICLE",
  "ADVERTORIAL",
  "NATIVE_DISPLAY",
  "PACKAGE",
  "CONTEXTUAL",
  "OTHER",
] as const;

const ref = z.string().trim().min(1).max(120);

export const IngestSpecSchema = z
  .object({
    wordCountMin: z.number().int().positive().nullish(),
    wordCountMax: z.number().int().positive().nullish(),
    imagesMin: z.number().int().min(0).max(50).nullish(),
    disclosureLabel: z.string().trim().max(120).nullish(),
    fileFormats: z.string().trim().max(200).nullish(),
    requirements: z.string().trim().max(2000).nullish(),
  })
  .strict();

export const IngestAvailabilitySchema = z
  .object({
    year: z.number().int().min(2000).max(2100),
    month: z.number().int().min(1).max(12),
    blocked: z.boolean().default(false),
  })
  .strict();

export const IngestTitleSchema = z
  .object({
    externalRef: ref,
    name: z.string().trim().min(1).max(200),
    marketCode: z.enum(MARKET_CODES),
    category: z.string().trim().min(1).max(80),
    websiteUrl: z.string().url().max(500).nullish(),
    audienceNote: z.string().trim().max(500).nullish(),
  })
  .strict();

export const IngestProductSchema = z
  .object({
    externalRef: ref,
    type: z.enum(PRODUCT_TYPES),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).nullish(),
    basePrice: z.number().nonnegative().max(1_000_000_000),
    currency: z.string().trim().length(3),
    leadTimeDays: z.number().int().positive().max(365).optional(),
    // Desk-owned (see deskOwnedFieldChanges): accepted only when equal to
    // the stored value, or to the new-product default (INDICATIVE / bookable)
    // — so a fresh price never auto-enables self-serve checkout.
    visibility: z.enum(["INDICATIVE", "FIRM"]).optional(),
    bookable: z.boolean().optional(),
    title: IngestTitleSchema,
    spec: IngestSpecSchema.nullish(),
    // Capped so a single request can't fan out into thousands of upserts
    // (24 months of availability is two years ahead — more than enough).
    availability: z.array(IngestAvailabilitySchema).max(24).optional(),
  })
  .strict();

export const IngestPayloadSchema = z
  .object({
    // Batch cap bounds per-request DB work; large catalogs page through
    // multiple calls (the endpoint is idempotent on externalRef).
    products: z.array(IngestProductSchema).min(1).max(100),
  })
  .strict();

export type IngestPayload = z.infer<typeof IngestPayloadSchema>;
export type IngestProduct = z.infer<typeof IngestProductSchema>;

export type IngestParseResult =
  | { ok: true; data: IngestPayload }
  | { ok: false; errors: { path: string; message: string }[] };

// Validate an untrusted JSON body. Returns flat path/message pairs the
// route serializes as 422 — never throws.
export function parseIngestPayload(raw: unknown): IngestParseResult {
  const result = IngestPayloadSchema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const errors = result.error.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
  return { ok: false, errors };
}

// ─── Desk-owned fields ───────────────────────────────────────────────────────
//
// The ingestion API follows the publisher portal's rule. The portal lets a
// publisher set lead times, specs and availability, and change a price only
// through its rates page (provenance stamp + the desk is notified —
// lib/publisher-rates.ts). Catalog status is the desk's: visibility (FIRM means
// instant order), bookable, and the price once a product exists. The API used
// to write all three straight onto the product, so a publisher could make its
// own inventory instantly orderable, or silently move a live price, with no one
// at the desk told. Now a change to any of them is refused (422), naming the
// field, before anything is written; a value equal to what is stored (e.g. a
// GET response sent back unchanged) is accepted as a no-op.

export const DESK_OWNED_FIELDS = ["basePrice", "visibility", "bookable"] as const;
export type DeskOwnedField = (typeof DESK_OWNED_FIELDS)[number];

/** What a brand-new product starts with. Desk-owned from then on. */
export const NEW_PRODUCT_DEFAULTS = { visibility: "INDICATIVE", bookable: true } as const;

export type StoredDeskFields = {
  basePrice: number;
  visibility: "INDICATIVE" | "FIRM";
  bookable: boolean;
};

export type DeskOwnedRefusal = { path: string; field: DeskOwnedField; message: string };

const REFUSAL_MESSAGE: Record<DeskOwnedField, string> = {
  basePrice:
    "basePrice is managed by the NativeSpin desk once a product exists. Send the current value (see GET), or update the rate on the Rates page of the publisher portal, where the desk is notified.",
  visibility:
    "visibility is managed by the NativeSpin desk (FIRM makes a product instantly orderable) and can't be changed through the API.",
  bookable: "bookable is managed by the NativeSpin desk and can't be changed through the API.",
};

/**
 * The desk-owned fields product `index` of a payload would change. `stored`
 * is the existing product (null when the call would create it): an existing
 * product may only repeat its stored values; a new one may set its opening
 * price but only the default visibility and bookable state.
 */
export function deskOwnedFieldChanges(
  product: IngestProduct,
  stored: StoredDeskFields | null,
  index: number,
): DeskOwnedRefusal[] {
  const refusals: DeskOwnedRefusal[] = [];
  const refuse = (field: DeskOwnedField) =>
    refusals.push({ path: `products.${index}.${field}`, field, message: REFUSAL_MESSAGE[field] });

  const visibility = stored?.visibility ?? NEW_PRODUCT_DEFAULTS.visibility;
  const bookable = stored?.bookable ?? NEW_PRODUCT_DEFAULTS.bookable;
  if (stored && product.basePrice !== stored.basePrice) refuse("basePrice");
  if (product.visibility !== undefined && product.visibility !== visibility) refuse("visibility");
  if (product.bookable !== undefined && product.bookable !== bookable) refuse("bookable");
  return refusals;
}

// A slug must be stable and unique per title. We derive it from the
// publisher-scoped externalRef so re-ingesting the same title never
// collides with itself, and prefix to avoid clashing with curated slugs.
export function ingestionSlug(publisherId: string, titleExternalRef: string): string {
  const base = `${publisherId}-${titleExternalRef}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || `t-${publisherId.slice(0, 8)}`;
}
