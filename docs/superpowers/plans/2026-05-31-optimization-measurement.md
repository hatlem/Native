# Optimization — In-Article Tracked Links + Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make campaign performance real and honest — count first-party clicks on tracked links embedded in the articles NativeSpin produces, keep impressions optional, surface a per-order dashboard, and remove the false "viewability/scroll-depth/brand-lift" copy.

**Architecture:** NativeSpin produces the `ContentAsset`, so it owns the article's outbound links. A `TrackedLink` (per order line) maps an unguessable token → advertiser URL; `GET /go/<token>` 302-redirects and increments a click counter (first-party, all formats). The desk, when finalizing an asset, auto-detects candidate links and confirms which to track (hybrid). Impressions stay an optional publisher/desk-entered number (`BookingMetrics`). Pure logic (link extraction, token resolve, validation) is unit-tested; DB/UI is guarded by typecheck+build.

**Tech Stack:** Next.js App Router (route handlers + server actions), Prisma/PostgreSQL, next-intl (six locales), `node:test`. `/go` sits top-level (middleware matcher `/((?!api|_next|_vercel|.*\..*).*)` skips it like `/api`).

**Branch:** `feat/optimization-and-api` (already created off `feat/competitive-suite` @ cfc3ac1; do NOT switch). Spec: `docs/superpowers/specs/2026-05-31-optimization-measurement-design.md`.

**Conventions (verified):**
- `prisma migrate dev`/`reset` BLOCKED. Hand-author SQL under `prisma/migrations/<ts>_name/migration.sql`; apply with `pnpm prisma db execute --schema prisma/schema.prisma --file <sql>` + `pnpm prisma migrate resolve --applied <name>` + `pnpm prisma generate`. New ts sorts after `20260531130000_add_title_geo_and_plan_targeting`.
- `generateToken()` (base64url, 256-bit) + `hashToken()` in `@/lib/tokens`.
- Tests `node:test`+`node:assert/strict` via `pnpm test`. Commands: `pnpm typecheck`, `pnpm build`.
- Desk content-asset UI: `src/app/[locale]/desk/orders/[orderId]/page.tsx`; actions in `src/app/desk-actions.ts` (`saveDraft` writes asset body, auth gate `requireDeskOrContent`). Buyer order view: `src/app/[locale]/orders/[orderId]/page.tsx`. `field(formData,key)` is the desk-actions form helper; `recordAudit(userId, action, entity, detail?)`.
- The marketing/quote copy lives in root `src/messages/{locale}.json`: `quoteNarrative.bullets.*`, `landing.obj.a4`.

---

## File Structure

- `prisma/schema.prisma` — `TrackedLink` model, `BookingMetrics` model, `PublisherBooking.metrics` + `OrderLine.trackedLinks` relations.
- `prisma/migrations/20260531140000_add_tracked_links_and_metrics/migration.sql`.
- `src/lib/metrics/links.ts` — pure `extractLinks(body)`, `rewriteBodyLinks(body, map)`, `goPath(token)`.
- `src/lib/metrics/links.test.ts`, `src/lib/metrics/validate.ts` + `.test.ts` (impressions validation).
- `src/lib/metrics/store.ts` — DB glue (create tracked links from confirmed candidates, record impression).
- `src/app/go/[token]/route.ts` — redirect + count.
- `src/app/desk-actions.ts` — `confirmTrackedLinks` action (desk picks candidates).
- `src/app/publisher-actions.ts` — `submitBookingImpressions` action.
- `src/app/[locale]/desk/orders/[orderId]/page.tsx` — tracked-links panel.
- `src/app/[locale]/publisher/orders/page.tsx` — impressions field.
- `src/app/[locale]/orders/[orderId]/page.tsx` — buyer performance panel.
- `src/messages/{en,no,sv,da,fi,de}.json` — performance namespace + reworded copy.

---

## Task 1: Schema — TrackedLink + BookingMetrics + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260531140000_add_tracked_links_and_metrics/migration.sql`

- [ ] **Step 1: Add models + relations.** In `prisma/schema.prisma`:

(a) Add a `MetricsSource` enum near the other enums:
```prisma
enum MetricsSource {
  PUBLISHER
  DESK
}
```
(b) Add to `model OrderLine` (in its relation block, after `booking PublisherBooking?`):
```prisma
  trackedLinks TrackedLink[]
```
(c) Add to `model PublisherBooking` (after `confirmedAt DateTime?`):
```prisma
  metrics     BookingMetrics?
```
(d) Append two models at end of file:
```prisma
// First-party tracked link embedded in a produced article. NativeSpin
// writes the content, so it owns the outbound links — each becomes a
// /go/<token> that counts clicks before redirecting to the advertiser.
model TrackedLink {
  id          String    @id @default(cuid())
  orderLineId String
  orderLine   OrderLine @relation(fields: [orderLineId], references: [id], onDelete: Cascade)
  token       String    @unique
  targetUrl   String
  label       String?
  clickCount  Int       @default(0)
  createdAt   DateTime  @default(now())

  @@index([orderLineId])
}

// Optional publisher/desk-reported reach for a live booking. Clicks come
// from TrackedLink (first-party); impressions are the one number only the
// publisher can supply, so they stay optional.
model BookingMetrics {
  id          String           @id @default(cuid())
  bookingId   String           @unique
  booking     PublisherBooking @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  impressions Int?
  source      MetricsSource    @default(PUBLISHER)
  note        String?
  reportedAt  DateTime?
  reportedBy  String?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
}
```

- [ ] **Step 2: Migration SQL.** Create the migration file:
```sql
-- In-article tracked links + optional booking impressions. All additive.

-- CreateEnum
CREATE TYPE "MetricsSource" AS ENUM ('PUBLISHER', 'DESK');

-- CreateTable
CREATE TABLE "TrackedLink" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "label" TEXT,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackedLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingMetrics" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "impressions" INTEGER,
    "source" "MetricsSource" NOT NULL DEFAULT 'PUBLISHER',
    "note" TEXT,
    "reportedAt" TIMESTAMP(3),
    "reportedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BookingMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackedLink_token_key" ON "TrackedLink"("token");
CREATE INDEX "TrackedLink_orderLineId_idx" ON "TrackedLink"("orderLineId");
CREATE UNIQUE INDEX "BookingMetrics_bookingId_key" ON "BookingMetrics"("bookingId");

-- AddForeignKey
ALTER TABLE "TrackedLink" ADD CONSTRAINT "TrackedLink_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingMetrics" ADD CONSTRAINT "BookingMetrics_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "PublisherBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Apply + generate.**
```bash
pnpm prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20260531140000_add_tracked_links_and_metrics/migration.sql
pnpm prisma migrate resolve --applied 20260531140000_add_tracked_links_and_metrics
pnpm prisma generate
```
Run `pnpm prisma migrate status` → "Database schema is up to date!"

- [ ] **Step 4: Typecheck + commit.**
```bash
pnpm typecheck   # clean (only pre-existing content-fee.it.test.ts if present)
git add prisma/schema.prisma prisma/migrations/20260531140000_add_tracked_links_and_metrics
git commit -m "feat(metrics): TrackedLink + BookingMetrics schema"
```

---

## Task 2: Pure link extraction + rewrite + go-path

**Files:**
- Create: `src/lib/metrics/links.ts`, `src/lib/metrics/links.test.ts`

- [ ] **Step 1: Failing test** (`src/lib/metrics/links.test.ts`):
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractLinks, rewriteBodyLinks, goPath } from "./links";

test("extractLinks finds distinct external http(s) urls", () => {
  const body = 'See <a href="https://shop.example.com/x">shop</a> and <a href="https://shop.example.com/x">again</a> plus <a href="http://other.test">o</a>.';
  assert.deepEqual(extractLinks(body), ["https://shop.example.com/x", "http://other.test"]);
});

test("extractLinks ignores relative + mailto + anchors", () => {
  const body = '<a href="/local">a</a> <a href="mailto:x@y.z">m</a> <a href="#top">t</a>';
  assert.deepEqual(extractLinks(body), []);
});

test("rewriteBodyLinks swaps only mapped urls for their go path", () => {
  const body = '<a href="https://a.test">a</a> <a href="https://b.test">b</a>';
  const out = rewriteBodyLinks(body, { "https://a.test": "tok1" });
  assert.equal(out.includes('href="/go/tok1"'), true);
  assert.equal(out.includes('href="https://b.test"'), true);
  assert.equal(out.includes('href="https://a.test"'), false);
});

test("goPath builds the redirect path", () => {
  assert.equal(goPath("abc"), "/go/abc");
});
```

- [ ] **Step 2: Run → fail.** `pnpm test 2>&1 | grep -A2 extractLinks` → cannot find module.

- [ ] **Step 3: Implement** (`src/lib/metrics/links.ts`):
```ts
// Pure helpers for in-article tracked links. No DB, no IO.

const HREF_RE = /href\s*=\s*"(https?:\/\/[^"]+)"/gi;

// Distinct external http(s) URLs in the asset body, in first-seen order.
export function extractLinks(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(HREF_RE)) {
    const url = m[1]!;
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

export function goPath(token: string): string {
  return `/go/${token}`;
}

// Replace each mapped URL's href with its /go/<token> path. Unmapped
// hrefs are left untouched. URLs are matched exactly (as they appear in
// an href="..."), so partial/substring collisions can't occur.
export function rewriteBodyLinks(
  body: string,
  urlToToken: Record<string, string>,
): string {
  return body.replace(HREF_RE, (whole, url: string) =>
    urlToToken[url] ? `href="${goPath(urlToToken[url])}"` : whole,
  );
}
```

- [ ] **Step 4: Run → pass.** `pnpm test 2>&1 | grep -E "extractLinks|rewriteBodyLinks|goPath|pass|fail"`

- [ ] **Step 5: Commit.**
```bash
git add src/lib/metrics/links.ts src/lib/metrics/links.test.ts
git commit -m "feat(metrics): pure link extraction + body rewrite helpers"
```

---

## Task 3: Impressions validation (pure)

**Files:** Create `src/lib/metrics/validate.ts`, `src/lib/metrics/validate.test.ts`

- [ ] **Step 1: Failing test:**
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseImpressions } from "./validate";

test("parseImpressions accepts a non-negative integer string", () => {
  assert.deepEqual(parseImpressions("1500"), { ok: true, value: 1500 });
});
test("parseImpressions treats empty as cleared (null)", () => {
  assert.deepEqual(parseImpressions(""), { ok: true, value: null });
});
test("parseImpressions rejects negatives and non-integers", () => {
  assert.deepEqual(parseImpressions("-5"), { ok: false });
  assert.deepEqual(parseImpressions("12.5"), { ok: false });
  assert.deepEqual(parseImpressions("abc"), { ok: false });
});
```

- [ ] **Step 2: Run → fail.** `pnpm test 2>&1 | grep -A2 parseImpressions`

- [ ] **Step 3: Implement** (`src/lib/metrics/validate.ts`):
```ts
export type ImpressionsParse =
  | { ok: true; value: number | null }
  | { ok: false };

export function parseImpressions(raw: string): ImpressionsParse {
  const s = raw.trim();
  if (s === "") return { ok: true, value: null };
  if (!/^\d+$/.test(s)) return { ok: false };
  return { ok: true, value: Number(s) };
}
```

- [ ] **Step 4: Run → pass.** `pnpm test 2>&1 | grep -E "parseImpressions|pass|fail"`

- [ ] **Step 5: Commit.**
```bash
git add src/lib/metrics/validate.ts src/lib/metrics/validate.test.ts
git commit -m "feat(metrics): pure impressions validation"
```

---

## Task 4: /go/<token> redirect route

**Files:** Create `src/app/go/[token]/route.ts`

- [ ] **Step 1: Implement** (no test file — exercised via smoke; logic is a thin DB increment):
```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

// First-party click counter. Looks up the tracked link, increments its
// counter, and 302-redirects to the advertiser destination. Unknown or
// malformed token → redirect to the marketplace home (never a 500, never
// reflect the token into an error page).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const fallback = appUrl();
  if (!token) return NextResponse.redirect(fallback);

  const link = await prisma.trackedLink.findUnique({
    where: { token },
    select: { id: true, targetUrl: true },
  });
  if (!link) return NextResponse.redirect(fallback);

  // Best-effort count — never block or fail the redirect on the write.
  prisma.trackedLink
    .update({ where: { id: link.id }, data: { clickCount: { increment: 1 } } })
    .catch((err) => console.error("trackedlink.increment_failed", err));

  return NextResponse.redirect(link.targetUrl);
}
```

- [ ] **Step 2: Verify it's outside locale routing.** Confirm `src/middleware.ts` matcher excludes it: the matcher `/((?!api|_next|_vercel|.*\..*).*)` matches `/go/abc` (no dot, not api) — so middleware WOULD run. Check whether next-intl errors on an unknown top-level segment. Run `pnpm build` and confirm `/go/[token]` compiles as a route. If middleware tries to localize it, add `go` to the middleware's ignore list (mirror how `api` is excluded) — open `src/middleware.ts`, and if there is an explicit skip list/regex for non-localized paths, add `go`. (If the build shows `/go/[token]` as a normal route handler and a smoke hit in Task 9 redirects correctly, no middleware change is needed.)

- [ ] **Step 3: Typecheck + commit.**
```bash
pnpm typecheck
git add src/app/go src/middleware.ts
git commit -m "feat(metrics): /go/<token> first-party click redirect"
```

---

## Task 5: Tracked-link store (DB glue)

**Files:** Create `src/lib/metrics/store.ts`

- [ ] **Step 1: Implement** (thin glue; no unit test — typecheck-guarded):
```ts
import { prisma } from "@/lib/prisma";
import { generateToken } from "@/lib/tokens";

// Create TrackedLink rows for the chosen destination URLs on an order
// line, skipping URLs already tracked for that line (idempotent). Returns
// the full url→token map for the line so the caller can rewrite the body.
export async function ensureTrackedLinks(
  orderLineId: string,
  links: { url: string; label?: string | null }[],
): Promise<Record<string, string>> {
  const existing = await prisma.trackedLink.findMany({
    where: { orderLineId },
    select: { token: true, targetUrl: true },
  });
  const map: Record<string, string> = {};
  for (const e of existing) map[e.targetUrl] = e.token;

  for (const l of links) {
    if (map[l.url]) continue;
    const token = generateToken();
    await prisma.trackedLink.create({
      data: { orderLineId, token, targetUrl: l.url, label: l.label ?? null },
    });
    map[l.url] = token;
  }
  return map;
}

// Aggregate click totals per order line for a set of lines.
export async function clicksByOrderLine(
  orderLineIds: string[],
): Promise<Record<string, number>> {
  const rows = await prisma.trackedLink.groupBy({
    by: ["orderLineId"],
    where: { orderLineId: { in: orderLineIds } },
    _sum: { clickCount: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.orderLineId] = r._sum.clickCount ?? 0;
  return out;
}
```

- [ ] **Step 2: Typecheck + commit.**
```bash
pnpm typecheck
git add src/lib/metrics/store.ts
git commit -m "feat(metrics): tracked-link store (ensure + click rollup)"
```

---

## Task 6: Desk action — confirm tracked links

**Files:** Modify `src/app/desk-actions.ts`

- [ ] **Step 1: Add the action.** Append to `src/app/desk-actions.ts` (reuse existing `field`, `requireDeskOrContent`, `recordAudit`, `prisma` imports already in the file):
```ts
export async function confirmTrackedLinks(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  const orderLineId = field(formData, "orderLineId");
  const assetId = field(formData, "assetId");
  const { userId } = await requireDeskOrContent(locale);

  // Checkbox group of URLs the desk chose to track; labels are parallel
  // hidden inputs keyed by index are overkill — accept "url|label" pairs.
  const chosen = formData
    .getAll("trackUrl")
    .map((v) => String(v))
    .filter(Boolean)
    .map((entry) => {
      const [url, ...rest] = entry.split(""); // unit-separator: urllabel
      return { url: url!, label: rest.join("") || null };
    })
    .filter((l) => /^https?:\/\//.test(l.url));

  if (chosen.length) {
    const { ensureTrackedLinks } = await import("@/lib/metrics/store");
    const { rewriteBodyLinks } = await import("@/lib/metrics/links");
    const map = await ensureTrackedLinks(orderLineId, chosen);

    // Rewrite the latest asset body so the published article uses /go links.
    const asset = await prisma.contentAsset.findUnique({
      where: { id: assetId },
      select: { id: true, body: true },
    });
    if (asset?.body) {
      await prisma.contentAsset.update({
        where: { id: asset.id },
        data: { body: rewriteBodyLinks(asset.body, map) },
      });
    }
    await recordAudit(userId, "asset.track_links", `ContentAsset:${assetId}`, {
      count: chosen.length,
    });
  }
  redirect(`/${locale}/desk/orders/${orderId}`);
}
```

- [ ] **Step 2: Typecheck + commit.**
```bash
pnpm typecheck
git add src/app/desk-actions.ts
git commit -m "feat(metrics): desk confirmTrackedLinks action (rewrites asset body)"
```

---

## Task 7: Desk UI — tracked-links panel

**Files:** Modify `src/app/[locale]/desk/orders/[orderId]/page.tsx`

- [ ] **Step 1: Render candidates + tracked state per line.** Re-read the file first. For each order line that has a latest asset with a body, compute candidate links server-side and render a `confirmTrackedLinks` form. Add near the asset rendering (adapt class names to the file's existing markup):
```tsx
{(() => {
  const body = latest?.body ?? "";
  if (!body) return null;
  const candidates = extractLinks(body);            // import from @/lib/metrics/links
  const tracked = new Set(line.trackedLinks.map((tl) => tl.targetUrl)); // include trackedLinks in the query
  if (candidates.length === 0) return null;
  return (
    <form action={confirmTrackedLinks} className="track-links">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orderId" value={order.id} />
      <input type="hidden" name="orderLineId" value={line.id} />
      <input type="hidden" name="assetId" value={latest!.id} />
      <p className="muted small">{tt("trackLinksLabel")}</p>
      {candidates.map((url) => (
        <label key={url} className="checkbox">
          <input
            type="checkbox"
            name="trackUrl"
            value={url}
            defaultChecked={tracked.has(url)}
            disabled={tracked.has(url)}
          />
          <span>{url}{tracked.has(url) ? ` — ${tt("trackedClicks", { n: line.trackedLinks.find((t) => t.targetUrl === url)?.clickCount ?? 0 })}` : ""}</span>
        </label>
      ))}
      <button type="submit" className="btn small">{tt("trackLinksSave")}</button>
    </form>
  );
})()}
```
Add the imports (`extractLinks` from `@/lib/metrics/links`, `confirmTrackedLinks` from `@/app/desk-actions`), add `const tt = await getTranslations({ locale, namespace: "performance" });`, and extend the order-line prisma query in this page to `include: { trackedLinks: true, ... }` (and the brief assets already loaded — keep `body` selected on the latest asset).

- [ ] **Step 2: Build + commit.**
```bash
pnpm build   # Compiled successfully
git add "src/app/[locale]/desk/orders/[orderId]/page.tsx"
git commit -m "feat(metrics): desk tracked-links panel on order detail"
```

---

## Task 8: Publisher impressions + buyer performance panel + i18n

**Files:**
- Modify: `src/app/publisher-actions.ts` (add `submitBookingImpressions`)
- Modify: `src/app/[locale]/publisher/orders/page.tsx` (impressions field)
- Modify: `src/app/[locale]/orders/[orderId]/page.tsx` (buyer panel)
- Modify: `src/messages/{en,no,sv,da,fi,de}.json` (`performance` namespace + reworded copy)

- [ ] **Step 1: Publisher action.** Append to `src/app/publisher-actions.ts` (reuse `field`, `requirePublisher`, `prisma`):
```ts
export async function submitBookingImpressions(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const { publisherId, userId } = await requirePublisher(locale);
  const bookingId = field(formData, "bookingId");
  const raw = field(formData, "impressions");

  const { parseImpressions } = await import("@/lib/metrics/validate");
  const parsed = parseImpressions(raw);
  if (!parsed.ok) redirect(`/${locale}/publisher/orders?error=metrics`);

  // Ownership: booking → orderLine → product → title.publisherId must match.
  const booking = await prisma.publisherBooking.findUnique({
    where: { id: bookingId },
    select: { id: true, orderLine: { select: { product: { select: { title: { select: { publisherId: true } } } } } } },
  });
  if (!booking || booking.orderLine.product?.title.publisherId !== publisherId) {
    redirect(`/${locale}/publisher/orders`);
  }
  await prisma.bookingMetrics.upsert({
    where: { bookingId },
    create: { bookingId, impressions: parsed.value, source: "PUBLISHER", reportedAt: new Date(), reportedBy: userId },
    update: { impressions: parsed.value, source: "PUBLISHER", reportedAt: new Date(), reportedBy: userId },
  });
  redirect(`/${locale}/publisher/orders`);
}
```
> If `OrderLine.product` isn't a direct relation (productId is nullable), adapt the ownership lookup to go via `productId` → `prisma.product.findUnique`. Re-read the booking include shape before writing.

- [ ] **Step 2: Publisher form.** In `src/app/[locale]/publisher/orders/page.tsx`, in each LIVE booking card, add an impressions form posting to `submitBookingImpressions` (hidden `locale`, `bookingId`; number input `impressions` defaulting to the existing `booking.metrics?.impressions`). Include `metrics: true` in the booking query.

- [ ] **Step 3: Buyer panel.** In `src/app/[locale]/orders/[orderId]/page.tsx`, include `trackedLinks: true` and `booking: { include: { metrics: true } }` in the line query; compute `clicksByOrderLine` (from `@/lib/metrics/store`) for the order's line ids; render per line: clicks (always), impressions (if `booking.metrics?.impressions != null`), else the empty-state copy `performance.pending`.

- [ ] **Step 4: i18n — `performance` namespace (English):**
```json
  "performance": {
    "trackLinksLabel": "Track outbound links in this article:",
    "trackLinksSave": "Save tracked links",
    "trackedClicks": "{n} clicks",
    "panelTitle": "Performance",
    "clicks": "Clicks",
    "impressions": "Impressions",
    "pending": "Reporting at the agreed checkpoint.",
    "impressionsLabel": "Impressions (from your analytics)",
    "impressionsSave": "Save"
  },
```
Translate into no/sv/da/fi/de.

- [ ] **Step 5: Rework the FALSE copy (all six locales).** Replace these values:
  - `quoteNarrative.bullets.NATIVE_DISPLAY[3]` "Performance report at 30 and 90 days (impressions, click-through, viewability)" → "Click-through tracking on every link we place, plus reported impressions, at agreed checkpoints"
  - `quoteNarrative.bullets.NATIVE_ARTICLE[4]`, `ADVERTORIAL[3]`, `PACKAGE[3]` "Performance report at 30…" → "Click-through tracking on every link we place, reported at agreed checkpoints"
  - `landing.obj.a4` (the measurement Q&A): replace with "We track click-throughs on every link inside your article — those clicks are counted first-party. Reach (impressions) is reported by the publisher where available. We don't claim viewability or panel-based brand-lift we can't measure."
  Translate each into no/sv/da/fi/de. Remove the words viewability / scroll depth / time on page / brand lift / panel study from these strings.

- [ ] **Step 6: Verify.**
```bash
pnpm typecheck   # clean
pnpm build       # Compiled successfully
node -e 'const fs=require("fs");for(const l of ["en","no","sv","da","fi","de"]){const j=JSON.parse(fs.readFileSync("src/messages/"+l+".json","utf8")); if(!j.performance||!j.performance.panelTitle) throw new Error("performance missing "+l); const bad=JSON.stringify(j.quoteNarrative)+JSON.stringify(j.landing.obj); if(/viewabilit|scroll depth|brand lift|panel study/i.test(bad)) throw new Error("false claim remains "+l);} console.log("i18n ok");'
```
Expected: "i18n ok".

- [ ] **Step 7: Commit.**
```bash
git add src/app/publisher-actions.ts "src/app/[locale]/publisher/orders/page.tsx" "src/app/[locale]/orders/[orderId]/page.tsx" src/messages
git commit -m "feat(metrics): publisher impressions + buyer performance panel; honest copy (six locales)"
```

---

## Task 9: Full verification + smoke

- [ ] **Step 1:** `pnpm typecheck` → clean. `pnpm lint` → clean. `pnpm test` → 0 fail (incl. links + validate tests).
- [ ] **Step 2:** `pnpm build` → Compiled successfully; `/go/[token]` present as a route.
- [ ] **Step 3: Smoke (dev on NON-3000 port, e.g. `pnpm next dev -p 4015`).**
  1. As desk on an order with a content asset whose body has an external link: the tracked-links panel lists the link; tick it + save; re-open → it shows as tracked. Confirm the asset body now contains `/go/<token>`.
  2. `curl -si 'http://localhost:4015/go/<token>'` → `302` to the target URL; DB `TrackedLink.clickCount` incremented; `curl 'http://localhost:4015/go/garbage'` → 302 to home (no 500).
  3. As publisher on a LIVE booking: enter impressions → saved.
  4. As buyer on the order: performance panel shows clicks (and impressions if set), or the pending empty state.
  5. `/de/...` strings render (no key-paths); native-display quote bullet no longer says "viewability".
- [ ] **Step 4:** Final commit if smoke fixes needed.

---

## Self-Review notes
- Spec coverage: TrackedLink primary mechanism (T1,T2,T4,T5,T6,T7) ✓; hybrid auto-detect + desk-confirm (T7 extract + T6 confirm) ✓; optional impressions publisher-entered + desk-overridable via upsert (T8) ✓; buyer dashboard clicks+impressions+pending (T8) ✓; honest copy rewrite dropping viewability/scroll/brand-lift, six locales (T8) ✓; pure logic unit-tested, DB/UI typecheck+build guarded ✓; A/B out of scope (not built) ✓.
- The superseded booking-level `clickToken` from the spec's §1 is intentionally NOT implemented — TrackedLink replaces it (spec note says so).
- Re-read each modified page/action before editing (terminal output unreliable; markup/relations must match real file).
