# NativeSpin — Platform Plan

> A Nordic marketplace for buying **native content** and **native advertising** in
> newspapers and magazines — with transparent pricing, a managed buying desk, and
> an in-house content production service.
>
> Reference / inspiration: [SUNT](https://www.suntcontent.com/) (true native
> distribution network). NativeSpin differs by being **buyer-first**: a discovery +
> price-transparency + managed-buying layer on top of publishers, including the
> many that do **not** sell programmatically.

---

## 1. Executive Summary

**What it is.** NativeSpin is a two-sided platform that makes it easy to discover,
price, and buy native content placements and native ads across Nordic newspapers
and magazines. Many publishers do not offer programmatic buying — NativeSpin
aggregates their offerings, shows comparable pricing and specs, and acts as a
**managed buying desk** that purchases on the customer's behalf. NativeSpin also
produces the content, so the advertiser gets a better, cheaper, higher-converting
result.

**Why now.** Native content is high-performing but operationally painful to buy:
fragmented publishers, opaque pricing, manual sales processes, and no single
catalog. Brands and agencies want one place to compare and book; publishers want
incremental demand without building self-serve tech.

**Wedge / GTM (decided).** **Hybrid**: launch with a public, transparent
**catalog + pricing** and a **request-to-buy (RFQ) flow** fulfilled by a managed
desk. Progressively automate ordering toward self-serve and, where publishers
allow, programmatic.

**Market (decided).** Launched **Nordic-first** — Norway, Sweden, Denmark — with
the data model spanning 9 European markets (NO/SE/DK/FI/DE/AT/CH/UK/IE).
Multi-language UI (en/no/sv/da/de/fi), multi-currency (NOK/SEK/DKK), per-market VAT.

**Stack (decided).** Single TypeScript codebase: **Next.js (App Router) +
PostgreSQL via Prisma**, deployed on **Railway**. Optimized for a small team and
speed to market.

**Status.** This document is the product plan-of-record. The platform is built
and deployed: the catalog, RFQ→quote→order commerce flow, content-production
workflow, invoicing, publisher portal, public API + MCP, and the
publisher-outreach engine are all implemented (see [`README.md`](./README.md)).
The phased scope, workflows, and roadmap below remain the reference; sections
describing future automation/self-serve are still forward-looking.

---

## 2. Problem & Opportunity

### The buyer's problem
- **Fragmentation.** Hundreds of newspaper/magazine titles, each with its own
  sales rep, rate card, ad specs, and lead times.
- **Opacity.** Native pricing is rarely public; you must email a salesperson and
  negotiate. Hard to compare value across titles.
- **No programmatic path.** A large share of premium editorial inventory is sold
  manually — agencies can't trade it through DSPs.
- **Content burden.** Good native requires editorial-quality articles; brands
  lack the format expertise per publisher, which inflates price and lowers
  performance.

### The publisher's problem
- Manual sell-side: every native deal is bespoke, sales-rep-dependent, hard to
  scale.
- Limited incremental demand beyond existing agency relationships.
- Reluctance to build self-serve tooling for a non-programmatic product.

### Opportunity
A neutral aggregator that (a) makes the catalog and pricing **transparent**, (b)
removes buying friction via a **managed desk**, and (c) bundles **content
production** to improve outcomes and margin. Defensibility comes from the
**catalog dataset**, **publisher relationships**, and **content/operations
playbooks** — not from a single feature.

---

## 3. Value Proposition & Positioning

**For advertisers & agencies:** "See every Nordic title that offers native, with
real pricing and specs. Brief us once — we write it, we book it, we report on it."

**For publishers:** "Incremental, qualified native demand with zero self-serve
build. We bring ready-to-publish, spec-compliant content and a single billing
relationship."

### Positioning vs. alternatives
| Alternative | Gap NativeSpin fills |
|---|---|
| SUNT / native distribution networks | They optimize *distribution* of native across a network. NativeSpin is *buyer-first discovery + price transparency + managed buying* across titles **including non-networked ones**, plus content production. |
| Programmatic native (Outbrain/Taboola style) | Those are recommendation-widget/feed buys. NativeSpin targets **editorial in-title native content** that isn't programmatically buyable. |
| Media agencies | Agencies negotiate per client. NativeSpin is a productized, transparent, repeatable layer; can be white-labeled to agencies. |
| Direct to publisher | One title at a time, no comparability. NativeSpin is the aggregated, comparable view. |

**Moat over time:** proprietary catalog + normalized pricing data, publisher
contracts and rate access, content production playbooks per title, and
performance benchmarks.

---

## 4. Users & Personas

1. **Advertiser (brand marketer)** — wants reach + conversions, limited native
   know-how. Needs discovery, price clarity, and done-for-them content.
2. **Media agency planner/buyer** — buys for many clients; wants comparability,
   speed, reporting, possibly white-label. High volume.
3. **Publisher ad/commercial team** — supplies inventory, rate cards, specs,
   availability; wants qualified demand and clean delivery.
4. **NativeSpin buying desk (ops)** — internal; turns RFQs into bookings, manages
   publisher comms, availability, and billing.
5. **NativeSpin content team** — internal/freelance; produces articles, native ad
   creative; ensures per-publisher spec compliance.
6. **NativeSpin admin** — manages catalog data, pricing rules, users, finance.

---

## 5. Business & Revenue Model

Revenue levers (combinable):
- **Buying margin / markup** on placements bought on the customer's behalf
  (primary, day one — fits the managed model).
- **Content production fees** (per article / package; bundled discounts that make
  the *total* cheaper than DIY → "better deal").
- **Platform/subscription** for agencies (seats, advanced reporting, white-label)
  — later phase.
- **Take rate** on self-serve transactions once automated — later phase.

Pricing transparency strategy: show **indicative / from-pricing** publicly to
drive discovery and trust; exact bookable price confirmed via the desk
(accounts for availability, season, format, volume). Migrate categories to firm
public pricing as data matures.

Unit economics to model early: average order value, content cost vs. fee,
desk-hours per order (must trend down as automation lands), publisher payment
terms vs. customer terms (cash-flow / float).

---

## 6. Product Scope — Phased

> Guiding principle: **operations-light where it scales, ops-heavy only where it
> creates moat (catalog, relationships, content quality).** Every phase ships
> usable value.

### Phase 0 — Foundation (internal)
- Repo, stack, CI/CD, environments, auth, i18n/currency scaffolding.
- **Catalog data model** + internal admin to enter publishers/titles/products/
  pricing/specs (the core asset).
- Seed catalog with an initial set of NO/SE/DK titles (manual research + publisher
  rate cards).

### Phase 1 — Public Catalog + RFQ (MVP, the wedge)
- Public, multilingual **catalog**: browse/search/filter titles by market,
  category, audience, format (native article, advertorial, native display),
  with specs and indicative pricing.
- **Compare** view across titles.
- **Request-to-buy / RFQ basket**: select placements + describe campaign →
  structured request to the desk.
- Internal **desk console**: receive RFQ, check availability with publisher,
  produce a firm **quote**, accept → **order**.
- Accounts (advertiser/agency), basic CRM-ish contact capture.
- Content brief intake attached to the request.

### Phase 2 — Order & Content Production Workflow
- Order lifecycle: quoted → confirmed → in-production → scheduled → live →
  completed → invoiced.
- **Content production module**: brief → draft → review/approval (customer +
  publisher spec check) → final asset → handoff to publisher.
- Asset/version management; per-publisher spec validation checklist.
- Invoicing/billing export (integrate accounting later), VAT per market.
- Customer dashboard: order status, deliverables, timeline.

### Phase 3 — Self-Serve & Automation
- Self-serve checkout for **catalog items with firm pricing & known
  availability** (instant book where the desk has standing terms).
- Availability/calendar signals per title; automated quote rules engine.
- Publisher portal: publishers manage their own rate cards, specs, availability.
- API/programmatic ingestion where a publisher supports it; otherwise keep
  managed path. Agency white-label / multi-client workspaces.

### Phase 4 — Performance & Scale
- Reporting & analytics: delivery, traffic, engagement, conversions (UTMs/pixels
  where permitted), benchmarks by title/category.
- Recommendations: suggested title mix for a goal/budget/audience.
- Optimization loop feeding content playbooks and pricing intelligence.
- Expand markets beyond core Nordics.

---

## 7. Core Feature Breakdown

- **Catalog & discovery:** publisher → titles → products (native content,
  advertorial, native display, package); rich filters; multilingual content;
  indicative vs. firm pricing; specs & lead times; audience/reach data.
- **Compare & plan:** multi-title comparison; campaign "plan/basket" with budget
  roll-up and estimated reach.
- **RFQ → Quote → Order:** structured request, desk workflow, firm quote, order
  confirmation, status tracking.
- **Content production:** brief templates per format, production pipeline,
  review/approval, spec compliance, asset library.
- **Desk console (internal):** queue, publisher comms log, availability,
  quoting, margin controls, SLA timers.
- **Publisher portal (Phase 3):** manage inventory, rates, specs, availability,
  view incoming orders, deliver/confirm placement.
- **Accounts & access:** advertiser/agency orgs, multi-user, agency→client
  hierarchy, roles/permissions.
- **Billing:** quotes/invoices, multi-currency, per-market VAT, accounting
  export.
- **Reporting:** order/campaign reporting, benchmarks (Phase 4).
- **Admin:** catalog management, pricing rules, users, audit log, feature flags.

---

## 8. Domain / Data Model (initial)

Core entities (Prisma/Postgres):

- **Market** — country (NO/SE/DK…), currency, VAT rules, default locale.
- **Publisher** — company that owns one or more titles; billing/contract terms,
  payment terms, contacts.
- **Title** — a newspaper/magazine brand (belongs to Publisher, has Market(s),
  category, audience profile, reach metrics).
- **Product** — a buyable offering on a Title: type =
  `native_article | advertorial | native_display | package`, format specs,
  lead time, base/indicative price, currency, pricing model
  (`flat | cpm | cpc | package`), placement details.
- **PriceRule** — modifiers: seasonality, volume tiers, market, negotiated
  publisher rate, NativeSpin margin %.
- **Spec** — per-Product content/creative requirements (length, images,
  disclosure label, formatting, file specs) used for validation.
- **Organization** — advertiser or agency; type, market, VAT id; agency may have
  child client orgs.
- **User** — belongs to Organization; role (`buyer, approver, admin,
  desk, content, publisher, superadmin`).
- **Plan/Basket** — draft selection of Products + campaign params (budget, dates,
  audience, goal).
- **Request (RFQ)** — submitted Plan + brief; status; assigned desk user.
- **Quote** — desk-produced firm pricing per line (cost, margin, total, validity,
  availability note); linked to Request.
- **Order** — accepted Quote; line items; lifecycle status; dates; publisher
  confirmations.
- **ContentBrief** — campaign messaging, audience, references, do/don't, per
  line.
- **ContentAsset** — produced article/creative; versions; review state; spec
  validation result.
- **PublisherBooking** — per-line booking with a Title/Publisher; placement date,
  confirmation, live URL.
- **Invoice** — customer billing; currency; VAT; line items; status.
- **AuditLog** — who changed what (catalog, pricing, orders) — compliance.

Key relationships: `Publisher 1—* Title 1—* Product`; `Order *—* Product` via
`OrderLine`; `OrderLine 1—1 ContentBrief 1—* ContentAsset`; `OrderLine 1—1
PublisherBooking`; `Organization 1—* User`; `Agency Org 1—* Client Org`.

Pricing is computed: `displayPrice = base × PriceRule modifiers`; **indicative**
publicly, **firm** only via Quote (records availability + negotiated rate +
margin).

---

## 9. System Architecture

**Single TypeScript monorepo-style app (start simple, split later if needed):**

- **Next.js (App Router, TypeScript)** — server components for the public
  catalog (SEO-critical), route handlers / server actions for the API,
  authenticated app for buyers/agencies, internal desk/admin consoles, and the
  Phase 3 publisher portal (route-grouped, role-gated).
- **PostgreSQL + Prisma** — primary datastore; migrations in repo.
- **Auth** — Auth.js (NextAuth) or Clerk; org + role model; SSO for agencies
  later.
- **Background jobs** — queue (e.g. BullMQ/Redis or a hosted equivalent) for
  emails, spec validation, report generation, ingestion.
- **Search/filter** — start with Postgres (indexes, full-text/`tsvector`);
  introduce a search service only if catalog scale demands it.
- **File/asset storage** — S3-compatible (content assets, creative, rate-card
  uploads).
- **i18n** — `next-intl` (or similar); message catalogs per locale; locale +
  currency negotiated from Market.
- **Email/notifications** — transactional provider (RFQ received, quote ready,
  order status, content approvals).
- **Integrations (phased):** accounting/invoicing export; analytics pixels/UTM;
  optional publisher APIs/feeds where available; CRM export for the desk.
- **Infra:** Vercel or Fly for app; managed Postgres (Neon/Supabase/RDS);
  object storage; CI/CD via GitHub Actions; environments dev/staging/prod;
  feature flags for phased rollout.

**Why this shape:** SEO + speed-to-market favor one Next.js codebase; Prisma
keeps the catalog model authoritative; route-grouped consoles avoid premature
microservices. Extract a dedicated service only when a clear scaling or team
boundary appears.

---

## 10. Key Workflows

**A. Discover → Plan → Request (buyer, self-serve UI)**
1. Browse/filter catalog by market/category/audience/format.
2. Inspect Title + Product: specs, indicative price, lead time, reach.
3. Add Products to a Plan; set budget/dates/audience/goal; see roll-up.
4. Submit as **Request (RFQ)** with a content brief.

**B. RFQ → Quote → Order (desk, internal)**
5. Desk receives Request in console; checks availability with publisher(s).
6. Applies negotiated rates + margin → produces **Quote** (per line, validity).
7. Customer reviews/accepts Quote → **Order** created; deposit/PO as needed.

**C. Content production**
8. Brief confirmed → content team drafts asset per Product Spec.
9. Customer review/approval; automated **spec validation** vs. Title
   requirements; publisher pre-check if required.
10. Final asset versioned and locked.

**D. Booking → Live → Report**
11. Desk books with Publisher (**PublisherBooking**); placement date set.
12. Publisher publishes; live URL + confirmation captured.
13. Tracking (UTMs/pixels where permitted) → reporting; invoice issued
    (currency + VAT by Market); order → completed.

(Phase 3 collapses A→C for firm-priced, available items into instant self-serve
checkout; the managed path remains for everything else.)

---

## 11. Catalog Data Strategy (the hard, defensible part)

The catalog is the core asset and the hardest input — most pricing is not public.

- **Acquisition:** publisher rate cards & media kits, direct partnerships,
  desk-negotiated rates, manual research; structured intake forms; later a
  publisher portal for self-maintenance.
- **Normalization:** map heterogeneous rate cards to the **Product/PriceRule/
  Spec** model so titles are comparable (format, pricing model, lead time,
  reach, audience).
- **Indicative vs. firm:** publish **from/indicative** pricing for discovery;
  firm price always via Quote (captures availability, season, volume, negotiated
  rate, margin). Promote categories to firm public pricing as confidence grows.
- **Freshness & trust:** "last verified" timestamps, ownership per title, audit
  log of pricing changes, periodic re-verification workflow in admin.
- **Coverage strategy:** prioritize high-demand titles per market; breadth of
  catalog is the marketing hook ("see *every* title that offers native").

---

## 12. Content Production Service (operational design)

This is what lets NativeSpin deliver a "better deal" (better outcome + bundled
cost) and earns content margin.

- **Capacity model:** small in-house editorial core + vetted freelancer pool;
  scheduling tied to Order lead times and Title specs.
- **Playbooks per format/title:** templates, tone, disclosure/labeling rules,
  length, imagery, legal/advertising-marking compliance per market.
- **Pipeline:** brief → assignment → draft → internal QA → customer approval →
  spec validation → publisher pre-check → final.
- **Quality & compliance:** automated spec checklist + advertising-disclosure
  rules per Nordic market; plagiarism/originality check; brand-safety review.
- **Economics:** package content with placement so the *bundle* beats DIY;
  track content cost vs. fee and desk-hours per order as core unit economics.

---

## 13. Nordic / i18n / Finance Considerations

- **Locales:** Norwegian, Swedish, Danish, English. All public catalog content
  and key flows localized; content/specs may be per-title language.
- **Currency:** NOK, SEK, DKK, plus EUR for cross-border agencies; store amounts
  with currency; FX policy for display vs. billing.
- **VAT/tax:** per-market VAT rules on customer invoices; reverse-charge for
  cross-border B2B; configurable rates; correct invoice legal fields per
  country.
- **Legal/advertising rules:** native/sponsored **disclosure labeling**
  requirements differ per market and per publisher — encode in Spec + content
  compliance checks.
- **Contracts & payment terms:** publisher payment terms vs. customer terms
  affect float/cash flow — model in Publisher + Invoice.

---

## 14. Non-Functional Requirements

- **Security:** role-based access (org/agency/desk/publisher isolation),
  least-privilege, secrets management, audit log on catalog/pricing/orders,
  secure asset storage with signed URLs.
- **Privacy/GDPR:** EEA data handling, DPA with publishers/processors, data
  minimization on tracking, consent-aware analytics, retention policy, right-to-
  erasure for org contacts.
- **Reliability:** staging/prod parity, DB backups + migration discipline,
  graceful handling of publisher-comm latency (async desk workflow, SLA timers).
- **Performance/SEO:** server-rendered catalog, fast filtered search, sitemaps &
  structured data for discovery (catalog is also a marketing funnel).
- **Observability:** logging, error tracking, metrics on desk SLA, order funnel,
  content turnaround.
- **Auditability:** immutable history of price changes and order state
  transitions.

---

## 15. Tech Stack Summary

| Concern | Choice |
|---|---|
| App | Next.js 15 (App Router) + React 19 + TypeScript |
| DB | PostgreSQL + Prisma 6 |
| Auth | Auth.js (NextAuth v5) — credentials + email magic links, org + roles |
| Jobs | In-process runner persisting to the `Job` table (swappable to BullMQ/SQS later) |
| Search | Postgres-backed catalog search (`src/lib/catalog-search.ts`) |
| Storage | Cloudflare R2 (S3-compatible) |
| i18n | next-intl; per-Market locale/currency |
| Email | Resend (transactional + outreach; inbound webhook) |
| Hosting | Railway + managed Postgres |
| CI/CD | GitHub Actions; `main` auto-deploys to prod |

---

## 16. Team & Roles (lean)

- Product/founder lead (catalog strategy + publisher relationships).
- 1–2 full-stack engineers (Next.js/TS/Postgres).
- Buying desk / ops lead (publisher comms, quoting) — also defines workflow
  requirements.
- Editorial/content lead + freelancer pool.
- (Later) data/analytics, agency partnerships, additional engineers.

Early on, **operations and engineering co-design** the desk console — it is the
product's beating heart in Phases 1–2.

---

## 17. Roadmap & Milestones (indicative)

> Timelines depend on team size; sequence matters more than dates.

- **M0 (Phase 0):** repo/stack/CI, catalog data model, internal catalog admin,
  seed initial NO/SE/DK titles.
- **M1 (Phase 1 MVP):** public multilingual catalog + compare + RFQ + desk
  console + quoting + accounts. → first managed deals; validate demand & unit
  economics.
- **M2 (Phase 2):** order lifecycle + content production workflow + invoicing/
  VAT + customer dashboard. → repeatable fulfillment, content margin.
- **M3 (Phase 3):** firm-priced self-serve checkout + publisher portal + agency
  white-label. → reduce desk-hours/order, scale.
- **M4 (Phase 4):** reporting, benchmarks, recommendations, market expansion.

**Gate between phases:** proceed only when the prior phase's core metric
improves (e.g. don't build self-serve until M1 proves demand and quoting
patterns are stable enough to automate).

---

## 18. Success Metrics / KPIs

- Catalog coverage: # titles per market; % with verified pricing.
- Demand: RFQs/week; RFQ→Order conversion; average order value.
- Efficiency: desk-hours per order (must fall over time); quote turnaround time.
- Content: production turnaround; revision rounds; spec-pass rate.
- Economics: blended take (buying margin + content fee); contribution margin;
  cash-flow float.
- Retention: repeat orders per advertiser/agency; agency seats (Phase 3).
- Phase-3 automation: % of orders booked self-serve without desk touch.

---

## 19. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Publishers won't share pricing / resist aggregation | Lead with incremental qualified demand + ready-to-publish content; start with willing partners; indicative pricing where firm isn't available. |
| Catalog data is costly to build & keep fresh | Treat as core asset; admin tooling + "last verified"; publisher self-serve portal in Phase 3; prioritize high-demand titles. |
| Managed desk doesn't scale (ops-heavy) | Phase-gate automation; measure desk-hours/order; standardize quoting rules; move firm-priced items to self-serve. |
| Channel conflict with agencies | Offer white-label / agency workspaces; position as a tool, not a competitor. |
| Disclosure/compliance varies per Nordic market | Encode rules in Spec + content compliance checks; legal review per market. |
| Content quality inconsistent at scale | Playbooks per format/title, QA gate, spec validation, vetted freelancer pool. |
| Cash-flow float (pay publishers before customer pays) | Model payment terms; deposits/POs; staged billing. |
| Over-engineering before demand is proven | Plan-only now; Phase-1 MVP is catalog+RFQ; build self-serve only after validation. |

---

## 20. Open Questions / Decisions Log

**Decided (this plan):** Deliverable = full plan doc only · GTM = hybrid
(transparent catalog now, managed buying behind it, self-serve later) · Stack =
Next.js + TypeScript + Postgres/Prisma · Market = Nordic (NO/SE/DK) from start,
multilingual + multi-currency.

**Resolved:**
- Auth: **Auth.js (NextAuth v5)** — credentials + email magic links.
- Hosting: **Railway** + managed Postgres.
- Launch pricing: **indicative** everywhere; firm pricing on a desk-issued quote.

**Still open:**
- Primary revenue emphasis for MVP: buying margin vs. content fee weighting.
- Accounting/invoicing system to integrate (per-market VAT compliance).
- Tracking/attribution approach acceptable to publishers (UTM only vs. pixels).

---

### Done (Phase 0–2, parts of 3–4)
1. Scaffolded Next.js + Prisma + i18n + auth + CI; built the **catalog data
   model** and internal catalog admin (it gates everything).
2. Seeded a NO/SE/DK title set and shipped the public catalog + RFQ →
   quote → order flow (the Phase-1 MVP), plus the content-production
   workflow, invoicing, publisher portal, public API + MCP, and the
   publisher-outreach engine.

Phase 3–4 automation already shipped: **self-serve instant-book** for all-firm
baskets (commit-gated + availability-checked), **publisher self-managed** prices/
visibility/specs/availability, budget-based **recommendations**, currency-grouped
**reporting** (AOV, RFQ→order conversion), and catalog-state **partner webhooks**.

### Next (genuinely not built)
- **External accounting integration** (e.g. Fiken/Tripletex) — today invoices/
  credit notes are modeled with per-market VAT and exported as CSV only.
- **Campaign attribution** acceptable to publishers — UTM-per-placement / pixels
  and delivery/engagement/conversion benchmarks. Today: site-side GTM + UTM
  capture on outreach forms only.
- **Phase 4 optimization loop** — content playbooks + pricing intelligence +
  benchmarks by title/category.
- **Publisher-side programmatic ingestion** of inventory (vs. the read-only
  public API + the manual publisher portal).
- Resolve the remaining business decision: revenue emphasis (margin vs. content fee).
