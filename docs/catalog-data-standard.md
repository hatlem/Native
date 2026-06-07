# Catalog Data Standard — Best-in-Class

How NativeSpin's publication catalog and outreach contacts are sourced, verified,
and kept correct. Written after a real failure: the catalog was seeded from an
AI-compiled CSV (`prisma/data/medier_alle.csv`) whose `URL_status=VERIFIED` flag
was untrustworthy — it contained hallucinated titles (e.g. "Vårt Land Junior",
"Tara Hem", "Disney Junior") and the emails were pattern-guessed, so cold sends
bounced. This is the standard that prevents a repeat.

## Core principle

**The whole point of the product is an accurate, current overview of who offers
annonsørinnhold.** A wrong title or a guessed email is worse than a missing one —
it makes the catalog lie and burns sender reputation. Default to *quarantine over
guess*, *uncertain over fake*, *deactivate over delete*.

## 1. Every fact carries provenance + a trust level

No data point is "true" because a spreadsheet says so. Each title and each contact
email needs:

- **trust level**: `UNVERIFIED` → `AUTO` (deterministic match) → `HUMAN` →
  `PUBLISHER_CONFIRMED` (the publisher told us directly — highest).
- **source**: the URL or reply it came from.
- **date**: when it was confirmed (`lastVerifiedAt`, `pricingAsOf`).

A flag you cannot trace to a source + date is `UNVERIFIED`, full stop.

## 2. Two independent signals before a publisher is "sendable"

A group is only cleared for outreach when BOTH are true:

1. **Title is real & current** — exists today, not closed/merged/renamed, not a
   duplicate/alias of another title. Confirmed via the publisher's own site +
   corroborating source.
2. **Ad email is confirmed on the publisher's own domain** — see §3.

Anything failing either test is **quarantined and never sent to.**

## 3. Emails are extracted, never guessed

- Pull the ad-sales address from the publisher's **own site** (homepage →
  `annonsera`/`annons`/`boka-annons`/`kontakt`/`mediekit`), reading **raw HTML
  server-side** (client tools redact emails; `WebFetch` masks them).
- Pattern-guessing (`annonser@`, `boka...@`) is banned — `annonser@flamman.se` and
  `bokaannads@ntmmedia.se` were both format-valid and both bounced. Correct were
  `annons@flamman.se` and `bokaannons@ntmmedia.se`, found only by reading the site.
- If the site is JS-rendered or unreachable and no address can be confirmed →
  quarantine. Do not send.
- **Bounces and replies are ground truth.** Log every bounce as data
  (`ContactLog` BOUNCE note) and fix the address; a reply from the publisher
  upgrades everything it touches to `PUBLISHER_CONFIRMED`.

## 4. Deactivate, don't delete; merge via aliases

- Discontinued/fake titles → `discontinuedAt` + `discontinuedNote` (with the
  `[FAKE|DEAD|DUPLICATE]` reason **and its source**). History is preserved; they
  drop out of consumer views and the send list automatically.
- Duplicates → keep one survivor, fold the other names into `aliases` so we never
  re-add "TU.no" and "Teknisk Ukeblad" as two titles.
- Structure recurring data into real fields; `commercialExtra` is only for the
  genuinely unstructurable.

## 5. Data decays — re-verify on a cadence

Titles close, merge, and rebrand constantly (we saw multiple 2024–2025 closures).
Treat verification as perishable: re-check `lastVerifiedAt` on a schedule, and
always re-verify a publisher's batch immediately before a send.

## 6. The verification pipeline (repeatable)

1. **Deterministic harvester first** (cheap, no LLM): fetch each contact's own
   domain, extract emails from raw HTML, classify `VERIFIED` (exact address live
   on its domain) / `CORRECTED` (better ad email found) / `REVIEW` / `UNCONFIRMED`.
   This cleared ~40% of contacts for free.
2. **Agent verification** for the rest: one agent per publisher group, web-checks
   every title (`real|dead|fake|duplicate|uncertain`, conservative, **sourced**)
   and extracts the ad email for anything the harvester couldn't confirm.
3. **Apply idempotently**: deactivate fakes/dead, merge dups, flag uncertain,
   lock verified/corrected emails. Re-runnable without double-effect.
4. **Reconcile** into two lists: `*_verified.json` (sendable) and
   `*_quarantine.json` (no confirmed address — never sent).

## 7. Scale reliability (multi-agent)

Schema-forced agents start failing (`completed without calling StructuredOutput`)
once a fan-out runs ~450+ concurrent tasks — a throttle wall, not a data problem.

- Chunk title lists to **≤10–12 per agent** so none overflows.
- Run in **waves of ≤150 groups**, apply results between waves, keep runs
  **resume-safe** (cached completions return instantly on resume).
- Calibrate on a small wave first; only scale once verdict quality is confirmed.

## Definition of done

The catalog is best-in-class when **every active title is confirmed real &
current with a source+date, every sendable contact email is confirmed on the
publisher's own domain, duplicates are merged under aliases, and everything
unconfirmed is quarantined — not guessed.**
