# Catalog Price Bands + Production Fee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every exact catalog price with a scrape-proof bucket band that includes the content-production fee, close three raw-cost leaks (JSON API, CSV export, JSON-LD), and make the whole catalog card clickable.

**Architecture:** Three new pure modules in `src/lib/pricing/` (`bands.ts` bucket engine, `production-fee.ts` cascade over the existing `ContentFeeRule` desk price list, `display-price.ts` shared band selection) feed all six buyer-facing surfaces so they cannot drift. Two nullable Decimal override columns are added to `Product`/`Title`. The visibility gate (`isProductPriceShown`) is untouched.

**Tech Stack:** Next.js 15 App Router (server components), Prisma 6 + PostgreSQL, next-intl, `node:test` via `tsx --test` (`pnpm test`).

**Spec:** `docs/superpowers/specs/2026-06-11-catalog-price-bands-design.md` — read it first.

**Branch:** `feat/catalog-price-bands` (already created; spec committed). `main` auto-deploys to prod — never commit there.

**Repo conventions you must follow:**
- Tests are `node:test` files named `*.test.ts` next to the source, run with `pnpm test` (runs ALL tests) — for one file use `pnpm tsx --test src/lib/pricing/bands.test.ts`.
- `prisma migrate dev` is BLOCKED in this environment. Hand-author migration SQL in `prisma/migrations/<timestamp>_<name>/migration.sql`; `migrate deploy` runs on deploy.
- New code imports visibility helpers from `@/lib/pricing/visibility` (canonical), not the legacy `@/lib/pricing-visibility` re-export.
- i18n: author English in `src/messages/en.json` first, then translate no/da/sv/fi/de. Natural copy, no calques.
- Conventional commits, ≤50-char titles, Claude co-author footer.

---

### Task 1: Band engine (`bands.ts`)

**Files:**
- Create: `src/lib/pricing/bands.ts`
- Test: `src/lib/pricing/bands.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/pricing/bands.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceBand, bandLabel } from "./bands";

test("mid-bucket NOK price lands in its range", () => {
  assert.deepEqual(priceBand(41_400, "NOK"), {
    kind: "range",
    low: 40_000,
    high: 60_000,
  });
});

test("boundary is inclusive-low, exclusive-high", () => {
  // exactly on a boundary belongs to the bucket it OPENS
  assert.deepEqual(priceBand(25_000, "SEK"), {
    kind: "range",
    low: 25_000,
    high: 40_000,
  });
  assert.deepEqual(priceBand(24_999, "SEK"), {
    kind: "range",
    low: 15_000,
    high: 25_000,
  });
});

test("below first boundary → under", () => {
  assert.deepEqual(priceBand(12_000, "DKK"), { kind: "under", high: 15_000 });
});

test("at/above last boundary → over", () => {
  assert.deepEqual(priceBand(90_000, "NOK"), { kind: "over", low: 90_000 });
  assert.deepEqual(priceBand(250_000, "NOK"), { kind: "over", low: 90_000 });
});

test("EUR uses the small-denomination scale", () => {
  assert.deepEqual(priceBand(3_000, "EUR"), {
    kind: "range",
    low: 2_500,
    high: 4_000,
  });
});

test("unknown currency falls back to EUR scale, never throws", () => {
  assert.deepEqual(priceBand(3_000, "USD"), {
    kind: "range",
    low: 2_500,
    high: 4_000,
  });
});

test("bandLabel formats range / over / under", () => {
  assert.equal(
    bandLabel({ kind: "range", low: 40_000, high: 60_000 }, "NOK"),
    "40–60k NOK",
  );
  assert.equal(bandLabel({ kind: "over", low: 90_000 }, "NOK"), "90k+ NOK");
  assert.equal(bandLabel({ kind: "under", high: 15_000 }, "DKK"), "< 15k DKK");
});

test("bandLabel keeps fractional k for EUR-scale buckets", () => {
  assert.equal(
    bandLabel({ kind: "range", low: 1_500, high: 2_500 }, "EUR"),
    "1.5–2.5k EUR",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm tsx --test src/lib/pricing/bands.test.ts`
Expected: FAIL — `Cannot find module './bands'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/pricing/bands.ts`:

```ts
// Price bands — the ONLY price representation buyers see on browse
// surfaces (catalog grid, title detail, compare, JSON API, CSV export,
// JSON-LD). Many distinct prices collapse into one bucket label so
// neither the customer price nor the net basePrice can be
// reverse-engineered from what we publish.
// Spec: docs/superpowers/specs/2026-06-11-catalog-price-bands-design.md

export type Band =
  | { kind: "under"; high: number }
  | { kind: "range"; low: number; high: number }
  | { kind: "over"; low: number };

// Per-currency bucket boundaries (ascending). Scandi kroner and the
// EUR-scale currencies differ ~10×. NOK/SEK/DKK are calibrated from the
// 2026-06 applied quotes; EUR/GBP/CHF are scale-guesses — recalibrate
// after each market's first ~10 applied quotes (data-only PR).
const BUCKETS: Record<string, number[]> = {
  NOK: [15_000, 25_000, 40_000, 60_000, 90_000],
  SEK: [15_000, 25_000, 40_000, 60_000, 90_000],
  DKK: [15_000, 25_000, 40_000, 60_000, 90_000],
  EUR: [1_500, 2_500, 4_000, 6_000, 9_000],
  GBP: [1_500, 2_500, 4_000, 6_000, 9_000],
  CHF: [1_500, 2_500, 4_000, 6_000, 9_000],
};

// Unknown currency → EUR scale. A wrong-but-plausible band beats a
// crashed render path.
const FALLBACK_BUCKETS = BUCKETS.EUR;

export function priceBand(amount: number, currency: string): Band {
  const buckets = BUCKETS[currency] ?? FALLBACK_BUCKETS;
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  if (amount < first) return { kind: "under", high: first };
  if (amount >= last) return { kind: "over", low: last };
  // First boundary strictly above `amount` closes the range; the one
  // before it opens it (inclusive-low, exclusive-high).
  const closeIdx = buckets.findIndex((b) => amount < b);
  return { kind: "range", low: buckets[closeIdx - 1], high: buckets[closeIdx] };
}

// "40–60k NOK" | "90k+ NOK" | "< 15k DKK". Deliberately locale-neutral:
// "k" reads as thousand in every market we serve, and the ISO code
// avoids symbol ambiguity ("kr" is three different currencies here).
function k(n: number): string {
  return String(n / 1000);
}

export function bandLabel(band: Band, currency: string): string {
  switch (band.kind) {
    case "under":
      return `< ${k(band.high)}k ${currency}`;
    case "over":
      return `${k(band.low)}k+ ${currency}`;
    case "range":
      return `${k(band.low)}–${k(band.high)}k ${currency}`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm tsx --test src/lib/pricing/bands.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/bands.ts src/lib/pricing/bands.test.ts
git commit -m "feat(pricing): add price-band bucket engine

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Production-fee cascade (`production-fee.ts`)

**Files:**
- Create: `src/lib/pricing/production-fee.ts`
- Test: `src/lib/pricing/production-fee.test.ts`

Context: `pickContentFeeRule(rules, productType, marketCode)` and
`ContentFeeRuleSpec` already exist in `src/lib/money.ts` (most-specific
active match: productType+market > productType > market > global). This
task only adds the override cascade on top.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pricing/production-fee.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProductionFee } from "./production-fee";
import type { ContentFeeRuleSpec } from "@/lib/money";

const RULES: ContentFeeRuleSpec[] = [
  {
    marketCode: "NO",
    productType: "NATIVE_ARTICLE",
    currency: "NOK",
    greenfieldFee: 2000,
    adaptationFee: null,
    active: true,
  },
  {
    marketCode: "NO",
    productType: null,
    currency: "NOK",
    greenfieldFee: 1000,
    adaptationFee: null,
    active: true,
  },
];

test("product-level fee wins over everything", () => {
  const fee = resolveProductionFee({
    productFee: 3500,
    titleFee: 2500,
    productType: "NATIVE_ARTICLE",
    marketCode: "NO",
    rules: RULES,
  });
  assert.equal(fee, 3500);
});

test("explicit 0 at product level short-circuits (publisher includes production)", () => {
  const fee = resolveProductionFee({
    productFee: 0,
    titleFee: 2500,
    productType: "NATIVE_ARTICLE",
    marketCode: "NO",
    rules: RULES,
  });
  assert.equal(fee, 0);
});

test("title-level default used when product fee unset", () => {
  const fee = resolveProductionFee({
    productFee: null,
    titleFee: 2500,
    productType: "NATIVE_ARTICLE",
    marketCode: "NO",
    rules: RULES,
  });
  assert.equal(fee, 2500);
});

test("explicit 0 at title level short-circuits", () => {
  const fee = resolveProductionFee({
    productFee: null,
    titleFee: 0,
    productType: "NATIVE_ARTICLE",
    marketCode: "NO",
    rules: RULES,
  });
  assert.equal(fee, 0);
});

test("falls through to most-specific ContentFeeRule", () => {
  const fee = resolveProductionFee({
    productFee: null,
    titleFee: null,
    productType: "NATIVE_ARTICLE",
    marketCode: "NO",
    rules: RULES,
  });
  assert.equal(fee, 2000); // the NATIVE_ARTICLE+NO rule, not the NO wildcard
});

test("wildcard rule used for other product types", () => {
  const fee = resolveProductionFee({
    productFee: null,
    titleFee: null,
    productType: "NATIVE_DISPLAY",
    marketCode: "NO",
    rules: RULES,
  });
  assert.equal(fee, 1000);
});

test("no matching rule → 0 (band still renders)", () => {
  const fee = resolveProductionFee({
    productFee: null,
    titleFee: null,
    productType: "NATIVE_ARTICLE",
    marketCode: "DE",
    rules: RULES,
  });
  assert.equal(fee, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm tsx --test src/lib/pricing/production-fee.test.ts`
Expected: FAIL — `Cannot find module './production-fee'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/pricing/production-fee.ts`:

```ts
// Content-production fee for the all-in catalog display price.
// Cascade — FIRST SET value wins (null/undefined = unset; an explicit 0
// is a valid value meaning "publisher includes production"):
//   1. Product.productionFee        (this offer)
//   2. Title.productionFeeDefault   (this publication)
//   3. ContentFeeRule.greenfieldFee (desk price list, /desk/content-fees;
//      most-specific active match via pickContentFeeRule)
//   4. 0 — no rule configured; the band still renders.
// The fee is added AFTER the margin (flat, not marked up) — see
// customerPrice() in display-price.ts.

import { pickContentFeeRule, type ContentFeeRuleSpec } from "@/lib/money";

export function resolveProductionFee(args: {
  productFee: number | null | undefined;
  titleFee: number | null | undefined;
  productType: string;
  marketCode: string;
  rules: ContentFeeRuleSpec[];
}): number {
  if (args.productFee != null) return args.productFee;
  if (args.titleFee != null) return args.titleFee;
  const rule = pickContentFeeRule(args.rules, args.productType, args.marketCode);
  return rule ? rule.greenfieldFee : 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm tsx --test src/lib/pricing/production-fee.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/production-fee.ts src/lib/pricing/production-fee.test.ts
git commit -m "feat(pricing): production-fee cascade over ContentFeeRule

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Schema columns + migration

**Files:**
- Modify: `prisma/schema.prisma` (Product model ~line 472–500, Title model ~line 312–470)
- Create: `prisma/migrations/20260611150000_production_fee_overrides/migration.sql`

- [ ] **Step 1: Add the columns to the schema**

In `prisma/schema.prisma`, in `model Product`, directly under the
`confirmedSource String?` line, add:

```prisma
  // Per-offer override of the content-production fee folded into the
  // displayed all-in band. Null = inherit (Title default → ContentFeeRule);
  // 0 = publisher includes production in basePrice.
  productionFee Decimal? @db.Decimal(12, 2)
```

In `model Title`, directly under the `pricesPublic` field, add:

```prisma
  // Publication-level default for the content-production fee. Null =
  // inherit from the desk ContentFeeRule price list.
  productionFeeDefault Decimal? @db.Decimal(12, 2)
```

- [ ] **Step 2: Hand-author the migration SQL**

(`prisma migrate dev` is blocked in this repo — migrations are hand-written
and applied by `migrate deploy` on deploy.)

Create `prisma/migrations/20260611150000_production_fee_overrides/migration.sql`:

```sql
-- Per-offer / per-publication overrides for the content-production fee
-- folded into the displayed all-in price band. Both nullable; null =
-- inherit (Title default -> ContentFeeRule desk price list).
ALTER TABLE "Product" ADD COLUMN "productionFee" DECIMAL(12,2);
ALTER TABLE "Title" ADD COLUMN "productionFeeDefault" DECIMAL(12,2);
```

- [ ] **Step 3: Regenerate the client and typecheck**

Run: `pnpm prisma generate && pnpm typecheck`
Expected: generate succeeds; typecheck passes (no consumers yet).

- [ ] **Step 4: Apply locally if a dev DB is configured**

Run: `pnpm prisma migrate deploy`
Expected: `1 migration applied` (or skip gracefully if no local DB —
deploy applies it in prod; do NOT block the task on this step).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260611150000_production_fee_overrides/migration.sql
git commit -m "feat(db): productionFee overrides on Product/Title

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Shared display-price helper (`display-price.ts`)

**Files:**
- Create: `src/lib/pricing/display-price.ts`
- Test: `src/lib/pricing/display-price.test.ts`

This is the single module every surface calls, so band selection cannot
drift between grid/detail/compare/API/CSV/JSON-LD.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pricing/display-price.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { customerPrice, productBand, titleBand } from "./display-price";
import type { ContentFeeRuleSpec } from "@/lib/money";

const RULES: ContentFeeRuleSpec[] = [
  {
    marketCode: "NO",
    productType: null,
    currency: "NOK",
    greenfieldFee: 2000,
    adaptationFee: null,
    active: true,
  },
];

const CONFIRMED = new Date("2026-06-01");

// Minimal structural fixtures — display-price must accept plain objects
// (Prisma Decimals arrive as `unknown`-ish; Number() at the boundary).
function product(over: Record<string, unknown> = {}) {
  return {
    active: true,
    confirmedAt: CONFIRMED,
    type: "NATIVE_ARTICLE",
    basePrice: 30_000,
    currency: "NOK",
    priceRules: [], // empty → DEFAULT_MARGIN_PCT (15%) applies
    productionFee: null,
    ...over,
  };
}

const TITLE = {
  pricesPublic: true,
  publisher: { pricesPublic: true },
  productionFeeDefault: null,
  market: { code: "NO" },
};

test("customerPrice = round(indicative) + resolved fee", () => {
  // 30_000 × 1.15 = 34_500 → + 2_000 ContentFeeRule = 36_500
  assert.equal(customerPrice(product(), TITLE, RULES), 36_500);
});

test("explicit productionFee 0 on the product suppresses the fee", () => {
  assert.equal(
    customerPrice(product({ productionFee: 0 }), TITLE, RULES),
    34_500,
  );
});

test("productBand is null for unconfirmed products", () => {
  assert.equal(
    productBand(product({ confirmedAt: null }), TITLE, RULES),
    null,
  );
});

test("productBand is null when publisher hides prices", () => {
  const hidden = { ...TITLE, publisher: { pricesPublic: false } };
  assert.equal(productBand(product(), hidden, RULES), null);
});

test("productBand bands the all-in customer price", () => {
  // 36_500 → NOK bucket 25–40k
  assert.deepEqual(productBand(product(), TITLE, RULES), {
    kind: "range",
    low: 25_000,
    high: 40_000,
  });
});

test("titleBand prefers NATIVE_ARTICLE over a cheaper display product", () => {
  // The bait-band regression guard: a 5k display must NOT produce the
  // card band when a 30k article is shown.
  const display = product({ type: "NATIVE_DISPLAY", basePrice: 5_000 });
  const article = product(); // 36_500 all-in
  const got = titleBand([display, article], TITLE, RULES);
  assert.ok(got);
  assert.equal(got.product.type, "NATIVE_ARTICLE");
  assert.deepEqual(got.band, { kind: "range", low: 25_000, high: 40_000 });
});

test("titleBand falls back to the cheapest shown product", () => {
  const a = product({ type: "ADVERTORIAL", basePrice: 80_000 });
  const b = product({ type: "NATIVE_DISPLAY", basePrice: 5_000 });
  const got = titleBand([a, b], TITLE, RULES);
  assert.ok(got);
  assert.equal(got.product.type, "NATIVE_DISPLAY");
});

test("titleBand skips hidden products when choosing", () => {
  const hiddenArticle = product({ confirmedAt: null });
  const shownDisplay = product({ type: "NATIVE_DISPLAY", basePrice: 5_000 });
  const got = titleBand([hiddenArticle, shownDisplay], TITLE, RULES);
  assert.ok(got);
  assert.equal(got.product.type, "NATIVE_DISPLAY");
});

test("titleBand is null when nothing is shown", () => {
  assert.equal(
    titleBand([product({ confirmedAt: null })], TITLE, RULES),
    null,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm tsx --test src/lib/pricing/display-price.test.ts`
Expected: FAIL — `Cannot find module './display-price'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/pricing/display-price.ts`:

```ts
// The one place that turns a catalog product into the buyer-facing
// price band. Every browse surface (grid card, title detail, compare,
// JSON API, CSV export, JSON-LD) goes through these helpers so band
// selection can never drift between surfaces.
//
// Exact figures live ONLY in the quote flow. Spec:
// docs/superpowers/specs/2026-06-11-catalog-price-bands-design.md

import {
  indicativeFromRules,
  toRateRules,
  type ContentFeeRuleSpec,
} from "@/lib/money";
import { isProductPriceShown, type TitleWithVisibility } from "./visibility";
import { priceBand, type Band } from "./bands";
import { resolveProductionFee } from "./production-fee";

// Structural types: Prisma rows satisfy these, and tests can pass plain
// objects. Decimal fields are `unknown` and converted at the boundary.
export type DisplayProduct = {
  active: boolean;
  confirmedAt: Date | null;
  type: string;
  basePrice: unknown;
  currency: string;
  priceRules: { marginPct: unknown; seasonalMultiplier: unknown; minVolume: number }[];
  productionFee?: unknown;
};

export type DisplayTitle = TitleWithVisibility & {
  productionFeeDefault?: unknown;
  market: { code: string };
};

function toNumberOrNull(v: unknown): number | null {
  return v == null ? null : Number(v);
}

// All-in customer price: marked-up indicative + flat production fee
// (the fee is NOT marked up — it is our cost-recovery, not inventory).
export function customerPrice(
  product: DisplayProduct,
  title: DisplayTitle,
  rules: ContentFeeRuleSpec[],
): number {
  const indicative = indicativeFromRules(
    Number(product.basePrice),
    toRateRules(product.priceRules),
  );
  const fee = resolveProductionFee({
    productFee: toNumberOrNull(product.productionFee),
    titleFee: toNumberOrNull(title.productionFeeDefault),
    productType: product.type,
    marketCode: title.market.code,
    rules,
  });
  return Math.round(indicative) + fee;
}

export function productBand(
  product: DisplayProduct,
  title: DisplayTitle,
  rules: ContentFeeRuleSpec[],
): Band | null {
  if (!isProductPriceShown(product, title)) return null;
  return priceBand(customerPrice(product, title, rules), product.currency);
}

// Card-level band. Prefer the NATIVE_ARTICLE product when one is shown
// (it is the category lead and what the buyer came for) — otherwise the
// cheapest shown product. Prevents a cheap display product producing a
// "< 15k" band that reads as bait next to a 35k article.
export function titleBand<P extends DisplayProduct>(
  products: P[],
  title: DisplayTitle,
  rules: ContentFeeRuleSpec[],
): { band: Band; product: P } | null {
  const shown = products.filter((p) => isProductPriceShown(p, title));
  if (shown.length === 0) return null;
  const pick =
    shown.find((p) => p.type === "NATIVE_ARTICLE") ??
    [...shown].sort(
      (a, b) =>
        customerPrice(a, title, rules) - customerPrice(b, title, rules),
    )[0];
  return {
    band: priceBand(customerPrice(pick, title, rules), pick.currency),
    product: pick,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm tsx --test src/lib/pricing/display-price.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Run the whole pricing suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all green (existing `visibility.test.ts`, `money.test.ts` etc. unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/lib/pricing/display-price.ts src/lib/pricing/display-price.test.ts
git commit -m "feat(pricing): shared display-band selection helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: i18n strings (en + 5 translations)

**Files:**
- Modify: `src/messages/en.json` (the `"priceVisibility"` block, ~line 1700)
- Modify: `src/messages/no.json`, `src/messages/da.json`, `src/messages/sv.json`, `src/messages/fi.json`, `src/messages/de.json` (same block in each)

- [ ] **Step 1: Add the English strings**

In `src/messages/en.json`, the block currently reads:

```json
"priceVisibility": {
  "requestPrice": "Contact for price",
  "requestPriceHelp": "Pricing on this title is set after a brief — we'll come back with availability and a firm number.",
  "planRfqOnly": "One or more titles in your plan require a quote — instant checkout is disabled until we confirm pricing."
},
```

Extend it to (keep the three existing keys verbatim):

```json
"priceVisibility": {
  "requestPrice": "Contact for price",
  "requestPriceHelp": "Pricing on this title is set after a brief — we'll come back with availability and a firm number.",
  "planRfqOnly": "One or more titles in your plan require a quote — instant checkout is disabled until we confirm pricing.",
  "listIndicative": "List price (indicative)",
  "listIndicativeHelp": "Indicative list rate — the final price is confirmed after a short brief.",
  "productionIncluded": "Includes written article",
  "firmTurnaround": "Firm price typically within 2 business days"
},
```

- [ ] **Step 2: Add the five translations**

Find the `"priceVisibility"` block in each file and append the same four
keys with these values (natural copy, not calques — repo standard):

`src/messages/no.json`:

```json
"listIndicative": "Listepris (veiledende)",
"listIndicativeHelp": "Veiledende listepris — endelig pris bekreftes etter en kort brief.",
"productionIncluded": "Ferdig skrevet artikkel inkludert",
"firmTurnaround": "Fast pris normalt innen 2 virkedager"
```

`src/messages/da.json`:

```json
"listIndicative": "Listepris (vejledende)",
"listIndicativeHelp": "Vejledende listepris — den endelige pris bekræftes efter en kort brief.",
"productionIncluded": "Færdigskrevet artikel inkluderet",
"firmTurnaround": "Fast pris typisk inden for 2 hverdage"
```

`src/messages/sv.json`:

```json
"listIndicative": "Listpris (indikativt)",
"listIndicativeHelp": "Indikativt listpris — det slutliga priset bekräftas efter en kort brief.",
"productionIncluded": "Färdigskriven artikel ingår",
"firmTurnaround": "Fast pris vanligtvis inom 2 arbetsdagar"
```

`src/messages/fi.json`:

```json
"listIndicative": "Listahinta (suuntaa-antava)",
"listIndicativeHelp": "Suuntaa-antava listahinta — lopullinen hinta vahvistetaan lyhyen briiffin jälkeen.",
"productionIncluded": "Sisältää valmiiksi kirjoitetun artikkelin",
"firmTurnaround": "Kiinteä hinta yleensä 2 arkipäivän kuluessa"
```

`src/messages/de.json`:

```json
"listIndicative": "Listenpreis (indikativ)",
"listIndicativeHelp": "Indikativer Listenpreis — der endgültige Preis wird nach einem kurzen Briefing bestätigt.",
"productionIncluded": "Fertig geschriebener Artikel inklusive",
"firmTurnaround": "Festpreis in der Regel innerhalb von 2 Werktagen"
```

- [ ] **Step 3: Verify JSON validity + typecheck**

Run: `pnpm tsx -e "for (const l of ['en','no','da','sv','fi','de']) { const m = require('./src/messages/' + l + '.json'); for (const k of ['listIndicative','listIndicativeHelp','productionIncluded','firmTurnaround']) { if (!m.priceVisibility?.[k]) throw new Error(l + ' missing ' + k); } } console.log('all locales ok')"`
Expected: `all locales ok`

- [ ] **Step 4: Commit**

```bash
git add src/messages/en.json src/messages/no.json src/messages/da.json src/messages/sv.json src/messages/fi.json src/messages/de.json
git commit -m "feat(i18n): price-band catalog strings, 6 locales

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Catalog grid — band display + whole-card click

**Files:**
- Modify: `src/app/[locale]/catalog/_components/CatalogResults.tsx`
- Modify: `src/app/globals.css` (`.catalog-card` rules at ~line 3514)

`CatalogResults` is an async **server component** — it may call
`loadContentFeeRules()` (DB) directly.

- [ ] **Step 1: Update imports and load fee rules**

In `CatalogResults.tsx`, replace the two import lines:

```ts
import { indicativeFromRules, toRateRules, formatMoney, intlLocale } from "@/lib/money";
import { isProductPriceShown } from "@/lib/pricing-visibility";
```

with:

```ts
import { intlLocale } from "@/lib/money";
import { isProductPriceShown } from "@/lib/pricing/visibility";
import { bandLabel } from "@/lib/pricing/bands";
import { titleBand } from "@/lib/pricing/display-price";
import { loadContentFeeRules } from "@/lib/content-fee";
```

Inside the component body, after the `getTranslations` calls, add:

```ts
const feeRules = await loadContentFeeRules();
```

- [ ] **Step 2: Replace the per-title price computation**

Inside `titles.map((title) => { … })`, the block currently reads:

```ts
// Per-product visibility: active + confirmedAt + pricesPublic flags
const visibleProducts = title.products.filter((p) =>
  isProductPriceShown(p, title),
);
const anyHidden = title.products.some(
  (p) => !isProductPriceShown(p, title),
);
const prices = visibleProducts.map((p) =>
  indicativeFromRules(
    Number(p.basePrice),
    toRateRules(p.priceRules),
  ),
);
const from = prices.length ? Math.min(...prices) : null;
const currency = title.products[0]?.currency ?? title.market.currency;
const needsQuote = title.products.length === 0;
```

Replace with:

```ts
// Per-product visibility: active + confirmedAt + pricesPublic flags.
// The card shows a bucket BAND, never an exact figure — exact prices
// exist only in the quote flow (see display-price.ts).
const visibleProducts = title.products.filter((p) =>
  isProductPriceShown(p, title),
);
const anyHidden = title.products.some(
  (p) => !isProductPriceShown(p, title),
);
const fromBand = titleBand(title.products, title, feeRules);
const needsQuote = title.products.length === 0;
```

(`visibleProducts` is still used by the FIRM-badge tag below — keep it.)

- [ ] **Step 3: Replace the price render block and mark the card link**

The title heading currently reads:

```tsx
<h3>
  <Link href={`/catalog/${title.slug}`}>{title.name}</Link>
</h3>
```

Replace with:

```tsx
<h3>
  <Link className="card-link" href={`/catalog/${title.slug}`}>
    {title.name}
  </Link>
</h3>
```

The price block at the bottom of the card currently reads:

```tsx
{from !== null ? (
  <div className="price">
    {t("card.from")} {formatMoney(from, currency, locale)}
  </div>
) : anyHidden ? (
  <div className="price muted">{tv("requestPrice")}</div>
) : null}
```

Replace with:

```tsx
{fromBand ? (
  <>
    <div className="price">
      ≈ {bandLabel(fromBand.band, fromBand.product.currency)}{" "}
      <span className="muted" title={tv("listIndicativeHelp")}>
        · {tv("listIndicative")}
      </span>
    </div>
    <div className="muted">✓ {tv("productionIncluded")}</div>
  </>
) : anyHidden ? (
  <div className="price muted">{tv("requestPrice")}</div>
) : null}
```

- [ ] **Step 4: Add the stretched-link CSS**

In `src/app/globals.css`, directly after the existing `.catalog-card {`
rule block (~line 3514), add:

```css
/* Whole-card click target: the title link stretches over the card via
   ::after; interactive children stay above it. */
.catalog-card {
  position: relative;
}
.catalog-card a.card-link::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
}
.catalog-card :is(input, button, label, select, a:not(.card-link)) {
  position: relative;
  z-index: 2;
}
```

(If the existing `.catalog-card` block already sets `position`, keep the
existing value only if it is already `relative`; otherwise this addition
wins by being later in the file — verify visually in Step 5.)

- [ ] **Step 5: Typecheck + lint + visual sanity**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.
If a local dev server + seeded DB are available: `pnpm dev` (NEVER port
3000 — use the project's configured port), open `/en/catalog` signed in,
verify: banded price on confirmed titles, "Contact for price" on
estimates, whole card clickable, compare checkbox still works.

- [ ] **Step 6: Commit**

```bash
git add src/app/[locale]/catalog/_components/CatalogResults.tsx src/app/globals.css
git commit -m "feat(catalog): band card prices, whole-card click

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Title detail page — bands, JSON-LD fix, turnaround note

**Files:**
- Modify: `src/app/[locale]/catalog/[slug]/page.tsx`

- [ ] **Step 1: Update imports and load fee rules**

Replace:

```ts
import { indicativeFromRules, toRateRules, formatMoney, intlLocale } from "@/lib/money";
import { isProductPriceShown, arePricesVisible } from "@/lib/pricing-visibility";
```

with:

```ts
import { intlLocale } from "@/lib/money";
import { isProductPriceShown, arePricesVisible } from "@/lib/pricing/visibility";
import { bandLabel } from "@/lib/pricing/bands";
import { productBand, titleBand } from "@/lib/pricing/display-price";
import { loadContentFeeRules } from "@/lib/content-fee";
```

After the `title` query + notFound guards, add:

```ts
const feeRules = await loadContentFeeRules();
```

(Check the file for other `formatMoney`/`indicativeFromRules` call sites
before removing the imports — if any remain elsewhere on the page, keep
those imports.)

- [ ] **Step 2: Fix the JSON-LD block (the worst leak)**

The block currently emits the exact marked-up price per product:

```ts
const ldOffers = title.products.map((p) => {
  const shown = isProductPriceShown(p, title);
  return shown
    ? {
        "@type": "Offer",
        name: p.name,
        priceCurrency: p.currency,
        price: indicativeFromRules(
          Number(p.basePrice),
          toRateRules(p.priceRules),
        ),
        availability: p.bookable
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
      }
    : {
        "@type": "Offer",
        name: p.name,
        priceCurrency: p.currency,
        availability: p.bookable
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
      };
});
const anyPriceVisible = title.products.some((p) =>
  isProductPriceShown(p, title),
);
const ld = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: title.name,
  category: title.category,
  brand: { "@type": "Brand", name: title.publisher.name },
  url: `${siteBase}/${locale}/catalog/${title.slug}`,
  offers: anyPriceVisible
    ? {
        "@type": "AggregateOffer",
        priceCurrency: title.market.currency,
        offers: ldOffers,
      }
    : { "@type": "AggregateOffer", offers: ldOffers },
};
```

Replace with:

```ts
// JSON-LD must NEVER carry an exact figure — structured data is the
// easiest scrape target on the site. Per-product Offers carry no price;
// the AggregateOffer carries the band bounds (valid schema.org, keeps
// discovery value).
const ldOffers = title.products.map((p) => ({
  "@type": "Offer",
  name: p.name,
  priceCurrency: p.currency,
  availability: p.bookable
    ? "https://schema.org/InStock"
    : "https://schema.org/OutOfStock",
}));
const anyPriceVisible = title.products.some((p) =>
  isProductPriceShown(p, title),
);
const ldBand = titleBand(title.products, title, feeRules);
const ld = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: title.name,
  category: title.category,
  brand: { "@type": "Brand", name: title.publisher.name },
  url: `${siteBase}/${locale}/catalog/${title.slug}`,
  offers: ldBand
    ? {
        "@type": "AggregateOffer",
        priceCurrency: ldBand.product.currency,
        ...(ldBand.band.kind !== "under" ? { lowPrice: ldBand.band.low } : {}),
        ...(ldBand.band.kind !== "over" ? { highPrice: ldBand.band.high } : {}),
        offers: ldOffers,
      }
    : { "@type": "AggregateOffer", offers: ldOffers },
};
```

(TypeScript narrowing note: `ldBand.band.kind !== "under"` narrows to
`range | over`, both of which have `low`; same logic for `high`. If the
spread-narrowing fights the compiler, lift the band into a
`const b = ldBand.band;` and build the object with explicit `if`s.)

- [ ] **Step 3: Band the per-product price block**

Inside `title.products.map((p) => { … })`, the block currently reads:

```tsx
const priceShown = isProductPriceShown(p, title);
const price = indicativeFromRules(
  Number(p.basePrice),
  toRateRules(p.priceRules),
);
```

Replace with:

```tsx
const band = productBand(p, title, feeRules);
```

And the render:

```tsx
{priceShown ? (
  <div className="price">
    {t("from")} {formatMoney(price, p.currency, locale)}
  </div>
) : (
  <div className="price muted">{tv("requestPrice")}</div>
)}
{priceShown && p.visibility === "FIRM" ? (
  <span className="tag">⚡ {tf("badge")}</span>
) : null}
```

becomes:

```tsx
{band ? (
  <>
    <div className="price">
      ≈ {bandLabel(band, p.currency)}{" "}
      <span className="muted" title={tv("listIndicativeHelp")}>
        · {tv("listIndicative")}
      </span>
    </div>
    <div className="muted">✓ {tv("productionIncluded")}</div>
  </>
) : (
  <div className="price muted">{tv("requestPrice")}</div>
)}
{band && p.visibility === "FIRM" ? (
  <span className="tag">⚡ {tf("badge")}</span>
) : null}
```

- [ ] **Step 4: Add the firm-turnaround note under Add-to-plan**

The bookable form currently ends:

```tsx
{p.bookable ? (
  <form action={addToPlan} style={{ marginTop: 12 }}>
    <input type="hidden" name="locale" value={locale} />
    <input type="hidden" name="productId" value={p.id} />
    <SubmitButton
      label={t("addToPlan")}
      pendingLabel={t("addingToPlan")}
    />
  </form>
) : (
  <p className="note">{t("unavailable")}</p>
)}
```

Replace with:

```tsx
{p.bookable ? (
  <>
    <form action={addToPlan} style={{ marginTop: 12 }}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="productId" value={p.id} />
      <SubmitButton
        label={t("addToPlan")}
        pendingLabel={t("addingToPlan")}
      />
    </form>
    {band ? <p className="note">{tv("firmTurnaround")}</p> : null}
  </>
) : (
  <p className="note">{t("unavailable")}</p>
)}
```

- [ ] **Step 5: Typecheck + verify**

Run: `pnpm typecheck && pnpm lint`
Expected: clean. If `formatMoney`/`indicativeFromRules`/`toRateRules` are
now unused in this file, the lint pass will say so — remove them from the
import.
View source of a detail page (if dev server available) and confirm the
`application/ld+json` block contains **no** `"price":` key, only
`lowPrice`/`highPrice` bucket bounds.

- [ ] **Step 6: Commit**

```bash
git add "src/app/[locale]/catalog/[slug]/page.tsx"
git commit -m "feat(catalog): band detail prices, fix JSON-LD leak

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Compare page — band the "from price" row

**Files:**
- Modify: `src/app/[locale]/catalog/compare/page.tsx`

- [ ] **Step 1: Update imports and load fee rules**

Same import swap as Tasks 6–7: drop `indicativeFromRules`, `toRateRules`,
`formatMoney` (keep what's still used elsewhere in the file — check), use
`@/lib/pricing/visibility`, and add:

```ts
import { bandLabel } from "@/lib/pricing/bands";
import { titleBand } from "@/lib/pricing/display-price";
import { loadContentFeeRules } from "@/lib/content-fee";
```

In the component body (server component), before the rows are computed:

```ts
const feeRules = await loadContentFeeRules();
```

- [ ] **Step 2: Replace the row precomputation**

The rows block currently reads:

```ts
const rows = ordered.map((title) => {
  const visibleProducts = title.products.filter((p) =>
    isProductPriceShown(p, title),
  );
  const anyHidden = title.products.some(
    (p) => !isProductPriceShown(p, title),
  );
  const prices = visibleProducts.map((p) =>
    indicativeFromRules(
      Number(p.basePrice),
      toRateRules(p.priceRules),
    ),
  );
  const from = prices.length ? Math.min(...prices) : null;
  const cur = title.products[0]?.currency ?? title.market.currency;
  const leadMin = title.products.length
    ? Math.min(...title.products.map((p) => p.leadTimeDays))
    : null;
  return { title, anyHidden, from, cur, leadMin };
});
```

Replace with:

```ts
const rows = ordered.map((title) => {
  const anyHidden = title.products.some(
    (p) => !isProductPriceShown(p, title),
  );
  const fromBand = titleBand(title.products, title, feeRules);
  const leadMin = title.products.length
    ? Math.min(...title.products.map((p) => p.leadTimeDays))
    : null;
  return { title, anyHidden, fromBand, leadMin };
});
```

(If `visibleProducts` is referenced elsewhere in the row spec — check —
keep computing it.)

- [ ] **Step 3: Replace the price cell**

```tsx
{rows.map(({ title, from, cur, anyHidden }) => (
  <td key={title.id} className="num">
    {from !== null ? (
      <span className="price">
        {formatMoney(from, cur, locale)}
      </span>
    ) : anyHidden ? (
      <span className="muted">{tv("requestPrice")}</span>
    ) : (
      <span className="muted">—</span>
    )}
  </td>
))}
```

becomes:

```tsx
{rows.map(({ title, fromBand, anyHidden }) => (
  <td key={title.id} className="num">
    {fromBand ? (
      <span className="price">
        ≈ {bandLabel(fromBand.band, fromBand.product.currency)}
      </span>
    ) : anyHidden ? (
      <span className="muted">{tv("requestPrice")}</span>
    ) : (
      <span className="muted">—</span>
    )}
  </td>
))}
```

(Other destructurings of `from`/`cur` in this file must be updated to
`fromBand` too — search the file for `from,` and `cur` after editing.)

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/catalog/compare/page.tsx"
git commit -m "feat(catalog): band compare-table prices

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: JSON API — close the raw-cost leak

**Files:**
- Modify: `src/app/api/v1/catalog/titles/route.ts`

Today the route returns `basePriceIndicative: Number(p.basePrice)` — the
**raw net publisher cost**, un-marked-up. Breaking change to the v1
contract: `basePriceIndicative` is removed, `priceBand` (string label)
added. This is deliberate (spec decision #6).

- [ ] **Step 1: Update imports + query**

Add imports:

```ts
import { bandLabel } from "@/lib/pricing/bands";
import { productBand } from "@/lib/pricing/display-price";
import { loadContentFeeRules } from "@/lib/content-fee";
```

In the `products` select inside the `prisma.title.findMany`, the select
currently lists:

```ts
select: {
  id: true,
  type: true,
  basePrice: true,
  currency: true,
  visibility: true,
  leadTimeDays: true,
  active: true,
  confirmedAt: true,
},
```

Extend it with the fields band math needs:

```ts
select: {
  id: true,
  type: true,
  basePrice: true,
  currency: true,
  visibility: true,
  leadTimeDays: true,
  active: true,
  confirmedAt: true,
  productionFee: true,
  priceRules: {
    select: { marginPct: true, seasonalMultiplier: true, minVolume: true },
  },
},
```

(The title-level `include` already returns all Title scalars, so
`productionFeeDefault` arrives automatically. `market.code` is already in
the market select.)

After auth + rate-limit checks, before the response mapping, add:

```ts
const feeRules = await loadContentFeeRules();
```

- [ ] **Step 2: Replace the product serialization**

```ts
products: t.products.map((p) => {
  const shown = isProductPriceShown(p, t);
  return {
    id: p.id,
    type: p.type,
    basePriceIndicative: shown ? Number(p.basePrice) : null,
    currency: p.currency,
    visibility: shown ? p.visibility : "INDICATIVE",
    leadTimeDays: p.leadTimeDays,
  };
}),
```

becomes:

```ts
products: t.products.map((p) => {
  // Band, never a figure — and NEVER the raw basePrice (net cost).
  const band = productBand(p, t, feeRules);
  return {
    id: p.id,
    type: p.type,
    priceBand: band ? bandLabel(band, p.currency) : null,
    currency: p.currency,
    visibility: band ? p.visibility : "INDICATIVE",
    leadTimeDays: p.leadTimeDays,
  };
}),
```

(`isProductPriceShown` may now be unused in the mapping except for
`anyPriceVisible` — keep that usage.)

- [ ] **Step 3: Typecheck + grep regression guard**

Run: `pnpm typecheck && grep -rn "basePriceIndicative" src/`
Expected: typecheck clean; grep returns **no hits** (contract consumers in
docs are out of scope; if a hit appears in another source file, update it
the same way).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/catalog/titles/route.ts
git commit -m "fix(api): catalog returns price band, not net cost

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: CSV export — close the downloadable-price-sheet hole

**Files:**
- Modify: `src/app/api/export/catalog.csv/route.ts`

Today `indicative_price` is `String(lowest.basePrice)` — raw net cost,
one click, any signed-in user.

- [ ] **Step 1: Update imports + query**

Add imports:

```ts
import { bandLabel } from "@/lib/pricing/bands";
import { titleBand } from "@/lib/pricing/display-price";
import { loadContentFeeRules } from "@/lib/content-fee";
```

Change the visibility import from `@/lib/pricing-visibility` to
`@/lib/pricing/visibility`.

In the products select, add the two band-math fields:

```ts
products: {
  where: { active: true },
  select: {
    id: true,
    type: true,
    basePrice: true,
    currency: true,
    visibility: true,
    leadTimeDays: true,
    active: true,
    confirmedAt: true,
    productionFee: true,
    priceRules: {
      select: { marginPct: true, seasonalMultiplier: true, minVolume: true },
    },
  },
},
```

The route's title-level `include` already includes Title scalars
(`productionFeeDefault`) and `market: { select: { code: … } }`.

Before the rows mapping:

```ts
const feeRules = await loadContentFeeRules();
```

- [ ] **Step 2: Replace the price columns**

The row mapping currently computes `lowest` and emits:

```ts
const shownProducts = t.products.filter((p) => isProductPriceShown(p, t));
const lowest = shownProducts
  .filter((p) => p.basePrice != null)
  .sort((a, b) => Number(a.basePrice) - Number(b.basePrice))[0];
```

and columns:

```ts
indicative_price: lowest?.basePrice != null ? String(lowest.basePrice) : "",
indicative_price_currency: lowest?.currency ?? "",
indicative_price_format: lowest?.type ?? "",
lead_time_days: lowest?.leadTimeDays ?? "",
```

Replace the `lowest` computation with:

```ts
// Same band selection as the catalog card (NATIVE_ARTICLE preferred,
// else cheapest). Never the exact figure — and never raw basePrice.
const fromBand = titleBand(t.products, t, feeRules);
```

and the columns with:

```ts
price_band: fromBand ? bandLabel(fromBand.band, fromBand.product.currency) : "",
price_band_currency: fromBand?.product.currency ?? "",
price_band_format: fromBand?.product.type ?? "",
lead_time_days: fromBand?.product.leadTimeDays ?? "",
```

(The `shownProducts` const becomes unused — remove it.)

- [ ] **Step 3: Typecheck + grep regression guard**

Run: `pnpm typecheck && grep -n "indicative_price\|basePrice" src/app/api/export/catalog.csv/route.ts`
Expected: typecheck clean; grep shows `basePrice: true` only in the Prisma
select (input), no `indicative_price` column, and no `String(...basePrice)`
in the output mapping.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/export/catalog.csv/route.ts
git commit -m "fix(export): CSV ships price band, not net cost

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: ALL tests pass — the new bands/production-fee/display-price
suites plus every pre-existing suite (especially `visibility.test.ts`,
`money.test.ts`, `quotes.test.ts` — the quote flow must be untouched).

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 3: Exact-figure leak sweep**

Run: `grep -rn "formatMoney\|indicativeFromRules" "src/app/[locale]/catalog" src/app/api/v1/catalog src/app/api/export`
Expected: NO hit that renders an exact catalog price to a buyer browse
surface. (Hits inside the quote/desk/plan flows elsewhere in the app are
fine — exact prices belong there.)

- [ ] **Step 4: Commit anything outstanding & report**

```bash
git status --short   # should be clean
git log --oneline main..HEAD
```

Report: list every commit on the branch, test counts, and the three leak
fixes (API, CSV, JSON-LD) explicitly for the PR description.

---

## Explicitly NOT in this plan (ops, after merge)

1. **Apply the ~50 pending PriceQuotes** (desk flow / `native_apply_quote`) —
   this is what actually lights up bands on real titles. Where a quote says
   the publisher includes production, set that product's `productionFee = 0`.
2. **Set real production fees** in `/desk/content-fees` (current rows are
   12 000 kr seed placeholders; Andreas wants ~2 000 NOK for NO).
3. **Confirm the 2-business-day firm-quote turnaround** (it's now in
   buyer-facing copy — decision #8).
4. **Notify API partners** of the v1 contract change
   (`basePriceIndicative` → `priceBand`).
