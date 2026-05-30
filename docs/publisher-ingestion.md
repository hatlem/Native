# Publisher programmatic ingestion

Publishers (or their sales houses) can push inventory into NativeSpin over
an HTTP API instead of the manual publisher portal. It upserts the same
fields the portal exposes — titles, products, prices, specs, availability —
idempotently.

## Auth & isolation

- Auth is a Bearer API key with the **`catalog:write`** scope, **bound to a
  single publisher** (`ApiKey.publisherId`). A key can only ever read or
  write that publisher's inventory — the publisher is taken from the key,
  never from the request body. There is no cross-publisher access.
- Issue a key (super-admin / ops):
  ```bash
  pnpm tsx scripts/issue-publisher-key.ts "<publisher name or id>" "Schibsted ingestion"
  ```
  The raw token is printed once; only its SHA-256 hash is stored.

## Curation gate

A **brand-new** title is created `active = false` and stays out of the
public catalog until a NativeSpin super-admin activates it (Titles &
magazines review). Updates to existing titles never flip `active` — only
the desk does. So ingestion can't push live inventory unreviewed.

## Idempotency

- Titles upsert on `(publisherId, title.externalRef)`.
- Products upsert on `(titleId, externalRef)`.
- Specs upsert on the product; availability on `(product, year, month)`.

Re-sending the same payload is safe — it updates in place. `externalRef`
values are your own identifiers; keep them stable.

## Endpoints

### `PUT /api/v1/publisher/products`

Batch upsert (1–200 products). Validated with Zod; unknown fields are
rejected (422 with `error.details`).

```bash
curl -X PUT https://nativespin.com/api/v1/publisher/products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "products": [
      {
        "externalRef": "sku-aften-native-1",
        "type": "NATIVE_ARTICLE",
        "name": "Sponsored feature",
        "basePrice": 25000,
        "currency": "NOK",
        "leadTimeDays": 10,
        "title": {
          "externalRef": "aftenposten",
          "name": "Aftenposten",
          "marketCode": "NO",
          "category": "general-news",
          "websiteUrl": "https://www.aftenposten.no"
        },
        "spec": { "wordCountMin": 500, "wordCountMax": 900, "disclosureLabel": "Annonsørinnhold" },
        "availability": [ { "year": 2026, "month": 7, "blocked": false } ]
      }
    ]
  }'
```

Response:

```json
{
  "titles_created": 1,
  "titles_updated": 0,
  "products_created": 1,
  "products_updated": 0,
  "results": [
    { "external_ref": "sku-aften-native-1", "title_id": "clx…", "product_id": "cly…" }
  ]
}
```

Notes:
- `visibility` defaults to `INDICATIVE` on create, so a freshly ingested
  price never auto-enables self-serve checkout before the desk reviews it.
- A price change on an **already-active** title fires the
  `title.price_changed` partner webhook.

### `GET /api/v1/publisher/products`

Returns the calling publisher's ingested titles and products, including
each title's `active` flag (false = awaiting NativeSpin curation).

## Errors

| Status | code | Meaning |
|---|---|---|
| 400 | `BAD_JSON` | Body is not valid JSON. |
| 401 | `MISSING` / `INVALID` / `EXPIRED` / `REVOKED` | Auth problem. |
| 403 | `SCOPE` | Key lacks `catalog:write`. |
| 403 | `NOT_PUBLISHER_KEY` | Key is not bound to a publisher. |
| 422 | `VALIDATION_FAILED` | Payload invalid; see `error.details[]`. |
| 429 | `RATE_LIMITED` | Too many requests; retry after the stated delay. |

The OpenAPI spec at `/api/openapi.json` (and `/.well-known/openapi.json`)
documents the full request/response schema.
