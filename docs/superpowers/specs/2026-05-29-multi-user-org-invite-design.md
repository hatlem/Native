# Multi-User Org-Invite & Time-Limited Delegation — Design

**Date:** 2026-05-29
**Status:** Approved (design); pending implementation plan
**Scope:** v1 covers permanent multi-seat invites **and** time-bounded delegation (all four flagged scenarios A–D).

## Problem

Today an organization is single-seat: membership is a direct FK (`user.organizationId`) plus a single global `user.role` enum. Four saved scenarios flag this as a critical missing primitive:

- **A — Maja/Sondre (DK launch):** a second co-founder must log in and review the plan on the same org without redoing work.
- **B — Maja/Sondre (SE expansion):** invite Sondre as a second user, single-click from account settings, arriving with the right role and immediate access to existing plans/RFQs/orders — but with **accept-quote permission off** so Maja gates his first quote.
- **C — Marie/Andreas (parental leave):** grant a colleague **time-bounded** edit access that **auto-de-escalates** on a fixed date (5 Oct), without giving admin rights — no permission-creep audit finding.
- **D — Maja Lindström:** publisher-side editor; establishes that PUBLISHER-role users exist but is **out of scope** for this feature.

## Decisions (locked during brainstorming)

1. **Scope:** multi-seat **+** time-limited delegation in v1. Permanent membership is the common case; delegation is a bounded variant of the same primitive (not a separate abstraction).
2. **Membership model:** additive overlay table. Keep `user.organizationId` as the user's *home* org; a new `Membership` table is the authoritative source of role + permissions. Multi-seat = row with `expiresAt = null`; delegation = row with `expiresAt` set.
3. **Permissions:** three membership roles (Admin / Member / Restricted) **plus** one explicit boolean `canCommit` (accept quotes / place orders).
4. **Expiry enforcement:** lazy check at request time (the security boundary) + a daily cleanup sweep for audit/UI/notification only.
5. **Invite/claim:** Admin-gated (org creator is auto-Admin), email-pinned single-use token, supports both brand-new and existing logged-in users. A person may belong to multiple orgs.

## Existing code this builds on

- `prisma/schema.prisma` — `Organization` (lines ~364–386, has `parentOrgId` agency self-join), `User` (~388–411, has `organizationId` FK + global `role`), `UserRole` enum (~61–69), and **`PublisherInvite`** (~420–434) whose shape we mirror.
- `src/auth.ts` — NextAuth v5, JWT strategy; org resolved at auth time into `session.user.{orgId, orgType, role}`.
- `src/lib/workspace.ts` — `Workspace.scopeOrgIds` already supports multiple orgs (agency path); we union memberships into it.
- `src/lib/scope.ts` — `canActOnOrg(scope, orgId)`; we add `canCommitOnOrg` and make role/canCommit org-scoped.
- `src/lib/notify.ts` — email adapter (`setEmailAdapter`); `src/lib/pricing/email.ts` — multilingual template builder pattern to mirror for the invite email.
- `src/lib/publisher-invite.ts` + `src/app/auth-actions.ts` (claim flow ~249–352) — reference implementation for token-based claim.

## 1. Data model (additive — nothing dropped)

```prisma
model Membership {
  id             String           @id @default(cuid())
  userId         String
  user           User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  organizationId String
  organization   Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  role           MembershipRole   @default(MEMBER)
  canCommit      Boolean          @default(false)   // accept quotes / place orders
  expiresAt      DateTime?                          // null = permanent seat; set = delegation
  status         MembershipStatus @default(ACTIVE)
  invitedById    String?
  invitedBy      User?            @relation("MembershipInviter", fields: [invitedById], references: [id])
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt

  @@unique([userId, organizationId])
  @@index([organizationId])
  @@index([userId])
  @@index([expiresAt])
}

model OrgInvite {                  // mirrors PublisherInvite
  id                  String         @id @default(cuid())
  organizationId      String
  organization        Organization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  email               String
  role                MembershipRole  @default(MEMBER)
  canCommit           Boolean         @default(false)
  delegationExpiresAt DateTime?       // if set → copied to Membership.expiresAt on claim
  token               String          @unique
  expiresAt           DateTime        // invite-LINK validity (14 days)
  claimedAt           DateTime?
  claimedByUserId     String?
  createdById         String
  createdAt           DateTime        @default(now())

  @@index([organizationId])
  @@index([email])
}

enum MembershipRole   { ADMIN  MEMBER  RESTRICTED }
enum MembershipStatus { ACTIVE EXPIRED REVOKED }
```

**Two distinct expiries on an invite:** `expiresAt` = how long the link is clickable; `delegationExpiresAt` = the date the resulting access auto-de-escalates (null for permanent seats).

`user.organizationId` becomes purely the *home / default active org* pointer. `Membership` is the single source of truth for role + `canCommit`.

### Data migration

Backfill one `Membership { role: ADMIN, canCommit: true, expiresAt: null, status: ACTIVE }` for every existing user that has an `organizationId`. This keeps all current single-seat users working unchanged under the new model. (Org creator → Admin.)

> **Note on `searchTsv` drift:** `prisma/schema.prisma` intentionally omits the generated `searchTsv` tsvector column on `Title` (managed in migration `20260526103128_restore_title_fts`). This is documented benign drift — the membership migration must not touch it.

## 2. Permission resolution (`workspace.ts` / `scope.ts`)

- `scopeOrgIds` = home org ∪ every org where the user has an `ACTIVE` membership with `expiresAt == null || expiresAt > now()`. Expired rows are filtered **at request time** — the real security boundary. Agency client-org logic stays and unions in.
- **Effective role + `canCommit` become per-active-org**, resolved from the membership row (today `scope.role` is global). Add these to the `Workspace` / `Scope` type.
- New gate `canCommitOnOrg(scope, orgId)` wired onto accept-quote / place-order server actions. `canActOnOrg` keeps working, now sourced from memberships.
- **Active-org switching:** a member belonging to >1 org needs to pick which org is active. Reuse the existing agency active-org cookie mechanism in `workspace.ts` rather than inventing a second one — default active org = home org; switching sets the cookie, validated against `scopeOrgIds`. The per-active-org role/`canCommit` then resolves from that org's membership row.
- **JWT caveat:** `session.user.role`/`orgId` from the NextAuth JWT become *advisory only* — the authoritative per-active-org role + `canCommit` are resolved server-side from `Membership` on each request, never trusted from the token (which can be stale after a role change or delegation expiry).

## 3. Expiry enforcement

- **Lazy (correctness):** handled by §2 — an expired delegation grants nothing the instant the timestamp passes; no job required for security.
- **Daily sweep (hygiene only):** a secret-protected `/api/cron/expire-memberships` route flips `ACTIVE → EXPIRED` for rows past `expiresAt`, and emails the org admin + delegate a heads-up. Idempotent. Triggered by a Railway cron (mirror any existing cron pattern; otherwise add this route + scheduler). Never the security boundary.

## 4. Invite & claim flow

1. **Admin** (org creator auto-Admin) → account settings → **Team** → *Invite*: email, role, `canCommit` toggle, optional delegation end-date.
2. Server action — **rejects non-Admin callers** — creates `OrgInvite` + token (`expiresAt` = +14d), sends a **multilingual invite email** via the existing email adapter (same builder pattern as `pricing/email.ts`).
3. Recipient hits `/invite/[token]`:
   - **not logged in** → invite details + sign-up (email pre-filled & pinned) or login → auto-claim after auth.
   - **logged in as the invited email** → one-click **Accept**.
   - **logged in as a different email** → mismatch notice (email-pinned; offer logout).
4. **Claim:** validate (exists / not expired / not claimed / email matches authenticated user) → create `Membership` copying `role`, `canCommit`, `expiresAt = delegationExpiresAt` → mark invite `claimedAt` / `claimedByUserId`.
   - Brand-new user with no home org → set `organizationId` to this org **and** create the membership.
   - Existing user → keep home org, just add the membership (multi-org).

## 5. Team-management UI (account settings)

- **Members** list: name, email, role, `canCommit`, status, expiry countdown (delegations), invited-by.
- **Pending invites**: email, role, link-expiry, resend / revoke.
- **Admin-only actions:** invite, edit role/canCommit, revoke membership, revoke invite.
- **Guardrail:** an org must always retain ≥1 Admin — cannot demote or remove the last one.

## 6. Edge cases & error handling

- Invite an email that is already an active member → reject with clear message.
- Duplicate pending invite for the same email → resend / replace existing, don't create a second.
- `delegationExpiresAt` in the past → reject at creation.
- Revoke a membership → `status = REVOKED`; scope drops on the next request.
- Expired invite link → friendly "ask the admin to re-send" page.
- Last-admin guardrail enforced in both the demote and revoke paths.

## 7. Testing strategy

- **Unit — permission resolution:** expired membership excluded from `scopeOrgIds`; `canCommit` gating on accept-quote; multi-org union; per-org role resolution.
- **Unit — claim logic:** token valid / expired / claimed / email-mismatch; new vs existing user; delegation `expiresAt` copied correctly; last-admin guardrail.
- **Integration — one test per scenario A–D** as the acceptance bar:
  - **A:** Sondre signs up via invite → Member, `canCommit: true` → can review & submit on Hovedstien.
  - **B:** Sondre = Member, `canCommit: false` → sees all plans/RFQs/orders, cannot accept a quote; Maja must.
  - **C:** Andreas = Restricted + `delegationExpiresAt: 2026-10-05` → has scoped access before, **zero access at request time after** the date; sweep marks `EXPIRED` + notifies.
  - **D:** publisher-side path unchanged (regression guard).

## Out of scope (v1)

- Agencies inviting users directly into client orgs (existing agency switch covers the read/write case).
- Full per-capability matrix beyond `canCommit` (YAGNI; can layer on later).
- Granular "within agreed parameters" approval thresholds for Andreas beyond Restricted + `canCommit: false` (escalation is via the existing desk-message flow).
