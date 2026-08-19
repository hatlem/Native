// Public OpenAPI 3.1 spec for the NativeSpin partner-program API.
// Hand-written rather than auto-generated so the contract is auditable
// and stable across runtime changes — partners depend on this shape.
// Tobias scenario follow-up (the lowest-effort highest-impact gap his
// evaluation flagged: even an auto-generated spec lets engineering
// scope an integration ahead of the partnership contract).
//
// Lives at /api/openapi.json AND mirrored from /.well-known/openapi.json
// via a rewrite in next.config so generic API discovery tools find it.

import { NextResponse } from "next/server";
import { MarketCode, ProductType } from "@prisma/client";

export const dynamic = "force-static";
export const revalidate = 3600; // re-render hourly; spec is rarely-changing.

const SPEC = {
  openapi: "3.1.0",
  info: {
    title: "NativeSpin Catalog API",
    version: "1.0.0",
    description:
      "Read API over the NativeSpin title catalog — designed for agency planning tools and adtech partners that need normalised supply data for editorial native across our 9 markets (NO, SE, DK, FI, DE, AT, CH, UK, IE). Bearer-auth gated; keys are issued by NativeSpin to integration partners via partners@nativespin.com.",
    contact: {
      name: "NativeSpin partners",
      email: "partners@nativespin.com",
      url: "https://nativespin.com/api",
    },
    license: {
      name: "Partner program terms (see partnership contract)",
    },
  },
  servers: [{ url: "https://nativespin.com", description: "Production" }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description:
          'Bearer API key. `catalog:read` for the public catalog endpoints; `orders:write` (bound to one organization) for self-serve order placement; `catalog:write` (bound to one publisher) for the ingestion endpoints. Send as `Authorization: Bearer <key>`.',
      },
    },
    schemas: {
      Title: {
        type: "object",
        required: ["id", "slug", "name", "publisher", "market", "products"],
        properties: {
          id: { type: "string" },
          slug: { type: "string" },
          name: { type: "string" },
          category: { type: "string", nullable: true },
          monthlyReach: { type: "integer", nullable: true },
          lastVerifiedAt: { type: "string", format: "date-time", nullable: true },
          publisher: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
            },
          },
          market: {
            type: "object",
            properties: {
              code: { type: "string", enum: Object.values(MarketCode) },
              currency: { type: "string" },
              disclosureLabel: { type: "string", nullable: true },
            },
          },
          pricesVisible: { type: "boolean" },
          products: {
            type: "array",
            items: { $ref: "#/components/schemas/Product" },
          },
        },
      },
      Product: {
        type: "object",
        required: ["id", "type", "visibility"],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: Object.values(ProductType) },
          priceBand: {
            type: "string",
            nullable: true,
            description:
              'Indicative all-in price band label (e.g. "25–40k NOK"). Null when pricing is not public for this product.',
          },
          currency: { type: "string", nullable: true },
          visibility: { type: "string", enum: ["INDICATIVE", "FIRM"] },
          leadTimeDays: { type: "integer", nullable: true },
        },
      },
      IngestPayload: {
        type: "object",
        required: ["products"],
        properties: {
          products: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            items: {
              type: "object",
              required: ["externalRef", "type", "name", "basePrice", "currency", "title"],
              properties: {
                externalRef: { type: "string", description: "Your SKU; unique within the title." },
                type: { type: "string", enum: Object.values(ProductType) },
                name: { type: "string" },
                description: { type: "string", nullable: true },
                basePrice: { type: "number", description: "Publisher rate-card cost." },
                currency: { type: "string", description: "ISO 4217, 3 letters." },
                leadTimeDays: { type: "integer", nullable: true },
                visibility: {
                  type: "string",
                  enum: ["INDICATIVE", "FIRM"],
                  description: "Defaults to INDICATIVE on create.",
                },
                bookable: { type: "boolean" },
                title: {
                  type: "object",
                  required: ["externalRef", "name", "marketCode", "category"],
                  properties: {
                    externalRef: { type: "string", description: "Your title id; unique per publisher." },
                    name: { type: "string" },
                    marketCode: { type: "string", enum: Object.values(MarketCode) },
                    category: { type: "string" },
                    websiteUrl: { type: "string", nullable: true },
                    audienceNote: { type: "string", nullable: true },
                  },
                },
                spec: {
                  type: "object",
                  nullable: true,
                  properties: {
                    wordCountMin: { type: "integer", nullable: true },
                    wordCountMax: { type: "integer", nullable: true },
                    imagesMin: { type: "integer", nullable: true },
                    disclosureLabel: { type: "string", nullable: true },
                    fileFormats: { type: "string", nullable: true },
                    requirements: { type: "string", nullable: true },
                  },
                },
                availability: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["year", "month"],
                    properties: {
                      year: { type: "integer" },
                      month: { type: "integer", minimum: 1, maximum: 12 },
                      blocked: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      OrderRequest: {
        type: "object",
        required: ["items"],
        properties: {
          items: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["productId", "quantity"],
              properties: {
                productId: { type: "string" },
                quantity: { type: "integer", minimum: 1 },
              },
            },
          },
          reference: {
            type: "string",
            maxLength: 200,
            description:
              "Optional buyer reference, stored on the order's brief.",
          },
        },
      },
      OrderResponse: {
        type: "object",
        required: ["requestId", "orderIds"],
        properties: {
          requestId: { type: "string" },
          orderIds: { type: "array", items: { type: "string" } },
        },
      },
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: {
                type: "string",
                enum: [
                  "MISSING",
                  "INVALID",
                  "REVOKED",
                  "EXPIRED",
                  "SCOPE",
                  "RATE_LIMITED",
                  "NOT_FOUND",
                  "NO_ORG",
                  "BAD_JSON",
                  "BAD_BODY",
                  "NO_ITEMS",
                  "BAD_ITEM",
                  "BAD_QUANTITY",
                  "UNKNOWN_PRODUCT",
                  "RFQ_ONLY",
                  "PRODUCT_UNAVAILABLE",
                  "BAD_IDEMPOTENCY_KEY",
                  "IDEMPOTENCY_IN_PROGRESS",
                  "IDEMPOTENCY_KEY_REUSE",
                  "METHOD_NOT_ALLOWED",
                ],
              },
              message: { type: "string" },
            },
            required: ["code", "message"],
          },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/api/v1/catalog/titles": {
      get: {
        summary: "List titles in the public catalog",
        description:
          "Cursor-paginated. Stable sort by name + id ascending so a full sync doesn't miss rows when a new title is activated mid-sync. Rate-limited per API key.",
        parameters: [
          {
            name: "market",
            in: "query",
            schema: { type: "string", enum: Object.values(MarketCode) },
            description: "Filter by market.",
          },
          {
            name: "format",
            in: "query",
            schema: { type: "string", enum: Object.values(ProductType) },
            description:
              "Only return titles with at least one active product of this type.",
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
          {
            name: "cursor",
            in: "query",
            schema: { type: "string" },
            description:
              "Opaque pagination token returned in the previous response.",
          },
        ],
        responses: {
          "200": {
            description: "Page of titles + nextCursor.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Title" },
                    },
                    nextCursor: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
          "401": {
            description: "Missing / invalid / revoked / expired bearer.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
          "403": {
            description: "Key lacks catalog:read scope.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
          "429": {
            description: "Rate-limited — back off + retry.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/v1/catalog/titles/{id}": {
      get: {
        summary: "Get one title by id.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "The title.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Title" },
              },
            },
          },
          "404": {
            description: "Not found.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/v1/publisher/products": {
      put: {
        summary:
          "Upsert the calling publisher's inventory (titles/products/prices/specs/availability). Idempotent on externalRef. Requires a catalog:write key bound to a publisher. New titles land inactive until NativeSpin activates them.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/IngestPayload" },
            },
          },
        },
        responses: {
          "200": { description: "Upsert summary with per-item ids." },
          "401": {
            description: "Auth failed.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "403": {
            description: "Key lacks catalog:write or is not bound to a publisher.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "422": {
            description: "Payload failed validation (see error.details).",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
      get: {
        summary: "Read back the calling publisher's ingested inventory.",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "The publisher's ingested titles and products." },
          "401": {
            description: "Auth failed.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "403": {
            description: "Key lacks catalog:write or is not bound to a publisher.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/v1/orders": {
      post: {
        summary: "Place a firm-priced, self-serve order",
        description:
          "Books firm-priced placements on named premium titles in one call. RFQ-only inventory is rejected (422 RFQ_ONLY) — those titles stay desk-mediated. Requires the orders:write scope and a key bound to a buying organization. Supports idempotent retries via the optional Idempotency-Key header: send a unique key per logical order and retry with the same key AND byte-identical body — the stored response is replayed (marked with an `Idempotency-Replayed: true` response header) instead of placing a second order.",
        operationId: "createOrder",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: false,
            schema: {
              type: "string",
              minLength: 1,
              maxLength: 255,
              pattern: "^[!-~]{1,255}$",
            },
            description:
              "Optional client-minted key (e.g. a UUID v4) that makes this request safe to retry: any later request with the same key and a byte-identical body replays the first attempt's stored response — success or failure — instead of executing again, so a network-retried order is never double-charged. Reusing a key with a DIFFERENT body fails with 422 IDEMPOTENCY_KEY_REUSE; retrying while the first attempt is still executing returns 409 IDEMPOTENCY_IN_PROGRESS (back off and retry). Scoped per API key. 1-255 visible ASCII characters.",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/OrderRequest" },
            },
          },
        },
        responses: {
          "201": {
            description:
              "Order(s) created and confirmed — or, on an idempotent retry, the stored first response replayed with the `Idempotency-Replayed: true` header.",
            headers: {
              "Idempotency-Replayed": {
                schema: { type: "string", enum: ["true"] },
                description:
                  "Present (\"true\") only when this response was replayed from an earlier request with the same Idempotency-Key — no new order was placed.",
              },
            },
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OrderResponse" },
              },
            },
          },
          "400": {
            description:
              "Body is not valid JSON (BAD_JSON), or the Idempotency-Key header is malformed (BAD_IDEMPOTENCY_KEY).",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "401": {
            description: "Missing / invalid bearer.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "403": {
            description: "Key lacks orders:write, or is not bound to an organization.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "409": {
            description:
              "A selected product became unavailable before confirmation (PRODUCT_UNAVAILABLE) — re-check the catalog; or the first request with this Idempotency-Key is still executing (IDEMPOTENCY_IN_PROGRESS) — back off and retry with the SAME key.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "422": {
            description:
              "Invalid order, unknown product, RFQ-only product (RFQ_ONLY) — submit those via the desk — or an Idempotency-Key reused with a different body (IDEMPOTENCY_KEY_REUSE).",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "429": {
            description: "Rate-limited — back off + retry.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
  },
} as const;

export async function GET() {
  return NextResponse.json(SPEC, {
    headers: {
      // Spec is public — let CDNs cache it.
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
