# Placement-ready sweep

## Problem

A `SavedListItem` can reference a `Title` instead of a `Product` — that's
the placeholder state, set when a buyer adds a publication that doesn't
yet have a priced, bookable offer (`assertItemShape`, `addTitleItem` in
`src/lib/lists.ts`). The plan UI always renders these as "Kontakt for
pris" (`PlanLines.tsx`), because price display and product selection are
driven entirely by `SavedListItem.productId` — never re-resolved against
the `Title` at read time beyond building the picker's option list.

When the desk (or an MCP-driven price capture) later confirms a real
`Product` on that `Title`, nothing tells anyone. The placeholder line
sits there — correctly still showing "Kontakt for pris" per the existing
design ("a placeholder cannot be auto-priced" —
`docs/superpowers/specs/2026-06-17-saved-order-lists-design.md`) — but
now *silently* stale: a resolvable option exists and nobody knows to go
pick it via "Bruk plassering" (`resolveTitleLine` /
`src/app/list-actions.ts`). This was found by hand across 5 ABAX saved
lists on 2026-08-19; it's a system-wide gap, not ABAX-specific.

## Goals

- The moment a placeholder's `Title` gains a confirmed, bookable
  `Product`, both the buyer's org and the desk get a notification
  through the existing in-app + email channel.
- Works no matter which of the several paths confirmed the price
  (MCP `native_apply_quote`/`native_activate_quote_products`, the desk's
  own apply-quote action, or the publisher self-serve rate confirm) —
  don't rely on instrumenting every call site.
- One notification per placeholder, ever. No re-pinging on every sweep
  tick while it stays unresolved.
- The notification's link actually lands the buyer on the right list.

## Non-goals

- **No auto-pricing.** The placeholder never gets `productId` set by
  this feature. Resolution stays a human clicking "Bruk plassering" —
  preserves the existing desk-RFQ gate exactly as designed.
- No filtering by list status (archived/submitted/etc.) — every
  qualifying placeholder gets swept, per explicit product decision.
- No digest/batching. This codebase has no such pattern (one
  `Notification` row + one email per event, via `notifyOrg`/
  `notifyDesk`); a placement becoming ready is a low-frequency, one-shot
  event, so a digest would be over-engineering here.

## Design

### Why a sweep, not an event hook

Product confirmation happens through multiple independent code paths.
Hooking all of them is fragile — miss one and the feature silently
breaks only for that path, with no signal it's broken. A periodic sweep
gets eventual consistency regardless of entry point, and it's the exact
shape this codebase already uses for an analogous problem
(`src/lib/metrics-sweep.ts`, wired via `src/instrumentation-node.ts`).
New module: `src/lib/placement-ready-sweep.ts`, following that file's
structure line for line.

### Idempotency: reuse `AuditLog` as the marker, no schema migration

`metrics-sweep.ts`'s own once-per-day gate repurposes `AuditLog` as a
latch (`entity: "MetricsSweep:daily:<date>"`, written before the side
effect). This feature reuses the identical trick per-item instead of
per-day:

```
entity: `SavedListItem:${item.id}`
action: "placement-ready.notified"
```

Before notifying, check `prisma.auditLog.findFirst({ where: { entity,
action } })`; if found, skip. Write the marker via `recordAudit(null,
"placement-ready.notified", entity, { productId })` immediately after
the two `notify*` calls succeed (best-effort — `recordAudit` already
swallows its own failures per `src/lib/audit.ts`, so a marker-write
failure only risks one duplicate notification on the next tick, never a
missed one).

### Sweep body

```ts
// src/lib/placement-ready-sweep.ts
export async function runPlacementReadySweep(): Promise<{ notified: number }> {
  const placeholders = await prisma.savedListItem.findMany({
    where: { productId: null, titleId: { not: null } },
    select: {
      id: true,
      titleId: true,
      list: { select: { id: true, name: true, organizationId: true } },
      title: { select: { name: true } },
    },
  });

  let notified = 0;
  for (const item of placeholders) {
    const entity = `SavedListItem:${item.id}`;
    const already = await prisma.auditLog.findFirst({
      where: { entity, action: "placement-ready.notified" },
      select: { id: true },
    });
    if (already) continue;

    const product = await prisma.product.findFirst({
      where: { titleId: item.titleId!, active: true, bookable: true, confirmedAt: { not: null } },
      select: { id: true },
    });
    if (!product) continue;

    const title = `${item.title!.name} har nå en pris`;
    const body = `En plassering er nå tilgjengelig for ${item.title!.name} i listen «${item.list.name}». Åpne planen og velg den under "Bruk plassering".`;
    const link = `/plan?list=${item.list.id}`;

    await Promise.all([
      notifyOrg(item.list.organizationId, { kind: "TITLE_PRODUCT_READY", title, body, link }),
      notifyDesk({ kind: "TITLE_PRODUCT_READY", title, body, link }),
    ]);
    await recordAudit(null, "placement-ready.notified", entity, { productId: product.id });
    notified++;
  }
  return { notified };
}

export async function runPlacementReadySweepWithLock() {
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

N+1 query per placeholder (matches `metrics-sweep`'s per-item loop
style); fine at this system's scale (tens to low hundreds of open
placeholders). If that changes, collapse to one join query — noted here
so it isn't forgotten, not built preemptively.

### Wiring — `src/instrumentation-node.ts`

Add a third `schedule(...)` call alongside `autosend` and `metrics`,
gated by its own env flag and offset (10 min, clear of the other two):

```ts
const PLACEMENT_READY_OFFSET_MS = 10 * 60_000;
...
if (process.env.PLACEMENT_READY_SWEEP !== "0") {
  const { runPlacementReadySweepWithLock } = await import("@/lib/placement-ready-sweep");
  schedule("placement-ready", PLACEMENT_READY_OFFSET_MS, async () => {
    const res = await runPlacementReadySweepWithLock();
    if (!res) return "sweep skipped: another instance holds the lock";
    return `sweep done: notified=${res.notified}`;
  });
}
```

Hourly cadence (`SWEEP_EVERY_MS`, already defined) — a placement going
stale for up to an hour before the nudge fires is an acceptable trade
for the simplicity of reusing the existing tick.

### Schema change

One addition to `NotificationKind` (`prisma/schema.prisma`), commented
per the existing convention:

```prisma
// A placeholder SavedListItem's Title just gained a confirmed, bookable
// Product — nudges the buyer + desk to resolve it via "Bruk plassering".
// Never auto-prices; purely informational.
TITLE_PRODUCT_READY
```

### `/plan?list=` deep link

`/plan` currently has no query-param handling for which list is active —
switching lists is entirely cookie-driven via the "Bytt liste" form
action (`ACTIVE_LIST_COOKIE`, `src/lib/lists.ts`). Without a deep link,
the notification's "View" link is close to useless — it lands on
whichever list happens to be active in that browser's cookie, not the
one that just changed. Add minimal handling at the top of
`src/app/[locale]/plan/page.tsx`: if `sp.list` is a non-empty string and
identifies a `SavedList` belonging to the signed-in user's organization,
call `writeActiveListId(sp.list)` before reading the active list — same
one-liner the existing "Bytt liste" action already performs, just
triggered by a query param instead of a form submit. No new component;
reuses `readActiveListId`/`writeActiveListId` as-is.

## Testing

- Unit: `runPlacementReadySweep` against a seeded placeholder + matching
  active/bookable Product → asserts one `Notification` row for the org
  user and one for a DESK/SUPERADMIN user, one `AuditLog` marker, and
  that a second call is a no-op (idempotency).
- Unit: placeholder with no qualifying Product → no notification.
- Unit: placeholder whose Product exists but is `active:false` or
  `bookable:false` or `confirmedAt:null` → no notification (mirrors the
  exact gate `resolveTitleLine` itself uses to accept a chosen product).
- Integration-lite: `/plan?list=<id>` sets the active-list cookie and
  renders that list, for a list the signed-in user's org owns; a list
  belonging to a different org is ignored (falls back to the existing
  cookie/first-list behavior) rather than leaking cross-org list names.

## Rollout

- `PLACEMENT_READY_SWEEP=0` env escape hatch, same convention as
  `AUTOSEND_SWEEP` / `METRICS_SWEEP`.
- First deploy will find every currently-stale placeholder system-wide
  (including the ABAX ones from today) and fire one notification each
  on its first tick — expected and desired, not a bug to guard against.
