// Public OpenAPI 3.1 spec for the NativeSpin partner-program API.
// Hand-written rather than auto-generated so the contract is auditable
// and stable across runtime changes — partners depend on this shape.
// Tobias scenario follow-up (the lowest-effort highest-impact gap his
// evaluation flagged: even an auto-generated spec lets engineering
// scope an integration ahead of the partnership contract).
//
// Served at /api/openapi.json (src/app/api/openapi.json/route.ts) AND
// mirrored from /.well-known/openapi.json via a rewrite in next.config so
// generic API discovery tools find it.
//
// Lives in lib (not the route file) so tests can import it: the spec is
// pinned to the live handlers by openapi-conformance.ts —
// contract.it.test.ts validates real responses against these schemas,
// including that every field a response carries is documented here.

import { MarketCode, PricingModel, ProductType, QuoteStatus } from "@prisma/client";

export const OPENAPI_SPEC = {
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
      // The detail endpoint's title: the list shape plus the publisher's
      // country, the market VAT rate and each product's content spec.
      TitleDetail: {
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
              countryCode: { type: "string", description: "The publisher's country code, e.g. NO." },
            },
          },
          market: {
            type: "object",
            properties: {
              code: { type: "string", enum: Object.values(MarketCode) },
              currency: { type: "string" },
              disclosureLabel: { type: "string", nullable: true },
              vatRatePct: { type: "number", description: "Standard VAT rate in the market, e.g. 25." },
            },
          },
          pricesVisible: { type: "boolean" },
          products: {
            type: "array",
            items: { $ref: "#/components/schemas/ProductDetail" },
          },
        },
      },
      ProductDetail: {
        type: "object",
        required: ["id", "type", "visibility"],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: Object.values(ProductType) },
          pricingModel: { type: "string", enum: Object.values(PricingModel) },
          priceBand: { type: "string", nullable: true },
          currency: { type: "string", nullable: true },
          visibility: { type: "string", enum: ["INDICATIVE", "FIRM"] },
          leadTimeDays: { type: "integer", nullable: true },
          spec: {
            type: "object",
            nullable: true,
            description: "Content requirements for the placement, when the publisher states them.",
            properties: {
              wordCountMin: { type: "integer", nullable: true },
              wordCountMax: { type: "integer", nullable: true },
              imagesMin: { type: "integer", nullable: true },
              disclosureLabel: { type: "string", nullable: true },
              fileFormats: { type: "string", nullable: true },
              requirements: { type: "string", nullable: true },
            },
          },
        },
      },
      TitlePage: {
        type: "object",
        required: ["data", "page"],
        properties: {
          data: { type: "array", items: { $ref: "#/components/schemas/Title" } },
          page: {
            type: "object",
            required: ["limit", "hasMore", "nextCursor"],
            properties: {
              limit: { type: "integer", description: "The effective page size (after clamping)." },
              hasMore: { type: "boolean" },
              nextCursor: {
                type: "string",
                nullable: true,
                description:
                  "Pass back unchanged as `cursor` for the next page. Null on the last page — only then is a sync complete.",
              },
            },
          },
        },
      },
      TitleResponse: {
        type: "object",
        required: ["data"],
        properties: { data: { $ref: "#/components/schemas/TitleDetail" } },
      },
      Quote: {
        type: "object",
        description:
          "A quote the desk has sent (drafts are never visible). Money fields are decimal strings in `currency`, excluding VAT unless named `total`. A sent quote never changes: to change it the desk sends a new revision, and this one becomes SUPERSEDED (no longer acceptable) with `superseded_by_quote_id` naming the quote that counts now.",
        required: ["id", "request_id", "status", "currency", "subtotal", "vat_pct", "total", "revision", "lines"],
        properties: {
          id: { type: "string" },
          request_id: { type: "string" },
          status: {
            type: "string",
            enum: Object.values(QuoteStatus).filter((s) => s !== "DRAFT"),
          },
          currency: { type: "string" },
          subtotal: { type: "string" },
          vat_pct: { type: "string" },
          total: { type: "string" },
          valid_until: { type: "string", format: "date-time", nullable: true },
          revision: {
            type: "integer",
            minimum: 1,
            description: "1 for the first quote; each sent revision counts up.",
          },
          supersedes_quote_id: {
            type: "string",
            nullable: true,
            description: "The earlier quote this revision replaced. Null on a first quote.",
          },
          superseded_by_quote_id: {
            type: "string",
            nullable: true,
            description: "Set once status is SUPERSEDED: the revision that replaced this quote.",
          },
          superseded_at: { type: "string", format: "date-time", nullable: true },
          notes: { type: "string", nullable: true },
          lines: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "quantity", "line_total"],
              properties: {
                id: { type: "string" },
                product_id: {
                  type: "string",
                  nullable: true,
                  description: "Null for non-inventory lines such as content production.",
                },
                description: { type: "string" },
                quantity: { type: "integer" },
                line_total: { type: "string" },
              },
            },
          },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      IngestSummary: {
        type: "object",
        required: ["titles_created", "titles_updated", "products_created", "products_updated", "skipped", "results"],
        properties: {
          titles_created: { type: "integer" },
          titles_updated: { type: "integer" },
          products_created: { type: "integer" },
          products_updated: { type: "integer" },
          skipped: {
            type: "array",
            items: {
              type: "object",
              properties: { external_ref: { type: "string" }, reason: { type: "string" } },
            },
          },
          results: {
            type: "array",
            items: {
              type: "object",
              properties: {
                external_ref: { type: "string" },
                title_id: { type: "string" },
                product_id: { type: "string" },
              },
            },
          },
        },
      },
      PublisherInventory: {
        type: "object",
        required: ["titles"],
        properties: {
          titles: {
            type: "array",
            items: {
              type: "object",
              properties: {
                external_ref: { type: "string" },
                name: { type: "string" },
                active: { type: "boolean", description: "False while awaiting NativeSpin curation." },
                market: { type: "string", description: "The title's market code, e.g. NO." },
                category: { type: "string" },
                products: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      external_ref: { type: "string" },
                      type: { type: "string", enum: Object.values(ProductType) },
                      name: { type: "string" },
                      base_price: { type: "number", description: "Your rate-card cost, as ingested." },
                      currency: { type: "string" },
                      visibility: { type: "string", enum: ["INDICATIVE", "FIRM"] },
                      bookable: { type: "boolean" },
                      lead_time_days: { type: "integer", nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      Product: {
        type: "object",
        required: ["id", "type", "visibility"],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: Object.values(ProductType) },
          pricingModel: {
            type: "string",
            enum: Object.values(PricingModel),
            description:
              "FLAT = priced per placement (priceBand applies); CPM/CPC = volume-priced rate card (priceBand is null — the quote resolves the volume).",
          },
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
                basePrice: {
                  type: "number",
                  description:
                    "Publisher rate-card cost. Sets a NEW product's opening price (unconfirmed until the desk confirms it). For an existing product it is desk-owned: send the stored value (see GET) or update it on the portal's Rates page; a different value is refused with DESK_OWNED_FIELD.",
                },
                currency: { type: "string", description: "ISO 4217, 3 letters." },
                leadTimeDays: { type: "integer", nullable: true },
                visibility: {
                  type: "string",
                  enum: ["INDICATIVE", "FIRM"],
                  description:
                    "Desk-owned (FIRM makes a product instantly orderable). Optional; if sent it must equal the stored value, or INDICATIVE for a new product. Anything else is refused with DESK_OWNED_FIELD.",
                },
                bookable: {
                  type: "boolean",
                  description:
                    "Desk-owned. Optional; if sent it must equal the stored value, or true for a new product. Anything else is refused with DESK_OWNED_FIELD.",
                },
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
                  "BAD_PARAM",
                  "NOT_FOUND",
                  "NOT_PUBLISHER_KEY",
                  "VALIDATION_FAILED",
                  "DESK_OWNED_FIELD",
                  "INGEST_FAILED",
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
              details: {
                type: "array",
                description:
                  "Present on BAD_PARAM (one entry per invalid query parameter: `param`, `message`), VALIDATION_FAILED (one per invalid field: `path`, `message`) and DESK_OWNED_FIELD (one per refused field: `path`, `field`, `message`).",
                items: {
                  type: "object",
                  properties: {
                    param: { type: "string" },
                    path: { type: "string" },
                    field: {
                      type: "string",
                      enum: ["basePrice", "visibility", "bookable"],
                      description: "DESK_OWNED_FIELD only: the desk-owned field the payload would change.",
                    },
                    message: { type: "string" },
                  },
                },
              },
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
          "Cursor-paginated. Stable sort by name + id ascending so a full sync doesn't miss rows when a title is activated or deactivated mid-sync. Follow `page.nextCursor` until it is null. Invalid query parameters are rejected with 400 BAD_PARAM (never silently ignored). Rate-limited per API key.",
        parameters: [
          {
            name: "market",
            in: "query",
            schema: { type: "string", enum: Object.values(MarketCode) },
            description: "Filter by market. Case-sensitive; any other value is a 400.",
          },
          {
            name: "format",
            in: "query",
            schema: { type: "string", enum: Object.values(ProductType) },
            description:
              "Only return titles with at least one active product of this type. Any other value is a 400.",
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, default: 50 },
            description:
              "Page size: a positive whole number. Values above 100 are clamped to 100; the effective size is echoed in `page.limit`.",
          },
          {
            name: "cursor",
            in: "query",
            schema: { type: "string" },
            description:
              "Opaque pagination token: `page.nextCursor` from the previous response, passed back unchanged. A token this API did not issue is a 400.",
          },
        ],
        responses: {
          "200": {
            description: "A page of titles.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TitlePage" },
              },
            },
          },
          "400": {
            description: "A query parameter is invalid (BAD_PARAM); `error.details` names each one.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
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
        description: "Requires the catalog:read scope. The title is wrapped in `data`.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "The title id (not its slug).",
          },
        ],
        responses: {
          "200": {
            description: "The title.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TitleResponse" },
              },
            },
          },
          "401": {
            description: "Missing / invalid / revoked / expired bearer.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "403": {
            description: "Key lacks catalog:read scope.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "404": {
            description: "Not found, or not active in the catalog.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
          "429": {
            description: "Rate-limited — back off + retry.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/v1/quotes/{id}": {
      get: {
        summary: "Get one sent quote by id.",
        description:
          "Requires the catalog:read scope. A key bound to an organization sees only that organization's quotes; any other quote (and any unsent draft) is a 404. Exact figures appear here because a quote is the one place they belong — the catalog endpoints only ever return bands.",
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
            description: "The quote.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Quote" } } },
          },
          "401": {
            description: "Missing / invalid / revoked / expired bearer.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "403": {
            description: "Key lacks catalog:read scope.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "404": {
            description: "Not found, not sent yet, or not visible to this key.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "429": {
            description: "Rate-limited — back off + retry.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/v1/publisher/products": {
      put: {
        summary:
          "Upsert the calling publisher's inventory (titles/products/specs/availability/lead times, and a new product's opening price). Idempotent on externalRef. Requires a catalog:write key bound to a publisher. New titles land inactive until NativeSpin activates them. Price (once a product exists), visibility and bookable are managed by the NativeSpin desk: a payload that would change one is refused with 422 DESK_OWNED_FIELD and nothing is written; sending the stored value back unchanged is accepted.",
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
          "200": {
            description: "Upsert summary with per-item ids.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/IngestSummary" } } },
          },
          "400": {
            description: "Body is not valid JSON (BAD_JSON).",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "401": {
            description: "Auth failed.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "403": {
            description: "Key lacks catalog:write (SCOPE) or is not bound to a publisher (NOT_PUBLISHER_KEY).",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "422": {
            description:
              "Payload failed validation (VALIDATION_FAILED), or would change a desk-owned field (DESK_OWNED_FIELD: basePrice of an existing product, visibility, bookable). error.message names the fields; error.details lists each as { path, field, message }. Nothing was written.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "429": {
            description: "Rate-limited — back off + retry.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "500": {
            description:
              "The upsert failed part-way (INGEST_FAILED). Upserts are idempotent on externalRef, so retrying the same payload is safe.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
      get: {
        summary: "Read back the calling publisher's ingested inventory.",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "The publisher's ingested titles and products.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/PublisherInventory" } } },
          },
          "401": {
            description: "Auth failed.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "403": {
            description: "Key lacks catalog:write (SCOPE) or is not bound to a publisher (NOT_PUBLISHER_KEY).",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "429": {
            description: "Rate-limited — back off + retry.",
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
