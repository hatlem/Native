# 1. Record architecture decisions

Date: 2026-11-15

## Status

Accepted

## Context

NativeSpin has grown to ~140k lines with one maintainer. The reasoning behind
its structural choices lives in long plan documents (`PLAN.md`,
`docs/superpowers/`), in code comments and in one person's head. A second
developer — or the same one a year later — cannot tell which constraints are
deliberate and which are accidents, and an audit found several places where
an undocumented assumption ("the layout guards the desk pages") turned out to
be wrong.

## Decision

We record architecture decisions as short Markdown files in `docs/adr/`,
numbered sequentially (`NNNN-title-in-kebab-case.md`), using this structure:

- **Status** — Proposed, Accepted, or Superseded by ADR-NNNN.
- **Context** — the situation and the forces at play, in a few sentences.
- **Decision** — what we do, stated actively.
- **Consequences** — what becomes easier, what becomes harder, what we now
  have to keep true.

An ADR is written when a change: introduces or removes a dependency or
external service; changes how authentication, authorization or tenant scoping
works; changes the data model's direction; or picks one of several viable
approaches that someone will later want to revisit. One page at most. ADRs
are immutable once accepted: to change a decision, write a new one that
supersedes it.

## Consequences

- The "why" of the system survives its author and is reviewable in the same
  pull request as the change.
- A small, recurring writing cost.
- Existing decisions are documented retroactively as they are next touched;
  the list below is the backlog, not a claim that these ADRs exist.

### Decisions already in force, to be written up

| Topic | Where it lives today |
|---|---|
| Production-only database, no staging (and the `ALLOW_LOCAL_DB` guard) | `.env.example`, `src/lib/prisma.ts` |
| Authorization is enforced per page/action/route, never only in a layout | `src/lib/desk-guard.ts`, `src/lib/scope.ts`, `CONTRIBUTING.md` |
| Background jobs run in the web process on timers, optionally via `/api/cron/sweeps` | `src/lib/sweeps.ts`, `src/instrumentation-node.ts` |
| Pricing is indicative in the catalog and firm only on a desk-issued quote | `README.md`, `src/lib/commerce/` |
| All LLM calls go through the GetPlatform gateway | `src/lib/gateway-chat.ts` |
| Structured JSON logs and webhook alerting instead of an error-tracking SaaS | `src/lib/log.ts` |
| Hand-written OpenAPI spec, pinned to the routes by a conformance test | `src/lib/api/openapi-spec.ts` |
