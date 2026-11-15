# Security policy

## Reporting a vulnerability

Email **privacy@nativespin.com** with:

- what you found and where (URL, endpoint, or file),
- the steps to reproduce it, and
- what an attacker could do with it.

Please do not open a public GitHub issue for a security problem, and do not
test against other customers' data — a proof of concept against your own
account is enough.

We aim to acknowledge a report within 2 working days and to tell you what we
will do about it within 10 working days. We will not take legal action against
good-faith research that follows this policy.

The same contact is published at `/.well-known/security.txt`.

## Scope

- The NativeSpin web application and its public API (`/api/v1`, `/api/mcp`).
- This repository.

Out of scope: denial-of-service testing, social engineering, and findings that
need physical access to a user's device.

## How the codebase guards itself

- CI (`.github/workflows/ci.yml`) fails on high/critical dependency advisories
  (`pnpm audit`) and on committed secrets (gitleaks).
- Dependabot (`.github/dependabot.yml`) raises update PRs weekly.
- Access rules live in `src/lib/desk-guard.ts`, `src/lib/scope.ts` and
  `src/lib/membership.ts`. Every desk page and server action calls a guard
  itself; a layout is never the only authorization check.
