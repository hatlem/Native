# Placement-Ready Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a `SavedListItem` placeholder's `Title` gains a confirmed, bookable `Product`, notify both the buyer's org and the desk — without ever auto-pricing the placeholder — via a new hourly sweep modeled on the existing `metrics-sweep.ts`.

**Architecture:** A new sweep module (`src/lib/placement-ready-sweep.ts`) finds stale placeholders, checks each `Title` for a qualifying `Product`, and calls the existing `notifyOrg`/`notifyDesk` helpers — deduping per-item via an `AuditLog` marker (the same trick `metrics-sweep.ts` already uses for its daily latch, just keyed per-item instead of per-day). Wired into the existing `instrumentation-node.ts` scheduler alongside `autosend` and `metrics`. A small, separate fix makes the notification's link actually work: `/plan` currently has no way to deep-link to a specific list.

**Tech Stack:** Next.js App Router, Prisma/Postgres, `node:test` (not Vitest — this repo's convention), TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-19-placement-ready-sweep-design.md`

## Global Constraints

- Never set `SavedListItem.productId` from this feature — resolution stays a human clicking "Bruk plassering" (`resolveTitleLine`, `src/app/list-actions.ts:303-317`). This is a hard constraint from the spec's non-goals.
- No filtering by list status (archived/submitted/etc.) — every qualifying placeholder gets swept, system-wide, per the approved spec.
- One notification per placeholder, ever (not per sweep tick) — enforced via the `AuditLog` marker, not a schema migration.
- Follow existing conventions exactly: `.it.test.ts` files gated by `RUN_DB_IT === "1"` (see `src/lib/metrics-sweep.it.test.ts`), migration files hand-authored under `prisma/migrations/<timestamp>_<name>/migration.sql` (this repo cannot run `prisma migrate dev` in this environment — migrations apply on deploy via `prisma migrate deploy`, per `package.json`'s `start` script).
- All in-app notification links elsewhere in this codebase are locale-prefixed (`/${locale}/plan`, `/${locale}/desk/orders`, etc. — see `src/app/quote-actions.ts:146,201,280`); this sweep has no request-scoped locale, so it resolves the buyer's link locale from `Organization.marketCode` → `Market.defaultLocale` (falling back to `"no"`), and uses `"no"` for the desk link (internal tooling default).

---

### Task 1: `NotificationKind.TITLE_PRODUCT_READY`

**Files:**
- Modify: `prisma/schema.prisma` (the `NotificationKind` enum, currently ending at `ORDER_COMPLETED` around line 222)
- Create: `prisma/migrations/20260819170000_notification_title_product_ready/migration.sql`

**Interfaces:**
- Produces: the string literal `"TITLE_PRODUCT_READY"` as a valid `NotificationKind` value, usable anywhere `kind: NotificationKind` is expected (e.g. `notifyOrg`/`notifyDesk` calls in later tasks).

- [ ] **Step 1: Add the enum value to `prisma/schema.prisma`**

Find the `NotificationKind` enum (it currently ends with `ORDER_COMPLETED`):

```prisma
  // Order reached COMPLETED — the buyer's cue to plan the next wave of the
  // programme (or start one). Distinct from the generic advance ping.
  ORDER_COMPLETED
}
```

Change it to:

```prisma
  // Order reached COMPLETED — the buyer's cue to plan the next wave of the
  // programme (or start one). Distinct from the generic advance ping.
  ORDER_COMPLETED
  // A placeholder SavedListItem's Title just gained a confirmed, bookable
  // Product — nudges the buyer + desk to resolve it via "Bruk plassering".
  // Never auto-prices; purely informational. See the placement-ready sweep.
  TITLE_PRODUCT_READY
}
```

- [ ] **Step 2: Create the migration file**

Create `prisma/migrations/20260819170000_notification_title_product_ready/migration.sql`:

```sql
-- Placement-ready sweep: nudges the buyer + desk when a placeholder
-- SavedListItem's Title gains a confirmed, bookable Product. Purely
-- informational — never auto-prices the placeholder.
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'TITLE_PRODUCT_READY';
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: completes without error; `node_modules/.prisma/client` now includes `TITLE_PRODUCT_READY` in the `NotificationKind` type.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (this change is additive-only; any pre-existing unrelated errors in the repo are not this task's concern).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260819170000_notification_title_product_ready
git commit -m "feat(notifications): add TITLE_PRODUCT_READY kind for the placement-ready sweep"
```

---

### Task 2: `runPlacementReadySweep` — core sweep logic

**Files:**
- Create: `src/lib/placement-ready-sweep.ts`
- Create: `src/lib/placement-ready-sweep.it.test.ts`

**Interfaces:**
- Consumes: `prisma` (`@/lib/prisma`), `recordAudit` (`@/lib/audit`, signature `(actor: AuditActor, action: string, entity: string, detail?) => Promise<void>`), `notifyOrg`/`notifyDesk` (`@/lib/notify`, signature `(target, {kind: NotificationKind, title: string, body?: string, link?: string}) => Promise<void>`), `NotificationKind.TITLE_PRODUCT_READY` from Task 1.
- Produces: `export async function runPlacementReadySweep(): Promise<{ notified: number }>` — used by Task 3's lock wrapper.

- [ ] **Step 1: Write the failing test file**

Create `src/lib/placement-ready-sweep.it.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { runPlacementReadySweep } from "./placement-ready-sweep";

const RUN_DB_IT = process.env.RUN_DB_IT === "1";

let orgId = "";
let deskUserId = "";
let buyerUserId = "";
let publisherId = "";
let marketCode = "";

before(async () => {
  if (!RUN_DB_IT) return;
  const market = await prisma.market.findFirst({ select: { code: true } });
  marketCode = market!.code;
  const org = await prisma.organization.create({
    data: { name: "Placement Sweep IT Org", type: "ADVERTISER", marketCode },
  });
  orgId = org.id;
  const buyer = await prisma.user.create({
    data: { email: `sweep-buyer-${org.id}@example.com`, organizationId: orgId },
  });
  buyerUserId = buyer.id;
  const desk = await prisma.user.create({
    data: { email: `sweep-desk-${org.id}@example.com`, role: "DESK" },
  });
  deskUserId = desk.id;
  const publisher = await prisma.publisher.findFirst({ select: { id: true } });
  publisherId = publisher!.id;
});

after(async () => {
  if (!RUN_DB_IT) return;
  await prisma.notification.deleteMany({ where: { userId: { in: [buyerUserId, deskUserId] } } });
  await prisma.auditLog.deleteMany({ where: { entity: { startsWith: "SavedListItem:" } } });
  await prisma.savedListItem.deleteMany({ where: { list: { organizationId: orgId } } });
  await prisma.savedList.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: [buyerUserId, deskUserId] } } });
  await prisma.organization.delete({ where: { id: orgId } });
});

async function freshTitleWithProduct(
  opts: { active?: boolean; bookable?: boolean; confirmed?: boolean } | null,
): Promise<string> {
  const market = await prisma.market.findUnique({ where: { code: marketCode } });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const title = await prisma.title.create({
    data: {
      name: `Sweep Title ${suffix}`,
      slug: `sweep-title-${suffix}`,
      publisherId,
      countryCode: market!.code,
      marketId: market!.id,
      category: "test",
    },
  });
  if (opts) {
    await prisma.product.create({
      data: {
        titleId: title.id,
        type: "NATIVE_ARTICLE",
        name: "Sweep Test Product",
        basePrice: 1000,
        currency: market!.currency,
        active: opts.active ?? true,
        bookable: opts.bookable ?? true,
        confirmedAt: opts.confirmed === false ? null : new Date(),
      },
    });
  }
  return title.id;
}

async function freshList(): Promise<string> {
  const list = await prisma.savedList.create({ data: { organizationId: orgId } });
  return list.id;
}

if (!RUN_DB_IT) {
  test("placement-ready-sweep integration (skipped — set RUN_DB_IT=1)", { skip: true }, () => {});
} else {
  test("notifies buyer + desk once when a placeholder's title gains a bookable product, then stays quiet on rerun", async () => {
    const titleId = await freshTitleWithProduct({ active: true, bookable: true, confirmed: true });
    const listId = await freshList();
    const item = await prisma.savedListItem.create({ data: { listId, titleId } });

    const first = await runPlacementReadySweep();
    assert.equal(first.notified, 1);

    const buyerNotifs = await prisma.notification.findMany({
      where: { userId: buyerUserId, kind: "TITLE_PRODUCT_READY" },
    });
    assert.equal(buyerNotifs.length, 1);
    assert.ok(buyerNotifs[0].link?.includes(`list=${listId}`), "link deep-links to the list");

    const deskNotifs = await prisma.notification.findMany({
      where: { userId: deskUserId, kind: "TITLE_PRODUCT_READY" },
    });
    assert.equal(deskNotifs.length, 1);

    const marker = await prisma.auditLog.findFirst({
      where: { entity: `SavedListItem:${item.id}`, action: "placement-ready.notified" },
    });
    assert.ok(marker, "audit marker recorded");

    const second = await runPlacementReadySweep();
    assert.equal(second.notified, 0, "already-notified item is skipped on rerun");
    assert.equal(
      await prisma.notification.count({ where: { userId: buyerUserId, kind: "TITLE_PRODUCT_READY" } }),
      1,
      "no duplicate notification",
    );
  });

  test("stays quiet when no qualifying product exists (missing / inactive / not bookable / unconfirmed)", async () => {
    const titleNone = await freshTitleWithProduct(null);
    const titleInactive = await freshTitleWithProduct({ active: false });
    const titleNotBookable = await freshTitleWithProduct({ bookable: false });
    const titleUnconfirmed = await freshTitleWithProduct({ confirmed: false });
    const listId = await freshList();
    await prisma.savedListItem.create({ data: { listId, titleId: titleNone } });
    await prisma.savedListItem.create({ data: { listId, titleId: titleInactive } });
    await prisma.savedListItem.create({ data: { listId, titleId: titleNotBookable } });
    await prisma.savedListItem.create({ data: { listId, titleId: titleUnconfirmed } });

    const res = await runPlacementReadySweep();
    assert.equal(res.notified, 0);
  });
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module './placement-ready-sweep'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/placement-ready-sweep.ts`:

```ts
// Placement-ready sweep — finds SavedListItem placeholders (titleId set,
// productId null) whose Title has since gained a confirmed, bookable
// Product, and nudges the buyer's org + the desk to resolve it via
// "Bruk plassering". Never sets productId itself — that stays a human
// decision (resolveTitleLine, src/app/list-actions.ts), preserving the
// desk-RFQ gate an unresolved placeholder always forces.
//
// Idempotency reuses AuditLog as a per-item marker — the same trick
// metrics-sweep.ts uses for its once-per-day latch, keyed per item
// instead of per day, so a given placeholder is ever notified once.

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { notifyOrg, notifyDesk } from "@/lib/notify";

const NOTIFIED_ACTION = "placement-ready.notified";
const entityFor = (itemId: string) => `SavedListItem:${itemId}`;

export type PlacementReadySweepResult = { notified: number };

export async function runPlacementReadySweep(): Promise<PlacementReadySweepResult> {
  const placeholders = await prisma.savedListItem.findMany({
    where: { productId: null, titleId: { not: null } },
    select: {
      id: true,
      titleId: true,
      list: {
        select: {
          id: true,
          name: true,
          organizationId: true,
          organization: { select: { marketCode: true } },
        },
      },
      title: { select: { name: true } },
    },
  });
  if (placeholders.length === 0) return { notified: 0 };

  const markets = await prisma.market.findMany({ select: { code: true, defaultLocale: true } });
  const localeByMarket = new Map(markets.map((m) => [m.code, m.defaultLocale]));

  let notified = 0;
  for (const item of placeholders) {
    const entity = entityFor(item.id);
    const already = await prisma.auditLog.findFirst({
      where: { entity, action: NOTIFIED_ACTION },
      select: { id: true },
    });
    if (already) continue;

    const product = await prisma.product.findFirst({
      where: { titleId: item.titleId!, active: true, bookable: true, confirmedAt: { not: null } },
      select: { id: true },
    });
    if (!product) continue;

    const buyerLocale = item.list.organization.marketCode
      ? (localeByMarket.get(item.list.organization.marketCode) ?? "no")
      : "no";
    const titleName = item.title!.name;
    const notifTitle = `${titleName} har nå en pris`;
    const body = `En plassering er nå tilgjengelig for ${titleName} i listen «${item.list.name}». Åpne planen og velg den under "Bruk plassering".`;

    await Promise.all([
      notifyOrg(item.list.organizationId, {
        kind: "TITLE_PRODUCT_READY",
        title: notifTitle,
        body,
        link: `/${buyerLocale}/plan?list=${item.list.id}`,
      }),
      notifyDesk({
        kind: "TITLE_PRODUCT_READY",
        title: notifTitle,
        body,
        link: `/no/plan?list=${item.list.id}`,
      }),
    ]);
    await recordAudit(null, NOTIFIED_ACTION, entity, { productId: product.id });
    notified++;
  }
  return { notified };
}
```

- [ ] **Step 4: Run the test file to confirm it now resolves (skips cleanly without `RUN_DB_IT`)**

Run: `npx tsc --noEmit && tsx --test src/lib/placement-ready-sweep.it.test.ts`
Expected: PASS — one test reported, marked skipped (module now resolves; the real assertions need a database).

- [ ] **Step 5: If you have a disposable Postgres available, run the real assertions**

Run: `ALLOW_LOCAL_DB=1 RUN_DB_IT=1 tsx --test src/lib/placement-ready-sweep.it.test.ts`
Expected: PASS — both tests green (2 passing, 0 failing). If no disposable DB is available in this environment, note that in the task summary instead of skipping silently — this mirrors how `metrics-sweep.it.test.ts` and `contract.it.test.ts` are already run (CI/a real disposable DB only, never against prod).

- [ ] **Step 6: Commit**

```bash
git add src/lib/placement-ready-sweep.ts src/lib/placement-ready-sweep.it.test.ts
git commit -m "feat(notifications): add placement-ready sweep core logic"
```

---

### Task 3: Lock wrapper + scheduling

**Files:**
- Modify: `src/lib/placement-ready-sweep.ts` (append the lock wrapper)
- Modify: `src/lib/placement-ready-sweep.it.test.ts` (append one test)
- Modify: `src/instrumentation-node.ts`

**Interfaces:**
- Consumes: `runPlacementReadySweep` (Task 2), the `schedule(label, offsetMs, run)` helper already defined in `src/instrumentation-node.ts:18-30` (no changes needed to `schedule` itself).
- Produces: `export async function runPlacementReadySweepWithLock(): Promise<PlacementReadySweepResult | null>`, wired into the app's boot-time scheduler.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/placement-ready-sweep.it.test.ts`, inside the `else` block (after the two existing tests), and add `runPlacementReadySweepWithLock` to the import on line 4:

```ts
import { runPlacementReadySweep, runPlacementReadySweepWithLock } from "./placement-ready-sweep";
```

```ts
  test("runPlacementReadySweepWithLock delegates to the sweep when uncontended", async () => {
    const titleId = await freshTitleWithProduct({ active: true, bookable: true, confirmed: true });
    const listId = await freshList();
    await prisma.savedListItem.create({ data: { listId, titleId } });

    const res = await runPlacementReadySweepWithLock();
    assert.ok(res, "lock was acquired and the sweep ran");
    assert.equal(res!.notified, 1);
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx tsc --noEmit`
Expected: FAIL — `runPlacementReadySweepWithLock` is not exported from `./placement-ready-sweep`.

- [ ] **Step 3: Add the lock wrapper**

Append to `src/lib/placement-ready-sweep.ts`:

```ts
/** Same xact-scoped advisory-lock pattern as the metrics sweep: null means
 *  another instance holds the lock this tick. */
export async function runPlacementReadySweepWithLock(): Promise<PlacementReadySweepResult | null> {
  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<[{ locked: boolean }]>`
        SELECT pg_try_advisory_xact_lock(hashtext('placement-ready-sweep')) AS locked`;
      if (!locked) return null;
      return runPlacementReadySweep();
    },
    { timeout: 5 * 60_000, maxWait: 10_000 },
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx tsc --noEmit && tsx --test src/lib/placement-ready-sweep.it.test.ts`
Expected: PASS (skipped without `RUN_DB_IT`; if you have a disposable DB, `ALLOW_LOCAL_DB=1 RUN_DB_IT=1 tsx --test src/lib/placement-ready-sweep.it.test.ts` should show 3 passing).

- [ ] **Step 5: Wire the sweep into the scheduler**

In `src/instrumentation-node.ts`, add a new offset constant next to `METRICS_OFFSET_MS` (line 10):

```ts
const PLACEMENT_READY_OFFSET_MS = 10 * 60_000; // stagger clear of autosend (0) and metrics (5min)
```

Then add a third registration block after the `METRICS_SWEEP` block (after line 51, before the closing `}` of `startSchedules`):

```ts
  if (process.env.PLACEMENT_READY_SWEEP !== "0") {
    const { runPlacementReadySweepWithLock } = await import("@/lib/placement-ready-sweep");
    schedule("placement-ready", PLACEMENT_READY_OFFSET_MS, async () => {
      const res = await runPlacementReadySweepWithLock();
      if (!res) return "sweep skipped: another instance holds the lock";
      return `sweep done: notified=${res.notified}`;
    });
  }
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Note on verification**

This scheduling wiring itself has no automated test in this codebase (the sibling `metrics`/`autosend` registrations aren't unit-tested either — `schedule()` uses real `setTimeout`/`setInterval`). Verification is: the app boots without throwing (covered by any existing smoke/build check), and the first production log line `[placement-ready] sweep done: notified=N` after deploy confirms it actually ran. Per this repo's own convention for sweeps that touch email (see the metrics-sweep rollout note), **only ship this once the deploy can be watched.**

- [ ] **Step 8: Commit**

```bash
git add src/lib/placement-ready-sweep.ts src/lib/placement-ready-sweep.it.test.ts src/instrumentation-node.ts
git commit -m "feat(notifications): schedule the placement-ready sweep hourly"
```

---

### Task 4: `/plan?list=` deep link

**Files:**
- Modify: `src/app/[locale]/plan/page.tsx:90-91`

**Interfaces:**
- Consumes: `resolveActiveList(orgId: string, activeId: string | null)` (`@/lib/lists`, unchanged — already validates `existing.organizationId === orgId`, see `src/lib/lists.ts:114-125`), `readActiveListId()` (unchanged).
- Produces: nothing new consumed elsewhere — this is the last piece that makes the sweep's notification link actually useful.

**Design note:** `resolveActiveList` is a Server Component read path and explicitly cannot persist a cookie (see the comment at `src/lib/lists.ts:110-113`: "Server Components can't persist a cookie, so they must never lazily create"). So this task does **not** call `writeActiveListId` — it simply lets a valid `?list=` query param override the cookie-read for that one render. `resolveActiveList` already rejects a list id that doesn't belong to `ws.activeOrgId` (falls back to the org's most-recent list), so cross-org leakage is already impossible without any extra code here.

- [ ] **Step 1: Make the change**

In `src/app/[locale]/plan/page.tsx`, find (around line 90-91):

```ts
  const activeList = ws?.activeOrgId
    ? await resolveActiveList(ws.activeOrgId, await readActiveListId())
    : null;
```

Replace with:

```ts
  // A `?list=` query param (used by the placement-ready-sweep notification
  // link) wins for this render over the cookie. resolveActiveList already
  // rejects any id that doesn't belong to ws.activeOrgId, so a link to
  // someone else's list just falls back — never leaks a cross-org list.
  const listParam = typeof sp.list === "string" && sp.list.trim() ? sp.list.trim() : null;
  const activeList = ws?.activeOrgId
    ? await resolveActiveList(ws.activeOrgId, listParam ?? (await readActiveListId()))
    : null;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

This repo has no existing automated tests for `[locale]/plan/page.tsx` (it's a Server Component page — verified by grep, no `*plan*test*` files under `src/app`), so verify by hand:

1. Start the dev server: `pnpm dev`
2. Sign in as a buyer test account with at least one `SavedList` (e.g. `andreas.hatlem+ns-...` or a seeded buyer per this repo's test-login conventions).
3. Find two `SavedList` ids for that org: `npx tsx -e "import('./src/lib/prisma').then(({prisma}) => prisma.savedList.findMany({where:{organizationId: 'ORG_ID'}, select:{id:true,name:true}}).then(console.log))"` (substitute the signed-in buyer's org id).
4. Visit `/no/plan?list=<one of those ids>` — confirm the page renders that specific list (its name/lines match), not whatever was previously active.
5. Visit `/no/plan?list=<a SavedList id belonging to a different org>` — confirm it does **not** render that other org's list; it falls back to the signed-in org's own most-recent list instead.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/plan/page.tsx"
git commit -m "feat(plan): support ?list= deep link so notifications can point at a specific list"
```
