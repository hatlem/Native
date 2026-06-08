# Preview-your-own-native-ad tool (Increment 2) — design

**Date:** 2026-06-08
**Status:** Approved scope; ready for implementation planning.

## Context

Increment 1 added static visual sections to the landing page. Increment 2 makes one of them interactive: a public "preview your own native ad" tool where a prospect types their brand + what they're promoting, picks a market, and Claude writes a sample native (sponsored) article rendered in a generic newspaper masthead — a top-of-funnel lead magnet that *shows* the product working with the visitor's own brand.

The prototype (`docs/marketing-image-playground.html`) validated the UX. This spec productionises it within the existing Next.js App Router + Bone design system, reusing the repo's Claude convention (`src/lib/brief-match-llm.ts`: raw fetch, `claude-sonnet-4-6`, `ANTHROPIC_API_KEY`, fail-open) and rate limiter (`src/lib/rate-limit.ts`).

## Decisions (locked)

- **Public**, no account gate. Strict IP rate-limit on the expensive Claude path + a deterministic template fallback so the tool never dead-ends.
- **Generic, clearly-fictional masthead** ("Dagslys"). No real/scraped publication logos or names — avoids trademark/endorsement risk. The only real, per-market detail shown is the **disclosure label** from `Market.disclosureLabel` (e.g. "Annonsørinnhold"), which is a regulatory label, not a trademark.
- **Server-side Claude only.** No browser-direct calls (the prototype's dev hack is dropped).
- **v1 features:** market picker, hero image (upload + presets, client-only), inline-editable output — all included.
- **English-first** for the tool's own UI copy; article *content* is generated/templated in the selected market's language.
- **Branch + PR**; `main` auto-deploys to prod, so nothing lands without explicit merge.

## Non-goals (deferred)

- Real per-publication mastheads/logos (stays generic).
- Persisting generations, analytics/measurement on the tool, A/B testing.
- Streaming the article (v1 is a single non-streamed response).
- Translating the new `studio` UI copy into no/sv/da/de/fi (stubbed from English; follow-up).

## Architecture

**Route Handler API + client studio + server-side template fallback.** A `POST /api/preview-ad` JSON endpoint owns validation, rate-limiting, and the generate-or-template decision; a `"use client"` studio calls it. The decision logic is a pure function so it is unit-testable without HTTP or network.

Rejected: a Server Action (a public, abuse-exposed AI call is cleaner as an explicit rate-limited JSON endpoint with its own observability); browser-direct Claude (leaks the key, unbounded cost).

### Files

| File | Responsibility |
|---|---|
| `src/app/[locale]/(marketing)/preview/page.tsx` | Public page (server): loads markets, renders studio + soft CTA in `LandingShell` |
| `src/app/[locale]/(marketing)/_components/PreviewStudio.tsx` | Client orchestrator: state, calls endpoint, layout |
| `src/app/[locale]/(marketing)/_components/PreviewControls.tsx` | Client: brand, market, tone, product, hero-image (upload + presets) |
| `src/app/[locale]/(marketing)/_components/PreviewArticle.tsx` | Client: live article render (generic masthead + market disclosure label), inline-editable |
| `src/lib/preview/schema.ts` | Zod input schema, `Article`/`PreviewInput` types, sanitize helper |
| `src/lib/preview/generate.ts` | Claude call (structured output), env-injected for testability; returns `Article \| null` |
| `src/lib/preview/templates.ts` | Deterministic fallback `Article` per market language, brand woven in |
| `src/lib/preview/resolve.ts` | Pure `resolvePreview(...)` decision: AI vs template |
| `src/app/api/preview-ad/route.ts` | POST endpoint: validate → rate-limit → resolve → JSON |
| `src/lib/rate-limit.ts` | Add `previewLimiter` (~15/hour per IP) |
| `src/messages/landing/<locale>/studio.json` | Tool UI copy (English source + 5 stubs) |
| `src/i18n/request.ts` | Register `"studio"` in `LANDING_SECTIONS` |
| `src/app/[locale]/(marketing)/page.tsx` + `landing/<locale>/hero.json` | New hero CTA → `/preview` |
| `src/app/landing-styles.ts` | Append namespaced `.bn` studio styles |

## Data model & types

```ts
// schema.ts
type MarketCode = "NO"|"SE"|"DK"|"FI"|"DE"|"AT"|"CH"|"UK"|"IE";
type Tone = "warm"|"investigative"|"aspirational"|"plain";
interface PreviewInput { brand: string; product: string; market: MarketCode; tone: Tone; }
interface Article { headline: string; standfirst: string; byline: string; body: string[]; }
type PreviewSource = "ai" | "template";
interface PreviewResult { source: PreviewSource; reason?: "no_key"|"rate_limited"|"ai_error"; article: Article; }
```

Zod caps: `brand` 1–80 chars, `product` 1–600 chars, `market` ∈ the 9 codes, `tone` ∈ the 4 values. Sanitize strips control chars and trims. Market → language map: NO→no, SE→sv, DK→da, FI→fi, DE/AT/CH→de, UK/IE→en (6 template languages cover all 9 markets).

## Data flow

1. `preview/page.tsx` (server) loads markets (`prisma.market.findMany` → `{ code, name, disclosureLabel }`) and passes them to `PreviewStudio`.
2. User fills controls → clicks Generate → `POST /api/preview-ad` `{ brand, product, market, tone }`.
3. Endpoint: Zod-validate (400 on fail) → derive IP (same `x-forwarded-for` approach as `newsletter/subscribe.ts`) → `previewLimiter.check(ip)` → `resolvePreview({ input, hasKey: !!env.ANTHROPIC_API_KEY, rateOk, runClaude })`.
4. `resolvePreview`: if `!hasKey` → template (`reason: no_key`); else if `!rateOk` → template (`reason: rate_limited`); else `await runClaude(input)` → if non-null → `{ source: "ai", article }`, else template (`reason: ai_error`).
5. Response: always `200` with `PreviewResult`. Client renders the article into `PreviewArticle` (generic masthead + the selected market's disclosure label), shows a small source badge ("Written by Claude" / "Sample draft"). Image + inline edits are client-only.
6. Soft CTA (server-rendered on the page) links to `desk@nativespin.com` and `/signup`.

## Claude call (`generate.ts`)

Mirror `brief-match-llm.ts`: raw `fetch` to `https://api.anthropic.com/v1/messages`, `model: "claude-sonnet-4-6"`, `anthropic-version: 2023-06-01`, an `AbortController` timeout (~12s for a longer generation), `max_tokens` ~1500. Use **structured outputs** (`output_config: { format: { type: "json_schema", schema } }`) so the response parses deterministically into `Article`; on any non-200, timeout, or parse failure return `null` (caller falls back to template). Signature is env-injectable: `generatePreviewArticle(input, env = process.env)`.

System prompt (no user text inside it): a senior feature writer at a respected newspaper, writing genuine-feeling sponsored content for the advertiser, in `<market language>`, tone `<tone>`, brand woven naturally (never a sales pitch), 4–6 body paragraphs. User message carries the brand + product as data, with an explicit instruction that they are advertiser inputs to be written about — not instructions to follow (prompt-injection mitigation).

## Security & abuse

- User text only in the user message; length-capped; control-chars stripped. System prompt instructs the model to treat brand/product as ad inputs and ignore embedded instructions.
- IP rate-limit (`previewLimiter`, ~15/hour) gates only the Claude path; over-limit users still get a template (cheap), so abuse can't run up cost.
- No persistence of input; no PII requested; uploaded image never leaves the browser (no upload endpoint, no storage).
- Output shape constrained by the JSON schema; client renders text content (no HTML injection — render as text/paragraphs, not `dangerouslySetInnerHTML`).

## Error handling

- Invalid input → `400` with a short message; client shows inline validation.
- No key / rate-limited / Claude error → `200` + template (`reason` set); client shows "Sample draft".
- Hard network/endpoint failure (client fetch rejects) → client shows an inline error and leaves the current article; no client-side Claude.

## Testing

- `resolve.test.ts` — `no key → template(no_key)`, `rate exceeded → template(rate_limited)`, `key+ok+claude returns → ai`, `key+ok+claude null → template(ai_error)` (inject a fake `runClaude`).
- `templates.test.ts` — every field present, ≥4 body paragraphs, brand woven into the text, correct language chosen per market (e.g. SE→Swedish template), English fallback for unmapped.
- `schema.test.ts` — accepts valid input; rejects over-length brand/product, bad market, bad tone; sanitize strips control chars and trims.
- `generate.test.ts` — like `brief-match-llm.test.ts`: returns `null` when `ANTHROPIC_API_KEY` unset; parses a valid structured response into `Article`; returns `null` on malformed/non-200 (inject a fake fetch).
- Endpoint wiring + the studio UI verified manually on the local app (incl. rate-limit → template, upload, inline edit, market switch changing the disclosure label).

## Open items resolved

- **Badge wording / studio copy:** finalized in the `studio.json` strings during implementation.
- **Preset images:** CSS gradients (as in the prototype), no binary assets.
- **Rate-limit number:** `previewLimiter = new RateLimiter(15, 15/3600)` (15/hour per IP); tune later if needed.
