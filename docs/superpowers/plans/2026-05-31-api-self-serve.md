# API Self-Serve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "buy like programmatic, on named premium titles" true — a real `POST /api/v1/orders` (FIRM-only) reusing the existing self-serve checkout logic, plus honest API/self-serve marketing. No DSP/auction.

**Architecture:** Extract the FIRM Quote+Order creation from the `submitRequest` server action into a shared `createFirmOrder({ organizationId, items })` so the UI and a new API endpoint use one code path (DRY). Add an `orders:write` API-key scope and a key-authenticated `POST /api/v1/orders` that validates a FIRM-only basket and calls the shared function. Surface the catalog-API + self-serve story in marketing. Pure validation is unit-tested; the shared order function is covered by the existing FIRM-checkout behavior staying green.

**Tech Stack:** Next.js route handlers, Prisma, `node:test`, OpenAPI (inline `SPEC` object at `src/app/api/openapi.json/route.ts`), next-intl (six locales).

**Branch:** `feat/optimization-and-api` (same branch as the measurement plan; build that one FIRST so this stacks on it). Spec: `docs/superpowers/specs/2026-05-31-api-self-serve-design.md`.

**Conventions (verified):**
- API auth: `authenticateRequest(req, requiredScope)` from `@/lib/api-auth` → `AuthOk | AuthErr`. Scope helpers in `@/lib/api-key` (`parseScopes`, `hasScope` supports `head:*` and `*`). Error response idiom: `errJson(status, code, message)` returning `NextResponse.json({error:{code,message}}, {status})`.
- Rate limit: reuse `rfqLimiter` with a per-key bucket (`api:orders:<keyId>`).
- FIRM checkout core lives inline in `src/app/actions.ts` `submitRequest` at ~lines 305-409 (the `prisma.$transaction` + `allFirm` block). Helpers: `computeQuoteLines`, `quoteTotals`, `toQuotable` (local in actions.ts), `groupItemsByMarket` (`@/lib/quote-grouping`), `loadContentFeeRules`+`contentFeeLinesForGroup` (`@/lib/content-fee`), `isProductPriceShown` (`@/lib/pricing-visibility`).
- Key issuance: `scripts/issue-publisher-key.ts` sets `scopes` string on `prisma.apiKey.create`.
- Tests `node:test`; `pnpm typecheck`/`build`/`test`.

---

## File Structure
- `src/lib/commerce/firm-order.ts` — extracted `createFirmOrder` + `toQuotable` (moved) + the FIRM transaction; `src/lib/commerce/firm-order.test.ts` only if a pure guard is extracted.
- `src/lib/api/order-request.ts` + `.test.ts` — pure `parseOrderRequest(body)`.
- `src/app/actions.ts` — `submitRequest` FIRM path calls `createFirmOrder`.
- `src/app/api/v1/orders/route.ts` — the endpoint.
- `src/app/api/openapi.json/route.ts` — new path + scope.
- `scripts/issue-buyer-key.ts` — issue an `orders:write` (+`catalog:read`) key to an org.
- `src/messages/{en,no,sv,da,fi,de}.json` — `apiDocs` self-serve section.
- `src/app/[locale]/(marketing)/api/page.tsx` (+ maybe for-agencies) — marketing section.

---

## Task 1: Extract `createFirmOrder` (no behavior change)

**Files:**
- Create: `src/lib/commerce/firm-order.ts`
- Modify: `src/app/actions.ts`

- [ ] **Step 1: Read the exact current FIRM block** in `src/app/actions.ts` (the `prisma.$transaction(async (tx) => { ... })` containing `if (allFirm) { for (const group of groups) {...} }`, plus the local `toQuotable` helper and the `groups`/`feeRules`/`planCurrency` setup). Hold it in context.

- [ ] **Step 2: Create the shared module** `src/lib/commerce/firm-order.ts` exporting a function that performs the FIRM Plan→Request→Quote(s)→Order creation for an already-resolved org + product set. Signature:
```ts
import { prisma } from "@/lib/prisma";
import { computeQuoteLines, quoteTotals } from "@/lib/money";
import { groupItemsByMarket } from "@/lib/quote-grouping";
import { loadContentFeeRules, contentFeeLinesForGroup } from "@/lib/content-fee";
// ...plus the ProductWithRules type + toQuotable moved here from actions.ts

export type FirmOrderItem = { productId: string; quantity: number; withContent?: boolean };

// Creates a CONFIRMED, auto-accepted order for an all-FIRM basket and
// returns the created Request id + order ids. Caller is responsible for
// having verified FIRM-visibility/availability/commit authority. This is
// the single source of truth shared by the /plan self-serve action and
// the POST /api/v1/orders endpoint.
export async function createFirmOrder(args: {
  organizationId: string;
  orgName: string;
  items: FirmOrderItem[];
  byId: Map<string, ProductWithRules>;
  brief?: { goal?: string | null; audience?: string | null; targetGeo?: string | null; targetAudience?: string | null; targetContext?: string | null };
}): Promise<{ requestId: string; orderIds: string[] }> { /* moved transaction body */ }
```
Move `toQuotable` and the transaction body here verbatim (adapting the `brief`/targeting fields to come from `args.brief`). Return the request id + order ids instead of redirecting.

- [ ] **Step 3: Rewire `submitRequest`.** In `actions.ts`, the FIRM branch calls `createFirmOrder({...})` with the resolved `org`, `items`, `byId`, and the brief/targeting it already parsed; keep the RFQ branch exactly as-is. Remove the now-moved `toQuotable` + inline FIRM transaction. The redirect after success stays in `submitRequest`.

- [ ] **Step 4: Verify no behavior change.**
```bash
pnpm typecheck   # clean
pnpm test        # 0 fail (existing quote/firm tests unchanged)
pnpm build       # Compiled successfully
```

- [ ] **Step 5: Commit.**
```bash
git add src/lib/commerce/firm-order.ts src/app/actions.ts
git commit -m "refactor(commerce): extract createFirmOrder shared by self-serve + API"
```

---

## Task 2: Pure order-request validator

**Files:** Create `src/lib/api/order-request.ts`, `src/lib/api/order-request.test.ts`

- [ ] **Step 1: Failing test:**
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOrderRequest } from "./order-request";

test("parseOrderRequest accepts valid items and dedupes by productId summing qty", () => {
  const r = parseOrderRequest({ items: [{ productId: "p1", quantity: 2 }, { productId: "p1", quantity: 1 }, { productId: "p2", quantity: 3 }] });
  assert.deepEqual(r, { ok: true, items: [{ productId: "p1", quantity: 3 }, { productId: "p2", quantity: 3 }], reference: null });
});
test("parseOrderRequest rejects empty items", () => {
  assert.deepEqual(parseOrderRequest({ items: [] }), { ok: false, error: "no_items" });
});
test("parseOrderRequest rejects non-positive / non-integer quantity", () => {
  assert.deepEqual(parseOrderRequest({ items: [{ productId: "p1", quantity: 0 }] }), { ok: false, error: "bad_quantity" });
  assert.deepEqual(parseOrderRequest({ items: [{ productId: "p1", quantity: 1.5 }] }), { ok: false, error: "bad_quantity" });
});
test("parseOrderRequest rejects malformed body", () => {
  assert.deepEqual(parseOrderRequest(null), { ok: false, error: "bad_body" });
  assert.deepEqual(parseOrderRequest({ items: [{ quantity: 1 }] }), { ok: false, error: "bad_item" });
});
```

- [ ] **Step 2: Run → fail.** `pnpm test 2>&1 | grep -A2 parseOrderRequest`

- [ ] **Step 3: Implement** (`src/lib/api/order-request.ts`):
```ts
export type ParsedOrder =
  | { ok: true; items: { productId: string; quantity: number }[]; reference: string | null }
  | { ok: false; error: "bad_body" | "no_items" | "bad_item" | "bad_quantity" };

export function parseOrderRequest(body: unknown): ParsedOrder {
  if (!body || typeof body !== "object") return { ok: false, error: "bad_body" };
  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items)) return { ok: false, error: "bad_body" };
  if (items.length === 0) return { ok: false, error: "no_items" };

  const merged = new Map<string, number>();
  for (const it of items) {
    if (!it || typeof it !== "object") return { ok: false, error: "bad_item" };
    const pid = (it as { productId?: unknown }).productId;
    const qty = (it as { quantity?: unknown }).quantity;
    if (typeof pid !== "string" || pid.length === 0) return { ok: false, error: "bad_item" };
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) return { ok: false, error: "bad_quantity" };
    merged.set(pid, (merged.get(pid) ?? 0) + qty);
  }
  const refRaw = (body as { reference?: unknown }).reference;
  const reference = typeof refRaw === "string" ? refRaw.slice(0, 200) : null;
  return { ok: true, items: [...merged].map(([productId, quantity]) => ({ productId, quantity })), reference };
}
```

- [ ] **Step 4: Run → pass.** `pnpm test 2>&1 | grep -E "parseOrderRequest|pass|fail"`

- [ ] **Step 5: Commit.**
```bash
git add src/lib/api/order-request.ts src/lib/api/order-request.test.ts
git commit -m "feat(api): pure order-request validator"
```

---

## Task 3: POST /api/v1/orders

**Files:** Create `src/app/api/v1/orders/route.ts`

- [ ] **Step 1: Implement** the endpoint — auth (`orders:write`), rate limit, parse, load products, FIRM-only guard, `createFirmOrder`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateRequest } from "@/lib/api-auth";
import { rfqLimiter } from "@/lib/rate-limit";
import { isProductPriceShown } from "@/lib/pricing-visibility";
import { parseOrderRequest } from "@/lib/api/order-request";
import { createFirmOrder } from "@/lib/commerce/firm-order";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

function errJson(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(req: NextRequest) {
  const auth = await authenticateRequest(req, "orders:write");
  if (!auth.ok) {
    const msg = auth.reason === "scope" ? "API key lacks orders:write scope." : "Authentication failed.";
    return errJson(auth.status, auth.reason.toUpperCase(), msg);
  }
  if (!auth.organizationId) {
    return errJson(403, "NO_ORG", "This key is not bound to an organization.");
  }
  const limited = await rfqLimiter.check(`api:orders:${auth.keyId}`);
  if (!limited.ok) {
    return errJson(429, "RATE_LIMITED", "Slow down — retry after " + Math.ceil(limited.retryAfterMs / 1000) + "s.");
  }

  let body: unknown;
  try { body = await req.json(); } catch { return errJson(400, "BAD_JSON", "Body is not valid JSON."); }
  const parsed = parseOrderRequest(body);
  if (!parsed.ok) return errJson(422, parsed.error.toUpperCase(), "Invalid order request.");

  const products = await prisma.product.findMany({
    where: { id: { in: parsed.items.map((i) => i.productId) }, active: true, bookable: true },
    include: { priceRules: true, title: { include: { publisher: true, market: true } } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  // Every item must resolve AND be FIRM-visible — otherwise it's RFQ-only.
  for (const it of parsed.items) {
    const p = byId.get(it.productId);
    if (!p) return errJson(422, "UNKNOWN_PRODUCT", `Product not found or not bookable: ${it.productId}`);
    if (p.visibility !== "FIRM" || !isProductPriceShown(p, p.title)) {
      return errJson(422, "RFQ_ONLY", `Product ${it.productId} is not self-serve — submit an RFQ via the desk.`);
    }
  }

  const org = await prisma.organization.findUnique({ where: { id: auth.organizationId }, select: { id: true, name: true } });
  if (!org) return errJson(403, "NO_ORG", "Organization not found.");

  const result = await createFirmOrder({
    organizationId: org.id,
    orgName: org.name,
    items: parsed.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    byId,
    brief: parsed.reference ? { goal: parsed.reference } : undefined,
  });

  await recordAudit("system", "api.order.create", `Request:${result.requestId}`, { keyId: auth.keyId, orgId: org.id });
  return NextResponse.json({ requestId: result.requestId, orderIds: result.orderIds }, { status: 201 });
}
```
> Adapt the `createFirmOrder` arg names to exactly match Task 1's signature. If `createFirmOrder` needs availability pre-checks, mirror the `submitRequest` availability check here before calling (re-read Task 1's function to confirm what it does internally vs what the caller must do).

- [ ] **Step 2: Verify.** `pnpm typecheck` clean; `pnpm build` compiles `/api/v1/orders`.

- [ ] **Step 3: Commit.**
```bash
git add src/app/api/v1/orders
git commit -m "feat(api): POST /api/v1/orders (FIRM-only, orders:write)"
```

---

## Task 4: orders:write scope issuance + OpenAPI

**Files:**
- Create: `scripts/issue-buyer-key.ts`
- Modify: `src/app/api/openapi.json/route.ts`

- [ ] **Step 1: Buyer-key script** (mirror `scripts/issue-publisher-key.ts`, but bind to an Organization and set scopes `catalog:read,orders:write`):
```ts
import { prisma } from "@/lib/prisma";
import { generateApiToken, hashApiToken } from "@/lib/api-key";

async function main() {
  const [orgRef, name = "API buyer key"] = process.argv.slice(2);
  if (!orgRef) { console.error("usage: tsx scripts/issue-buyer-key.ts <orgId|orgName> [name]"); process.exit(1); }
  const org = await prisma.organization.findFirst({ where: { OR: [{ id: orgRef }, { name: orgRef }] } });
  if (!org) { console.error("org not found:", orgRef); process.exit(1); }
  const superadmin = await prisma.user.findFirst({ where: { role: "SUPERADMIN" }, select: { id: true } });
  if (!superadmin) { console.error("no superadmin"); process.exit(1); }
  const token = generateApiToken();
  await prisma.apiKey.create({ data: { name, scopes: "catalog:read,orders:write", tokenHash: hashApiToken(token), createdBy: superadmin.id, organizationId: org.id } });
  console.log("Issued key for org", org.name, "\nTOKEN (shown once):", token);
  await prisma.$disconnect();
}
main();
```

- [ ] **Step 2: OpenAPI.** In `src/app/api/openapi.json/route.ts`, (a) extend the bearerAuth description to mention `orders:write`; (b) add an `OrderRequest`/`OrderResponse` schema to `components.schemas`; (c) add a `paths["/api/v1/orders"].post` operation referencing them and the 422 `RFQ_ONLY` case. Match the existing inline object style.

- [ ] **Step 3: Verify.** `pnpm typecheck`; `node -e 'JSON.parse(JSON.stringify(require("./src/app/api/openapi.json/route.ts")))' 2>/dev/null || pnpm build` (the route builds the spec; just confirm `pnpm build` is green and `/api/openapi.json` renders in smoke).

- [ ] **Step 4: Commit.**
```bash
git add scripts/issue-buyer-key.ts src/app/api/openapi.json/route.ts
git commit -m "feat(api): orders:write key issuance + OpenAPI for POST /orders"
```

---

## Task 5: Marketing — API & self-serve section + i18n

**Files:**
- Modify: `src/app/[locale]/(marketing)/api/page.tsx`
- Modify: `src/messages/{en,no,sv,da,fi,de}.json` (`apiDocs` namespace)

- [ ] **Step 1: English copy.** Add to the `apiDocs` namespace in `src/messages/en.json` a self-serve block:
```json
    "selfServeTitle": "Buy like programmatic — on named premium titles",
    "selfServeLead": "Discover inventory through the catalog API, then book firm-priced placements instantly — by API or in the app. No auction, no mystery supply: every title is named, every price is the publisher's.",
    "selfServeDiscover": "Discover: GET /api/v1/catalog/titles — filter by market, format, region.",
    "selfServeBuy": "Buy: POST /api/v1/orders — firm-priced products, an order back in one call (orders:write scope).",
    "selfServeWebhooks": "Stay in sync: subscribe to catalog webhooks for activations and price changes.",
    "selfServeBoundary": "RFQ titles stay desk-mediated by design — the API places only firm, self-serve inventory."
```
Translate into no/sv/da/fi/de.

- [ ] **Step 2: Render.** In `src/app/[locale]/(marketing)/api/page.tsx`, add a section rendering the self-serve block (re-read the page for its markup idiom; use the existing section/prose/card classes). Keep it honest — no "DSP"/"auction"/"RTB" wording.

- [ ] **Step 3: Verify.**
```bash
pnpm build
node -e 'for(const l of ["en","no","sv","da","fi","de"]){const a=require("./src/messages/"+l+".json").apiDocs; if(!a.selfServeTitle||!a.selfServeBuy) throw new Error("apiDocs self-serve missing "+l);} console.log("apiDocs ok");'
```
Expected: "apiDocs ok".

- [ ] **Step 4: Commit.**
```bash
git add "src/app/[locale]/(marketing)/api/page.tsx" src/messages
git commit -m "feat(api): API & self-serve marketing section (six locales)"
```

---

## Task 6: Full verification + smoke

- [ ] **Step 1:** `pnpm typecheck` clean · `pnpm lint` clean · `pnpm test` 0 fail (incl. order-request tests) · `pnpm build` Compiled successfully.
- [ ] **Step 2: API smoke (dev on NON-3000 port).** Issue a key: `pnpm tsx scripts/issue-buyer-key.ts <an advertiser org> "smoke"`. Then:
  - `curl -s -X POST localhost:4015/api/v1/orders -H "authorization: Bearer <token>" -H 'content-type: application/json' -d '{"items":[{"productId":"<a FIRM product id>","quantity":1}]}'` → `201` with `{requestId, orderIds}`.
  - Same with a non-FIRM product id → `422 RFQ_ONLY`.
  - No/!invalid auth → `401`; key without `orders:write` → `403 SCOPE`.
  - `curl localhost:4015/api/openapi.json | grep -c '/api/v1/orders'` → ≥1.
  - Verify in DB the order was created CONFIRMED for the key's org (reuse a quick `pnpm tsx -e` query).
  - Confirm the UI self-serve checkout still works (the extraction didn't break `/plan`): place a FIRM basket via the app.
- [ ] **Step 3:** `/en/api` and `/de/api` render the self-serve section, no key-paths, no "DSP/auction".
- [ ] **Step 4:** Final commit if smoke fixes needed.

---

## Self-Review notes
- Spec coverage: createFirmOrder extraction (T1) ✓; pure validator (T2) ✓; POST /api/v1/orders FIRM-only + scope + rate-limit + audit (T3) ✓; orders:write issuance + OpenAPI (T4) ✓; honest API/self-serve marketing, six locales, no DSP wording (T5) ✓; verification incl. UI-still-works regression (T6) ✓.
- Out of scope honored: no auction/RTB; RFQ stays desk-only (422 RFQ_ONLY); keys desk-issued.
- Risk: T1 extraction must be behavior-preserving — guarded by existing tests + the T6 UI smoke. Re-read the real FIRM block before moving it; do not change pricing logic.
