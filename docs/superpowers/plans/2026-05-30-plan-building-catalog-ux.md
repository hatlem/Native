# Plan-building & Catalog UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it easy to go from an empty plan to a real brief — guide discovery with a budget+market recommendation panel, add a Category filter to the catalog, and fix two plan-page defects (static quantity, oversized request-price totals).

**Architecture:** Pure, testable decision functions in `src/lib/` (recommendation tiering, quantity clamp) wrapped by thin server actions / server-component queries. UI changes are server-rendered, query-param driven (no client JS added), mirroring the existing catalog filter + plan patterns. Reuses `recommendMix`, `indicativeFromRules`, `arePricesVisible`.

**Tech Stack:** Next.js App Router, Prisma + PostgreSQL, next-intl, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-05-30-plan-building-catalog-ux-design.md`

---

## File Structure

**Create:** none (all changes extend existing files + tests).
**Modify:**
- `src/lib/basket.ts` — add pure `clampQuantity`.
- `src/lib/basket.test.ts` — create if absent; test `clampQuantity`.
- `src/app/actions.ts` — add `setQuantity` server action.
- `src/lib/recommend.ts` — add `recommendTiered` + tier-2 types.
- `src/lib/recommend.test.ts` — extend for tiering.
- `src/app/[locale]/plan/page.tsx` — quantity stepper, sidebar pricing cleanup, empty-state recommend panel + recommended-mix render.
- `src/app/[locale]/catalog/page.tsx` — Category (`vertical`) filter param/where/options/chips.
- `src/app/[locale]/catalog/_components/CatalogFilters.tsx` — Category multi-select; move B2B/B2C to main row.
- `src/messages/{en,no,sv,da,fi,de}.json` — new keys.

**Constants used across tasks:** `MAX_QTY = 20`, `SUPPLEMENTARY_CAP = 6`.

---

## Task 1: Pure `clampQuantity`

**Files:**
- Modify: `src/lib/basket.ts`
- Test: `src/lib/basket.test.ts` (create if missing)

- [ ] **Step 1: Write the failing test**

Create/append `src/lib/basket.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { clampQuantity, MAX_QTY } from "./basket";

test("clampQuantity floors at 1", () => {
  assert.equal(clampQuantity(0), 1);
  assert.equal(clampQuantity(-3), 1);
  assert.equal(clampQuantity(NaN), 1);
});
test("clampQuantity caps at MAX_QTY", () => {
  assert.equal(MAX_QTY, 20);
  assert.equal(clampQuantity(21), 20);
  assert.equal(clampQuantity(999), 20);
});
test("clampQuantity passes valid values through, truncating", () => {
  assert.equal(clampQuantity(1), 1);
  assert.equal(clampQuantity(5), 5);
  assert.equal(clampQuantity(3.7), 3);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test 2>&1 | tail -5`
Expected: FAIL — `clampQuantity` / `MAX_QTY` not exported from `./basket`.

- [ ] **Step 3: Implement** — add to the top of `src/lib/basket.ts` (after the cookie constants, before `BasketItem`):
```typescript
export const MAX_QTY = 20;

// Clamp an untrusted quantity into [1, MAX_QTY]; non-finite → 1.
export function clampQuantity(n: number): number {
  const t = Math.trunc(Number(n));
  if (!Number.isFinite(t) || t < 1) return 1;
  return Math.min(t, MAX_QTY);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test 2>&1 | tail -5`
Expected: PASS (basket tests green; suite still passing).

- [ ] **Step 5: Commit**
```bash
git add src/lib/basket.ts src/lib/basket.test.ts
git commit -m "feat(plan): pure clampQuantity helper"
```

---

## Task 2: `setQuantity` server action

**Files:**
- Modify: `src/app/actions.ts`

- [ ] **Step 1: Update the basket import** — in `src/app/actions.ts` the existing import from `@/lib/basket` lists `readBasket, serializeBasket, ...`. Add `clampQuantity`:
```typescript
import {
  PLAN_COOKIE,
  PLAN_BRIEF_COOKIE,
  planBriefHasContent,
  readBasket,
  serializeBasket,
  serializePlanBrief,
  clampQuantity,
  type BasketItem,
} from "@/lib/basket";
```

- [ ] **Step 2: Add the action** — after `removeFromPlan` (~line 116) in `src/app/actions.ts`:
```typescript
// Set the quantity for one plan line directly (the plan-page stepper).
// addToPlan keeps incrementing on catalog re-add; this lets the buyer
// set an exact value. Clamped to [1, MAX_QTY]; never removes a line
// (Remove is its own action).
export async function setQuantity(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const productId = str(formData, "productId");
  const qty = clampQuantity(Number(str(formData, "quantity")));
  if (productId) {
    const items = await readBasket();
    const existing = items.find((i) => i.productId === productId);
    if (existing) {
      existing.quantity = qty;
      await writeBasket(items);
    }
  }
  redirect(`/${locale}/plan`);
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck 2>&1 | tail -3`
Expected: PASS.

- [ ] **Step 4: Commit**
```bash
git add src/app/actions.ts
git commit -m "feat(plan): setQuantity server action"
```

---

## Task 3: Quantity stepper on plan lines

**Files:**
- Modify: `src/app/[locale]/plan/page.tsx`

- [ ] **Step 1: Import `setQuantity`** — extend the existing actions import:
```typescript
import { removeFromPlan, submitRequest, setQuantity } from "@/app/actions";
```

- [ ] **Step 2: Replace the static qty line + remove cluster** — find the plan-line block (the `lines.map`, ~183-215). Replace the `<div className="sub">{t("qty")}: {l.quantity}</div>` and the `cluster tight` block with a stepper. The new line body:
```tsx
                <div className="item plan-item" key={l.product.id}>
                  <span className="tag">{tType(l.product.type)}</span>
                  <div>
                    <div className="title">{l.product.title.name}</div>
                    <div className="sub plan-qty">
                      <form action={setQuantity} className="plan-qty-step">
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="productId" value={l.product.id} />
                        <input type="hidden" name="quantity" value={l.quantity - 1} />
                        <button type="submit" className="btn small ghost" aria-label={t("decrement")} disabled={l.quantity <= 1}>−</button>
                      </form>
                      <span aria-live="polite">{t("qty")}: {l.quantity}</span>
                      <form action={setQuantity} className="plan-qty-step">
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="productId" value={l.product.id} />
                        <input type="hidden" name="quantity" value={l.quantity + 1} />
                        <button type="submit" className="btn small ghost" aria-label={t("increment")}>+</button>
                      </form>
                    </div>
                  </div>
                  <div className="cluster tight">
                    {l.priceVisible ? (
                      <span className="price plan-line-price">
                        {formatMoney(l.lineTotal, l.product.currency, locale)}
                      </span>
                    ) : (
                      <span className="muted small plan-line-price">
                        {tv("requestPrice")}
                      </span>
                    )}
                    <form action={removeFromPlan}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="productId" value={l.product.id} />
                      <button type="submit" className="btn small ghost">
                        {t("remove")}
                      </button>
                    </form>
                  </div>
                </div>
```
(The `−` at `quantity <= 1` is disabled, so it never drops below 1; `clampQuantity` is the server-side backstop.)

- [ ] **Step 3: Add `decrement`/`increment` keys** to the `plan` namespace in all 6 `src/messages/*.json` (next to `"qty"`):
  - en: `"decrement": "Decrease quantity"`, `"increment": "Increase quantity"`
  - no: `"Færre"`, `"Flere"` → use `"decrement": "Færre"`, `"increment": "Flere"` (or "Reduser antall"/"Øk antall")
  - sv: `"Färre"` / `"Fler"`; da: `"Færre"` / `"Flere"`; fi: `"Vähennä määrää"` / `"Lisää määrää"`; de: `"Menge verringern"` / `"Menge erhöhen"`.
  (These are aria-labels — keep them natural per locale.)

- [ ] **Step 4: Add minimal stepper styling** — append to `src/app/globals.css` (only if `.plan-qty-step`/`.plan-qty` aren't already styled):
```css
.plan-qty { display: inline-flex; align-items: center; gap: 6px; }
.plan-qty-step { display: inline; }
.plan-qty-step .btn.small { min-width: 28px; padding: 2px 8px; }
```

- [ ] **Step 5: Typecheck + build**

Run: `pnpm typecheck 2>&1 | tail -3 && pnpm build 2>&1 | tail -3`
Expected: PASS; `/[locale]/plan` compiles.

- [ ] **Step 6: Commit**
```bash
git add "src/app/[locale]/plan/page.tsx" src/messages src/app/globals.css
git commit -m "feat(plan): quantity stepper on plan lines"
```

---

## Task 4: Sidebar pricing cleanup

**Files:**
- Modify: `src/app/[locale]/plan/page.tsx`

- [ ] **Step 1: Replace the totals render** — find the `.plan-summary-total` block (~222-242). Replace it so only currencies with a visible amount render a big `.price` figure, and hidden-price items collapse to ONE compact note. New markup:
```tsx
              <div className="plan-summary-total">
                {totals
                  .filter(([, r]) => r.hasVisible)
                  .map(([cur, r]) => (
                    <div className="price" key={cur}>
                      {formatMoney(r.amount, cur, locale)}
                      {r.hasHidden ? (
                        <span className="muted small"> + {tv("requestPrice")}</span>
                      ) : null}
                    </div>
                  ))}
                {hasHiddenPrice && !totals.some(([, r]) => r.hasVisible) ? (
                  <div className="muted small">{t("pricingOnRequest")}</div>
                ) : null}
              </div>
```
Rationale: if any currency has a real figure, the `+ request price` suffix already signals the hidden ones — no giant per-currency "Contact for price" rows. If NOTHING has a visible price, show a single muted "Pricing on request" line (no huge figures). `hasHiddenPrice` already exists (computed ~85).

- [ ] **Step 2: Add the `pricingOnRequest` key** to the `plan` namespace in all 6 `src/messages/*.json`:
  - en: `"pricingOnRequest": "Pricing on request — firm quote in 24 h"`
  - no: `"Pris på forespørsel — fast tilbud innen 24 t"`
  - sv: `"Pris på begäran — fast offert inom 24 h"`
  - da: `"Pris på forespørgsel — fast tilbud inden 24 t"`
  - fi: `"Hinta pyynnöstä — sitova tarjous 24 t kuluessa"`
  - de: `"Preis auf Anfrage — verbindliches Angebot in 24 Std."`

- [ ] **Step 3: Typecheck + build**

Run: `pnpm typecheck 2>&1 | tail -3 && pnpm build 2>&1 | tail -3`
Expected: PASS.

- [ ] **Step 4: Commit**
```bash
git add "src/app/[locale]/plan/page.tsx" src/messages
git commit -m "fix(plan): collapse hidden-price totals to one compact line"
```

---

## Task 5: Pure recommendation tiering

**Files:**
- Modify: `src/lib/recommend.ts`
- Test: `src/lib/recommend.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/lib/recommend.test.ts` (reuse the existing `c()` helper for priced candidates):
```typescript
import { recommendTiered, type SupplementaryTitle } from "./recommend";

const sup = (id: string, reach: number): SupplementaryTitle => ({
  titleId: `t-${id}`,
  titleName: id,
  productId: `p-${id}`,
  reach,
  currency: "NOK",
});

test("recommendTiered: tier1 packs to budget, tier2 fills from unpriced by reach", () => {
  const priced = [c("a", "Alpha", 100, 40), c("b", "Beta", 90, 50)];
  const unpriced = [sup("x", 200), sup("y", 50), sup("z", 300)];
  const r = recommendTiered(priced, unpriced, 60, { supplementaryCap: 2 });
  assert.deepEqual(r.picks.map((p) => p.titleName), ["Alpha"]); // 40 fits, 50 would exceed 60 after 40
  assert.deepEqual(r.supplementary.map((s) => s.titleName), ["z", "x"]); // top-2 reach
});

test("recommendTiered: excludes already-picked titles from supplementary", () => {
  const priced = [c("a", "Alpha", 100, 40)];
  const unpriced = [sup("Alpha", 999), sup("y", 10)];
  const r = recommendTiered(priced, unpriced, 100);
  // 't-Alpha' is picked in tier1 → not repeated in tier2
  assert.ok(!r.supplementary.some((s) => s.titleId === "t-Alpha"));
  assert.deepEqual(r.supplementary.map((s) => s.titleName), ["y"]);
});

test("recommendTiered: no budget (MAX_SAFE) returns all priced + supplementary", () => {
  const priced = [c("a", "Alpha", 100, 40), c("b", "Beta", 90, 50)];
  const r = recommendTiered(priced, [sup("x", 5)], Number.MAX_SAFE_INTEGER);
  assert.equal(r.picks.length, 2);
  assert.deepEqual(r.supplementary.map((s) => s.titleName), ["x"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test 2>&1 | tail -5`
Expected: FAIL — `recommendTiered` / `SupplementaryTitle` not exported.

- [ ] **Step 3: Implement** — append to `src/lib/recommend.ts`:
```typescript
export type SupplementaryTitle = {
  titleId: string;
  titleName: string;
  productId: string;
  reach: number;
  currency: string;
};

export type TieredRecommendation = {
  picks: Candidate[];
  supplementary: SupplementaryTitle[];
  totalCost: number;
  totalReach: number;
};

// Tier 1: budget-optimized priced picks (reach-per-€) via recommendMix.
// Tier 2: top-reach unpriced titles (excluding titles already picked),
// capped. Pass Number.MAX_SAFE_INTEGER as budget when the buyer gave no
// budget — recommendMix then returns all priced titles, one per title.
export function recommendTiered(
  priced: Candidate[],
  unpriced: SupplementaryTitle[],
  budget: number,
  opts?: { supplementaryCap?: number },
): TieredRecommendation {
  const cap = opts?.supplementaryCap ?? 6;
  const base = recommendMix(priced, budget);
  const pickedTitleIds = new Set(base.picks.map((p) => p.titleId));
  const supplementary = [...unpriced]
    .filter((s) => !pickedTitleIds.has(s.titleId))
    .sort((a, b) => b.reach - a.reach || a.titleName.localeCompare(b.titleName))
    .slice(0, cap);
  return {
    picks: base.picks,
    supplementary,
    totalCost: base.totalCost,
    totalReach: base.totalReach,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/recommend.ts src/lib/recommend.test.ts
git commit -m "feat(plan): recommendTiered — budget picks + reach-ranked supplements"
```

---

## Task 6: Empty-state brief → recommend panel

**Files:**
- Modify: `src/app/[locale]/plan/page.tsx`

This is the largest task. The panel + recommendation render only when the basket is empty.

- [ ] **Step 1: Add imports** to `plan/page.tsx`:
```typescript
import { recommendTiered, type Candidate, type SupplementaryTitle } from "@/lib/recommend";
import { arePricesVisible } from "@/lib/pricing/visibility";
import { addToPlan } from "@/app/actions";
import { MARKET_CODES } from "@/lib/markets"; // verify the actual export used by catalog/page.tsx for the 9 market codes
```
(Confirm `MARKET_CODES` import path matches what `catalog/page.tsx` imports — reuse the same source.)

- [ ] **Step 2: Read recommend params + build candidates** — in the component, after `const briefDraft = await readPlanBrief();` and the `basket`/`products` load, add (runs only when basket is empty):
```typescript
  // Empty-state recommendation: budget + market → tiered title suggestions.
  const recMarketRaw = typeof sp.recMarket === "string" ? sp.recMarket : "";
  const recBudgetRaw = typeof sp.recBudget === "string" ? sp.recBudget : "";
  const recMarket = (MARKET_CODES as readonly string[]).includes(recMarketRaw)
    ? recMarketRaw
    : "";
  const recBudget = Number(recBudgetRaw) > 0 ? Number(recBudgetRaw) : 0;
  const homeMarket =
    activeOrg && ws?.activeOrgId
      ? (await prisma.organization.findUnique({
          where: { id: ws.activeOrgId },
          select: { marketCode: true },
        }))?.marketCode ?? null
      : null;

  let rec: { picks: Candidate[]; supplementary: SupplementaryTitle[] } | null = null;
  if (basket.length === 0 && recMarket) {
    const recProducts = await prisma.product.findMany({
      where: {
        active: true,
        bookable: true,
        title: { active: true, market: { code: recMarket } },
      },
      include: {
        title: { include: { publisher: { select: { pricesPublic: true } }, market: { select: { currency: true } } } },
        priceRules: true,
      },
    });
    const priced: Candidate[] = [];
    const unpricedByTitle = new Map<string, SupplementaryTitle>();
    for (const p of recProducts) {
      const reach = p.title.digitalReach ?? p.title.monthlyReach ?? 0;
      const currency = p.currency ?? p.title.market?.currency ?? "EUR";
      if (arePricesVisible(p.title)) {
        priced.push({
          productId: p.id,
          titleId: p.titleId,
          titleName: p.title.name,
          category: p.title.category,
          type: p.type,
          reach,
          unitPrice: indicativeFromRules(Number(p.basePrice), toRateRules(p.priceRules)),
        });
      } else if (!unpricedByTitle.has(p.titleId)) {
        unpricedByTitle.set(p.titleId, {
          titleId: p.titleId,
          titleName: p.title.name,
          productId: p.id,
          reach,
          currency,
        });
      }
    }
    rec = recommendTiered(
      priced,
      [...unpricedByTitle.values()],
      recBudget > 0 ? recBudget : Number.MAX_SAFE_INTEGER,
    );
  }
```
Note: `digitalReach`/`monthlyReach`/`bookable` exist on the schema (confirm field names against `prisma/schema.prisma` — `bookable` is used in `recommend/page.tsx`). If `digitalReach` is absent, use `monthlyReach ?? 0`.

- [ ] **Step 3: Render the panel + recommendations in the empty branch** — replace the `EmptyState` block (~157-164) with:
```tsx
      {lines.length === 0 ? (
        <div className="plan-start">
          <form className="plan-start-form" method="get">
            <h2>{t("startTitle")}</h2>
            <p className="muted small">{t("startLead")}</p>
            <div className="field">
              <label htmlFor="recMarket">{tr("market")}</label>
              <select id="recMarket" name="recMarket" defaultValue={recMarket || homeMarket || ""}>
                {MARKET_CODES.map((m) => (
                  <option key={m} value={m}>{tMarket(m)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="recBudget">{tr("budget")}</label>
              <input id="recBudget" name="recBudget" type="number" min="0" defaultValue={recBudgetRaw} />
            </div>
            <SubmitButton label={t("recommend")} pendingLabel={t("recommending")} />
            <Link href="/catalog" className="link small">{t("browse")}</Link>
          </form>

          {rec ? (
            <div className="plan-start-results">
              {rec.picks.length > 0 ? (
                <>
                  <h3>{t("recForBudget")}</h3>
                  <div className="action-list">
                    {rec.picks.map((p) => (
                      <div className="item" key={p.productId}>
                        <div>
                          <div className="title">{p.titleName}</div>
                          <div className="sub muted small">{formatMoney(p.unitPrice, "EUR", locale)} · {p.reach.toLocaleString(locale)} {t("reach")}</div>
                        </div>
                        <form action={addToPlan}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="productId" value={p.productId} />
                          <button type="submit" className="btn small">{t("add")}</button>
                        </form>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
              {rec.supplementary.length > 0 ? (
                <>
                  <h3>{t("recAlsoConsider")}</h3>
                  <div className="action-list">
                    {rec.supplementary.map((s) => (
                      <div className="item" key={s.productId}>
                        <div>
                          <div className="title">{s.titleName}</div>
                          <div className="sub muted small">{tv("requestPrice")} · {s.reach.toLocaleString(locale)} {t("reach")}</div>
                        </div>
                        <form action={addToPlan}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="productId" value={s.productId} />
                          <button type="submit" className="btn small ghost">{t("add")}</button>
                        </form>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
              {rec.picks.length === 0 && rec.supplementary.length === 0 ? (
                <p className="muted small">{t("recNone")}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
```
(Currency on Tier-1 rows: the spec keeps it simple — indicative figures are shown; if a per-currency label is needed, use `rec` candidates' market currency. Using "EUR" placeholder is acceptable only if all rec markets share currency; PREFER threading `currency` onto `Candidate` is out of scope — instead show the figure with the market's currency by reading it from the first product. If unclear, omit the currency symbol and show the number with `formatMoney(p.unitPrice, recCurrency, locale)` where `recCurrency` is captured in Step 2 from `recProducts[0].currency`.)

  > **Refine in Step 2:** also capture `const recCurrency = recProducts[0]?.currency ?? "EUR";` and use it in the Tier-1 `formatMoney(p.unitPrice, recCurrency, locale)` call instead of the "EUR" literal.

- [ ] **Step 4: Add `plan` i18n keys** (all 6 locales): `startTitle`, `startLead`, `recommend`, `recommending`, `recForBudget`, `recAlsoConsider`, `reach`, `add`, `recNone`.
  - en: `"startTitle": "Start your campaign"`, `"startLead": "Tell us your market and budget — we'll suggest titles to build your brief around."`, `"recommend": "Recommend titles"`, `"recommending": "Finding titles…"`, `"recForBudget": "Recommended for your budget"`, `"recAlsoConsider": "Also worth considering"`, `"reach": "monthly reach"`, `"add": "Add to plan"`, `"recNone": "No titles in that market yet — browse the full catalog."`
  - Translate naturally for no/sv/da/fi/de (Norwegian e.g. `startTitle`: "Start kampanjen din"; `recommend`: "Foreslå titler"; `add`: "Legg til i planen"; `recForBudget`: "Anbefalt for budsjettet ditt"; `recAlsoConsider`: "Verdt å vurdere også"; `reach`: "månedlig rekkevidde"). No English in foreign files.

- [ ] **Step 5: Minimal styling** — append to `globals.css` if needed:
```css
.plan-start { max-width: 560px; }
.plan-start-form { display: grid; gap: 12px; }
.plan-start-results { margin-top: 20px; display: grid; gap: 16px; }
```

- [ ] **Step 6: Typecheck + build**

Run: `pnpm typecheck 2>&1 | tail -3 && pnpm build 2>&1 | tail -3`
Expected: PASS; `/[locale]/plan` compiles.

- [ ] **Step 7: Commit**
```bash
git add "src/app/[locale]/plan/page.tsx" src/messages src/app/globals.css
git commit -m "feat(plan): empty-state brief→recommend panel (budget+market, tiered)"
```

---

## Task 7: Catalog Category (vertical) filter + promote B2B/B2C

**Files:**
- Modify: `src/app/[locale]/catalog/page.tsx`, `src/app/[locale]/catalog/_components/CatalogFilters.tsx`, `src/messages/*.json`

- [ ] **Step 1: Parse the `vertical` param** — in `catalog/page.tsx`, alongside the `types` parsing (~95), add:
```typescript
  const verticalsRaw = typeof sp.vertical === "string" ? sp.vertical : "";
  const verticals = verticalsRaw.split(",").map((s) => s.trim()).filter(Boolean);
```

- [ ] **Step 2: Add to the `where`** — in the `where` object (~116-143), add after the `types` clause:
```typescript
    ...(verticals.length ? { vertical: { in: verticals } } : {}),
```

- [ ] **Step 3: Compute distinct vertical options** — near the existing parallel queries (the `[totalCount, titles]` Promise.all, ~145), add a query for the dropdown options:
```typescript
  const verticalRows = await prisma.title.findMany({
    where: { active: true, vertical: { not: null } },
    select: { vertical: true },
    distinct: ["vertical"],
    orderBy: { vertical: "asc" },
  });
  const verticalOptions = verticalRows
    .map((r) => r.vertical!)
    .filter((v) => v.trim().length > 0);
```

- [ ] **Step 4: Thread into `pageQuery`, `filterHref`, `activeFilters`, and the component props.**
  - In `pageQuery` (~177): add `if (verticals.length) params.set("vertical", verticals.join(","));`
  - In the `FilterKey` union add `"vertical"`; in `filterHref` add a `dropVertical?: string` extra and a block mirroring `types`:
    ```typescript
    if (except !== "vertical") {
      const keep = extra?.dropVertical ? verticals.filter((v) => v !== extra.dropVertical) : verticals;
      if (keep.length) params.set("vertical", keep.join(","));
    }
    ```
  - In `activeFilters`, after the `types` loop:
    ```typescript
    for (const v of verticals) {
      activeFilters.push({
        key: `vertical-${v}`,
        label: `${t("filters.category")}: ${v}`,
        href: filterHref("vertical", { dropVertical: v }),
      });
    }
    ```
  - In the `<CatalogFilters .../>` props, add:
    ```typescript
        categories={verticalOptions.map((v) => ({ value: v, label: v }))}
    ```
    and add `verticals` to the `initial` object: `verticals,`.

- [ ] **Step 5: Update `CatalogFilters` props + add the Category multi-select** — in `CatalogFilters.tsx`:
  - Add `categories: Option[];` to `Props` and `verticals: string[];` to `initial`.
  - Add a Category multi-select popover **mirroring the Market popover** (the toggle/commit/checkbox pattern at ~180-219), with its own `categoryOpen` state + `categoryRef`, `selectedCategories = new Set(initial.verticals)`, `toggleCategory`/`clearCategories` that commit the `vertical` CSV param, and a label using `t("categoryCount", { count })`. Place it in the main row **between Market and Format**.
  - **Move the B2B/B2C `<select>`** out of the `advancedOpen` section into the main filter row (after Native fit), so it's always visible. (Leave `compareMode` etc. under Advanced.)

- [ ] **Step 6: i18n** — add to the catalog `filters` namespace in all 6 `src/messages/*.json`:
  - en: `"category": "Category"`, `"categoryCount": "{count, plural, =0 {All categories} =1 {1 category} other {# categories}}"`
  - Translate naturally (no: "Kategori" + plural; de: "Kategorie"; etc.). The `vertical` values themselves are data — shown verbatim, not translated.

- [ ] **Step 7: Typecheck + build**

Run: `pnpm typecheck 2>&1 | tail -3 && pnpm build 2>&1 | tail -3`
Expected: PASS; catalog route compiles.

- [ ] **Step 8: Commit**
```bash
git add "src/app/[locale]/catalog" src/messages
git commit -m "feat(catalog): Category (vertical) filter + promote B2B/B2C to main row"
```

---

## Task 8: Full gate + verification + spec status

- [ ] **Step 1: Full gate**

Run each, confirm pass:
```bash
pnpm typecheck 2>&1 | tail -3
pnpm test 2>&1 | grep -E '^ℹ (pass|fail|skip)'
pnpm lint 2>&1 | tail -3
pnpm build 2>&1 | tail -3
node -e "['en','no','sv','da','fi','de'].forEach(l=>require('./src/messages/'+l+'.json'))" && echo JSON_OK
```
Expected: typecheck clean; tests pass (baseline + new recommend/basket tests); lint clean; build clean; all 6 message files parse.

- [ ] **Step 2: Manual verification (staging/prod after deploy)** — the UI is server-rendered with no DOM test harness, so verify on the live site:
  1. **Empty plan** → "Start your campaign" panel renders; pick a market + budget → recommended mix appears (Tier-1 priced picks where inventory exists, else Tier-2 "Also worth considering" with "Request price"); **Add to plan** moves an item into the plan and the normal view takes over.
  2. **Quantity stepper** — + increments, − stops at 1; line total updates for priced items.
  3. **Sidebar** — a mixed basket shows real figures with "+ request price"; an all-hidden basket shows ONE "Pricing on request" line (no giant per-currency rows).
  4. **Catalog Category filter** — the Category dropdown lists distinct verticals; selecting one narrows results; the chip removes it; B2B/B2C is in the main row.
  5. **/no** — panel + filter labels are Norwegian (no English leak).

- [ ] **Step 3: Update spec status** — set the spec's status line to `Implemented (pending staging verification)` and commit:
```bash
git add docs/superpowers/specs/2026-05-30-plan-building-catalog-ux-design.md
git commit -m "docs(plan-ux): mark design implemented"
```

---

## Self-Review (against the spec)

**Spec coverage:**
- §1 Empty-state brief→recommend → Task 5 (pure tiering) + Task 6 (panel/query/render). ✓
- §2 Category filter + promote B2B/B2C → Task 7. ✓
- §3 Quantity stepper → Task 1 (clamp) + Task 2 (action) + Task 3 (UI). ✓
- §4 Sidebar pricing cleanup → Task 4. ✓
- Testing (pure tiering + clamp units; where-clause; render on staging) → Tasks 1,5 unit; Task 7 where-clause via build; Task 8 manual. ✓

**Placeholder scan:** No TBD/“handle edge cases”. Two deliberate "confirm against repo" notes (the `MARKET_CODES` import path in Task 6 Step 1; `digitalReach`/`bookable` field names in Task 6 Step 2) — these are verify-then-use, because exact import source/field availability wasn't enumerated by exploration. The recommend-currency refinement is spelled out in Task 6 Step 3's callout.

**Type consistency:** `Candidate` (existing) reused in Task 5/6; `SupplementaryTitle`/`TieredRecommendation` defined in Task 5, consumed in Task 6. `recommendTiered(priced, unpriced, budget, opts?)` signature matches between definition (Task 5) and call (Task 6). `clampQuantity`/`MAX_QTY` defined Task 1, used Task 2. `setQuantity` defined Task 2, used Task 3. Catalog `vertical` param/where/options/props names consistent across Task 7 steps.
