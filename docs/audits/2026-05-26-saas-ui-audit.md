# SaaS UI Audit — 2026-05-26

Page-by-page audit against the 18-principle SaaS UI design rubric. All 39 routes covered.

**Output:** 22 commits applied. **Theme:** §18 pending states on every consequential server-action button via a shared `<SubmitButton>` (`src/components/submit-button.tsx`) that uses `useFormStatus`. Plus targeted §14/§15/§11/§4 fixes per page.

---

## Commits

### Auth

| Commit | Page | Fix |
|---|---|---|
| `77e80e8` | `/signin` | §14 distinct rate-limit message · §14 email preserved through error redirect · §18 submit pending |
| `b5288ab` | `/signup` | §14 distinct rate-limit message · §14 name/orgName/market/email preserved · §10 mark "Your name" optional · §18 submit pending |

### Catalog

| Commit | Page | Fix |
|---|---|---|
| `bc2692e` | `/catalog` | §15 active filter chips with X-to-remove · §15 "Clear filters" chip when ≥2 active · React `key` props on selects to force remount after client nav |
| `cc7cd79` | `/catalog/[slug]` | §11 / a11y — content spec from `<br/>` text to semantic `<dl>` · §18 Add-to-plan pending |
| `a00efbe` | `/catalog/compare` | Back link copy fix — was using the catalog H1 ("Every title that runs native…") as the back label |

### Dashboards (role-based landings)

| Commit | Page | Fix |
|---|---|---|
| `935d13d` | `/desk` | §4 — wired Quotes-out KPI to actionable `#in-motion` anchor when count > 0 |
| `cb96e30` | `/publisher` | §18 — product + spec Save buttons pending state · `SubmitButton` gained optional `className` prop |
| `8be29d9` | `/agency` | §18 — "Act as this client" + "Create client" pending · Split disabled active-client button out of its form |

### Buyer list / detail views

| Commit | Page | Fix |
|---|---|---|
| `405ee43` | `/plan` | §18 Submit-brief / Confirm-order pending state (RFQ vs firm-priced paths) |
| `36d7fee` | `/notifications` | §18 Mark-all-as-read pending |
| `95925eb` | `/requests/[id]` | §18 Accept-quote pending |
| `f03726f` | `/orders/[orderId]` | §18 Use-as-template (duplicate plan) pending |

### Desk admin

| Commit | Page | Fix |
|---|---|---|
| `7e3bc28` | `/desk/[requestId]` | §18 Generate-quote pending |
| `c89cc04` | `/desk/orders/[orderId]` | §18 — 4 lifecycle buttons: advance status / issue invoice / cancel order / issue credit note |
| `695f81b` (bundled by user) | `/desk/titles` | §18 — bulk send-price-request + 3 per-row state mutators (mark-native / mark-no-native / deactivate) |
| `c9f1198` | `/desk/titles/[id]` | §18 — 2 main-page Save buttons; 11 sub-component buttons in `SalesContactsPanel`/`PriceRequestsPanel`/`PendingQuotesPanel` left as follow-up |
| `07c1c8b` | `/desk/api-keys` | §18 — Generate-key + Revoke pending; §17 revoke-confirmation deferred |

### Publisher

| Commit | Page | Fix |
|---|---|---|
| `a67f0da` | `/publisher/orders` | §18 — booking-save + editorial-veto pending |
| `ab5199b` | `/publisher/availability` | §18 — per-month save pending (dozens of forms on the page) |
| `559bd49` | `/publisher/claim/[token]` | §18 — claim-account pending |

### Marketing

| Commit | Page | Fix |
|---|---|---|
| `78e8fa5` | `/recommend` | §18 Add-all-to-plan pending. Filter-form "Suggest a mix" left alone (GET form, URL nav not mutation) |

### i18n cleanup

| Commit | Scope | Notes |
|---|---|---|
| `8cb7468` | `orders.useAsTemplate` | Was literally "Use as template" in **all six** locale files |
| `8f03aba` | ~142 translations | Plan-duplicate banners · order.cancel*/creditNote* · production.veto* · formats.bestFor. Skipped `auth.invite*`/`auth.claim*`/`apiDocs.*`/`apiKeys.*` (stale-brand source needed rename first) |

---

## Pages with no commit (deep-audited, no fix warranted)

**17 pages.** Code reviewed against §1–§18 and confirmed clean.

- `/invoices/[id]` — read-only display, `<dl>` meta, no forms
- `/requests` — list view; KPIs hide when no data (§4 ✓), action-list pattern
- `/orders` — proper `<table>`, responsive `data-label` for mobile (§11 ✓), status badges
- `/desk/orders` — same pattern as `/orders`
- `/desk/reports` — read-only report metrics, semantic breakdown lists with text+visual bars (§16 ✓)
- `/[...rest]` 404 → `/[locale]/not-found.tsx` — big "404", H1, lead, primary + secondary CTA in `LandingShell`
- `/` (home) — comparison `<table>` with `aria-label`, `role="list"`/`role="listitem"` on publishers grid, semantic landmarks
- `/about` — hero + mission + beliefs grid + team
- `/api` — code blocks in `<pre>`, semantic structure
- `/pricing` — 3-plan grid with featured highlight, fees `<table>`, FAQ
- `/privacy` — `lastUpdated` stamp, 10 legal sections, semantic
- `/terms` — same as privacy
- `/security` — pillars + compliance `<table>` with color+text status badges (§16 ✓)
- `/formats` — 4 format cards with `<dl>`, comparison `<table>` (the pattern `/catalog/compare` should adopt)
- `/how-it-works` — `<ol>` steps with `aria-hidden` numbers
- `/for-advertisers` — problems/solutions/formats grids
- `/for-agencies` — features grid + workflow
- `/for-publishers` — benefits grid + numbered `<ol>` steps
- `/contact` — mailto form (no server round-trip; §18 doesn't apply); labels above, no asterisk-on-required

---

## Patterns introduced

### `<SubmitButton>` (`src/components/submit-button.tsx`)

Client component wrapping a `<button type="submit">` with `useFormStatus()`. Disables the button and swaps the label while a server action runs. Optional `className` prop for size/variant (`btn`, `btn small`, `btn small ghost`, `btn primary block`, etc).

```tsx
<SubmitButton
  label={t("submit")}
  pendingLabel={t("submitting")}
  className="btn primary block"
/>
```

Used on 22 buttons across 18 pages. Consistent UX: every consequential server-action shows a verb-matched pending label like "Signing in…", "Saving…", "Generating…", "Adding…".

### Active filter chips (`/catalog`)

Pattern: above the result count, render a chip per active filter with a click target that links to the same URL minus that one filter. A "Clear filters" chip appears when ≥2 active. Selects need `key` props to force remount after Next.js client navigation — without them, `defaultValue` only applies on initial mount and dropdowns retain old values.

### Distinct error redirects (auth)

Pattern: server actions redirect with a discriminated `?error=` code (`error=rate` vs `error=1`) plus user input preserved as URL params (`&email=…&orgName=…`). Server page reads the code, picks the matching message, and `defaultValue`s the inputs.

---

## Flagged follow-ups (not done)

- **`/catalog/compare` — cards → comparison table.** The i18n already has the row keys (`rowMarket`, `rowCategory`, `rowFormats`, `rowAttribute`). The current side-by-side cards layout doesn't enable real attribute-by-attribute comparison. `/formats` shows the pattern to copy.
- **`/desk/titles/[id]` sub-components.** 11 submit buttons in `SalesContactsPanel`, `PriceRequestsPanel`, `PendingQuotesPanel` still need pending states. Lower priority — admin tools.
- **`/desk/api-keys` Revoke.** Currently a one-click irreversible action. §17 — wrap in a `<details>`-disclosed confirmation (same pattern as `/desk/orders/[orderId]` cancel).
- **Remaining English placeholders in non-English locales.** `auth.invite*` (publisher claim invite expired/claimed/unknown bodies), `auth.claim*` (the claim-account form copy), and the full `apiDocs.*` + `apiKeys.*` blocks (~50 keys per locale). These all reference internal/partner tooling and are lower visibility than what was translated.
- **`/desk` KPI tile sizing (§5 Bento).** All KPIs currently equal width. The primary "Needs attention" tile could be larger to lead the eye.
- **Sortable columns on `/orders` and `/desk/orders` (§11).** Currently fixed-sort by `createdAt: desc`.

---

## Dev-server reliability note

The Next.js dev server crashed ~5–8 times across the two audit sessions, with rotating symptoms — webpack chunk errors, missing `routes-manifest.json`, ENOENT on `pages/_document.js`, "missing required error components, refreshing…". Pattern was unrelated to specific edits; restarting after `rm -rf .next` always fixed it. Worth investigating separately as a developer-experience issue.

---

## How to extend the pattern

When adding a new consequential server-action button:

1. Add a `…ing` i18n key next to the existing action-label key, in all six locales (`en`, `no`, `sv`, `da`, `de`, `fi`).
2. Replace `<button type="submit" className="btn …">{t("save")}</button>` with `<SubmitButton label={t("save")} pendingLabel={t("saving")} className="btn …" />`.
3. If the surrounding text contains an arrow span (`<span className="arrow">→</span>`), fold it into the `label` string — `<SubmitButton label={\`${t("save")} →\`} … />`.

Skip the pattern for:

- GET forms (URL navigation, not a mutation)
- `mailto:` forms (no server round-trip — the user's mail client handles feedback)
- Buttons that are always disabled or never actually submit
