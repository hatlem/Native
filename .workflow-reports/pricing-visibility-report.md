# SUPERADMIN cost-vs-sell price display — implementation report

## What shipped

A SUPERADMIN-only "cost vs. sell" line per quote line, in the desk quote
builder at `src/app/[locale]/desk/[requestId]/page.tsx`.

### Files changed
- `src/app/[locale]/desk/[requestId]/page.tsx`
- `src/messages/en.json`
- `src/messages/no.json`
- `src/messages/sv.json`
- `src/messages/da.json`
- `src/messages/de.json`
- `src/messages/fi.json`

### Implementation

1. **Session check** — added `import { auth } from "@/auth";` and, right
   after the existing `getTranslations` calls:
   ```ts
   const session = await auth();
   const isSuperadmin = session?.user?.role === "SUPERADMIN";
   ```
   This does **not** redirect the page (unlike
   `desk/titles/[id]/page.tsx`, which gates the whole route) — the rest of
   this page is intentionally open to any desk role today, so only the new
   span is conditioned on `isSuperadmin`.

2. **Display** — inside the existing `quote.lines.map((l) => (...))` loop,
   each line now renders as a `Fragment` with two rows instead of one `div`:
   - the existing `.quote-line` row (description, quantity, margin%, sell
     price) — completely unchanged;
   - a new `isSuperadmin`-gated `<div className="muted small">` row showing
     `t("costVsSell", { cost, sell })`, where `cost` is
     `formatMoney(Number(l.unitCost) * l.quantity, ...)` and `sell` is the
     same `formatMoney(Number(l.lineTotal), ...)` already used for the sell
     price. No new Prisma query — `unitCost` was already selected by the
     existing `quotes: { include: { lines: true, order: true } }` include,
     just never rendered.
   - Margin is already visible on the row above (`marginPct` was already
     rendered unconditionally to all desk roles before this change — that
     was pre-existing behavior, not something this task added or gated), so
     it isn't duplicated in the new line.
   - `Fragment` (from `react`) was added purely so each line can render two
     sibling block elements under `.quote-lines` (a `display:flex;
     flex-direction:column` container) without introducing new CSS classes
     — no `globals.css` changes were needed.

3. **i18n** — added one new key, `desk.costVsSell`, to all six locale
   files, following the existing `resolveFrom`-adjacent placement and the
   page's established `t("key", { param })` interpolation pattern (same
   style as `resolveTitlesFirst`, `itemsAndAge`, etc.):
   - en: `"Cost {cost} · Customer pays {sell}"`
   - no: `"Innkjøpt for {cost} — kunde betaler {sell}"`
   - sv: `"Inköpt för {cost} — kund betalar {sell}"`
   - da: `"Indkøbt for {cost} — kunden betaler {sell}"`
   - de: `"Eingekauft für {cost} — Kunde zahlt {sell}"`
   - fi: `"Ostettu hintaan {cost} — asiakas maksaa {sell}"`

   Source language was written in `en.json` first, then translated per
   locale (not Norwegian-first), per the repo's standing convention.

### What was deliberately NOT touched
- `computeQuoteLines` / `applyQuote` / any pricing logic — pure read-only
  display of numbers already in scope.
- Buyer-facing pages: `src/app/[locale]/requests/` and
  `src/app/[locale]/orders/` are separate files/directories from
  `src/app/[locale]/desk/[requestId]/page.tsx` and `desk/orders/`; neither
  was touched, so cost/margin remain fully hidden from buyers exactly as
  before.
- No CSS changes — the new row reuses the existing `.muted` and `.small`
  utility classes already used elsewhere on this same page (e.g. the
  `quote-cta` "awaiting" line).

## Gating verification

Confirmed by reading `src/auth.ts`'s role model and reusing the exact
comparison from `desk/titles/[id]/page.tsx:149`
(`session?.user?.role !== "SUPERADMIN"`), inverted to `===` for the inline
conditional. This is a strict-equality check against the literal
`"SUPERADMIN"` role — a `DESK` (or any other) session role evaluates
`isSuperadmin` to `false`, so the new span renders `null` for every
non-superadmin desk user. It does not check "any staff/desk role" — it is
specifically the same superadmin-only comparison used elsewhere in this
codebase for cost-sensitive commercial data (title pricing edit page).

## Testing

- **No existing test file covers this page.** Searched the repo
  (`find ... -iname "*requestId*"`, grep for a corresponding `.test.ts`)
  and confirmed `src/app/[locale]/desk/[requestId]/` has no test file
  today, and no other desk quote-detail test exists to extend. Per the
  task's own instruction ("many desk pages in this repo have no tests —
  check first, do not assume"), I did not invent new test infrastructure
  for a page that has none; instead verified via typecheck + careful
  manual read of the diff (see below) and the two commands below.
- `npx tsc --noEmit` — clean, no errors.
- `pnpm test` (full `node:test` suite) — **732 passing, 2 skipped, 0
  failing** out of 734 total. This matches the stated baseline exactly (no
  regression, no new count drift — the two locale-JSON message files
  parse and pass the existing `locale-parity.test.ts` key-parity check for
  the new `costVsSell` key across all 6 locales).
- `node -e "JSON.parse(...)"` on all 6 edited `messages/*.json` files —
  all parse cleanly.
- `npx eslint "src/app/[locale]/desk/[requestId]/page.tsx"` — **could not
  run**: pre-existing environment/tooling issue in this worktree
  unrelated to this change (`ESLint couldn't determine the plugin
  "@next/next" uniquely` — a duplicate `@next/eslint-plugin-next`
  resolution between the worktree's `node_modules` and the parent repo's
  `node_modules`). This is a worktree/monorepo-path artifact, not
  something introduced by this diff; `tsc --noEmit` and the full test
  suite both passed clean, and the change is small and mechanically
  reviewed by hand (no new patterns, reuses an existing formatting helper,
  an existing auth pattern, and existing CSS classes).

## Commit

`feat(desk): show superadmin-only cost vs. sell per quote line`
