# Acast-style campaign flow — implementation plan

**Goal:** Replace the buyer's menu-driven navigation with a single, guided "Plan a campaign" flow inspired by Acast's self-serve sponsorship booking — better UI/CX, front-door-first.

**Guiding fact:** Most of the commerce backend already exists. This is largely a **UX/IA re-skin over an existing engine**, plus a few genuinely new pieces. We do NOT rebuild data models or the submit engine.

---

## What already exists (reuse — do not rebuild)

| Capability | Where |
|---|---|
| Catalog browse + FTS search + filters + price bands + visibility gates | `src/app/[locale]/catalog/*`, `src/lib/catalog-search.ts`, `src/lib/pricing/{display-price,visibility,bands}.ts` |
| **Shortlist** (cart) = SavedList / SavedListItem | `src/lib/lists.ts`, `src/app/list-actions.ts` |
| **AI recommender** = deterministic taxonomy scorer + optional Claude enrichment (fail-open) | `src/lib/brief-match.ts`, `src/lib/brief-match-llm.ts`, used in `src/app/[locale]/plan/page.tsx` |
| **Booking engine** = Plan → Request → Quote → Order → PublisherBooking, with firm-order-vs-RFQ split, TOCTOU + idempotency | `src/app/checkout-actions.ts`, `src/lib/commerce/{firm-order,accept-quote}.ts`, `src/app/quote-actions.ts` |
| Monthly inventory calendar | `Availability` model (`productId, year, month, blocked`), `src/app/[locale]/publisher/availability` |
| Accounts / roles / agency scope / onboarding gate (market+phone) | `src/auth.ts`, `src/lib/{scope,workspace,membership,onboarding-gate}.ts`, `src/app/[locale]/{account,onboarding}` |
| Nav config + shell | `src/lib/nav.ts`, `src/app/nav-shell.tsx` |

## What's genuinely new

1. **Front-door unified flow** (4 steps) replacing the buyer 7-item menu.
2. **Per-title recommendation rationale** ("why this fits your brief") — upgrade the existing recommender.
3. **Step-2 schedule/budget matrix** — title × month grid over `Availability` (new UI; writes existing Plan/PlanItem fields).
4. **Live estimate rail** — running spend/reach as titles are added.
5. **KYC / billing block + business-type split + soft approval gate** — extend `Organization`; extend onboarding + account.
6. **Media-detail enrichment** — availability calendar (demographics deferred; see decisions).

---

## Key decisions (need sign-off before building)

1. **Demographics on the media detail page.** Acast shows age/gender bar-charts. NativeSpin has **no structured demographic data** — only categorical `audience`/`vertical`/`reach`/`nativeFit` + reach numbers.
   - **Recommended:** v1 renders the categorical audience + reach we already have (no charts). Add structured demographics later as a data-collection project, not a blocker.
2. **Scheduling granularity.** *(CONFIRMED — variable per medium.)* Booking unit varies: some titles sell by **week**, some by **month**, and many native formats require a **minimum duration** (e.g. ≥4 weeks). 
   - **Decision:** add `bookingUnit` (WEEK|MONTH) + `minDurationUnits` per Product; the step-2 grid renders the right period type per title and enforces the minimum. Min *spend* already exists (`inclusions.minSpend`). Small schema add in Phase 3; `Availability` blocking stays monthly (a blocked month blocks its weeks).
3. **KYC hardness.** Acast hard-gates on a 1–3 day company review.
   - **Recommended:** **soft** gate — collect business-type + billing block, don't block browsing/shortlisting; only prompt at the proposal/commit step. (Uses reserved `APPROVER` role only if we later want manual review.)
4. **Menu replacement scope.** *(CONFIRMED — full replace.)* Delete the buyer top-nav entirely; "Plan a campaign" is the front door. Safe because the **command palette (Cmd+K)** already lists every destination — Requests/Orders/Reports/Lists re-home into the palette + in-flow surfaces + one compact "Campaigns" entry. Desk/publisher/writer/admin navs unchanged.

---

## IA / menu migration (buyer only)

Today's buyer top-nav → new home:

| Today | New home |
|---|---|
| Catalog | Step 1 "Discover" inside the flow (browse tab) |
| Plan | Becomes the flow itself |
| Lists | Saved campaign drafts — surfaced in-flow + secondary |
| Favorites | Quick-save in Discover; kept in secondary |
| Requests | Secondary "Campaigns" (status) |
| Orders | Secondary "Campaigns" (history) |
| Reports | Secondary "Campaigns" (performance) |

New buyer primary nav: **Plan a campaign** · **Campaigns** · **Account**. (Agency keeps client switcher.)

---

## Phased build (each phase = one PR-sized branch off `main`; never push `main` directly)

- **Phase 0 — Flow shell + nav skeleton (feature-flagged).** New `/[locale]/campaign` route group with a 4-step wizard shell + progress indicator. Add `nav.ts` variant behind a flag so we can develop without disrupting current buyers.
- **Phase 1 — Step 1 Discover.** Merge browse (`/catalog` components) + recommender into one step with two modes (Browse / Recommend). Add **per-title rationale** to the recommender output (extend `brief-match` scoring explanation; optional Claude one-liner, fail-open).
- **Phase 2 — Shortlist + live estimate rail.** Reuse SavedList; add a right-rail component computing running spend band + reach from `display-price` + reach fields. Add "Save as draft".
- **Phase 3 — Step Schedule & budget.** Title × month matrix over `Availability`; quick-select ("next 3 months"), per-title minimum spend (from `inclusions.minSpend`), write months to `Plan`/`PlanItem`.
- **Phase 4 — Step Build proposal.** Campaign name / brand / message form → wire into existing `submitRequest` (firm-order vs RFQ decided server-side, unchanged). Reuse notifications/audit.
- **Phase 5 — KYC / onboarding.** Extend `Organization` (legalName, address block, billingEmail, businessType) via migration; business-type split (Brand / Agency / Publisher) + billing block in onboarding; soft gate at commit; extend `/account` company section.
- **Phase 6 — Media-detail enrichment.** Availability calendar on `/catalog/[slug]`; categorical audience/reach block. (Demographics deferred per decision 1.)
- **Phase 7 — Cutover + polish.** Flip nav flag, re-home menu items, i18n (en.json first → no/da/sv/fi/de), `node:test` coverage for new logic + `.it.test.ts` for the flow, a11y pass.

## Constraints honored
- `main` auto-deploys to prod → every phase on its own branch + PR; migrations run on deploy (`prisma migrate deploy`).
- Copy: English-first in `en.json`, then translate.
- Tests: `node:test` (not Vitest); integration `*.it.test.ts` with seeded Postgres.
- Styling: pure CSS tokens in `globals.css` (no Tailwind); named functional component exports.
- AI: raw Anthropic fetch, `claude-sonnet-4-6`, fail-open; catalog-grounded (only `active && bookable && confirmedAt` titles).
