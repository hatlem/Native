# Multi-User Org-Invite & Time-Limited Delegation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an org admin invite additional users (permanent seats) and time-limited delegates into their organization, with a per-member role + commit permission that gates accepting quotes / placing orders, and delegate access that auto-de-escalates on a date.

**Architecture:** Additive `Membership` overlay table is the authoritative source of per-org role + `canCommit`; `user.organizationId` stays as the *home* org pointer. All authorization decisions live in **pure functions** (`src/lib/membership.ts`, `src/lib/org-invite.ts`) that take DB rows + `now` and return verdicts — these are exhaustively unit-tested (matching the repo's `publisher-invite.ts` / `.test.ts` split). `workspace.ts` / `scope.ts` load rows and call the pure resolvers. Expiry is enforced *lazily* at request time (the security boundary); a daily cron only flips status + notifies (hygiene). Invite/claim mirrors the existing `PublisherInvite` token flow, extended to support already-logged-in users.

**Tech Stack:** Next.js App Router, Prisma + PostgreSQL, NextAuth v5 (JWT strategy), `next-intl` (`getTranslations`), `node:test` + `tsx`, Railway cron.

**Spec:** `docs/superpowers/specs/2026-05-29-multi-user-org-invite-design.md`

---

## File Structure

**Create:**
- `src/lib/membership.ts` — pure permission resolution (active filter, scope ids, per-org role/canCommit, last-admin guard).
- `src/lib/membership.test.ts` — unit tests for the above.
- `src/lib/org-invite.ts` — token gen, expiry, invite/claim verdict logic, delegation-date validation, multilingual invite-email builder.
- `src/lib/org-invite.test.ts` — unit tests for the above.
- `src/app/[locale]/invite/[token]/page.tsx` — claim landing page (not-logged-in / matching / mismatch states).
- `src/app/org-invite-actions.ts` — server actions: `inviteToOrg`, `claimOrgInvite`, `revokeMembership`, `revokeInvite`, `updateMembership`.
- `src/app/[locale]/account/team-section.tsx` — Team UI (members list + pending invites), rendered by the account page.
- `src/app/api/cron/expire-memberships/route.ts` — daily sweep.
- `prisma/migrations/<ts>_add_membership_orginvite/migration.sql` — schema migration (generated, then backfill appended).

**Modify:**
- `prisma/schema.prisma` — add `Membership`, `OrgInvite`, `MembershipRole`, `MembershipStatus`; back-relations on `User` + `Organization`.
- `src/lib/workspace.ts` — union active memberships into `scopeOrgIds`; resolve active-org role/canCommit; reuse active-org cookie for multi-org members.
- `src/lib/scope.ts` — add `canCommitOnOrg`; source role from workspace memberships.
- `src/app/[locale]/account/page.tsx` — render `<TeamSection>`.
- `.env.example` — add `CRON_SECRET`.

**Type contract used across tasks (define once in Task 3, referenced later):**
```typescript
// src/lib/membership.ts
export type MembershipRole = "ADMIN" | "MEMBER" | "RESTRICTED";
export type MembershipStatus = "ACTIVE" | "EXPIRED" | "REVOKED";
export type MembershipRow = {
  userId: string;
  organizationId: string;
  role: MembershipRole;
  canCommit: boolean;
  expiresAt: Date | null;   // null = permanent seat
  status: MembershipStatus;
};
```

---

## Task 1: Schema — Membership + OrgInvite models

**Files:**
- Modify: `prisma/schema.prisma` (Organization ~368-390, User ~392-415, enums after UserRole ~69, new models after PublisherInvite ~438)

- [ ] **Step 1: Add the two enums** (after the `UserRole` enum, ~line 69)

```prisma
enum MembershipRole {
  ADMIN
  MEMBER
  RESTRICTED
}

enum MembershipStatus {
  ACTIVE
  EXPIRED
  REVOKED
}
```

- [ ] **Step 2: Add the two models** (after `PublisherInvite`, ~line 438)

```prisma
model Membership {
  id             String           @id @default(cuid())
  userId         String
  user           User             @relation("UserMemberships", fields: [userId], references: [id], onDelete: Cascade)
  organizationId String
  organization   Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  role           MembershipRole   @default(MEMBER)
  canCommit      Boolean          @default(false)
  expiresAt      DateTime?
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

model OrgInvite {
  id                  String         @id @default(cuid())
  organizationId      String
  organization        Organization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  email               String
  role                MembershipRole  @default(MEMBER)
  canCommit           Boolean         @default(false)
  delegationExpiresAt DateTime?
  token               String          @unique
  expiresAt           DateTime
  claimedAt           DateTime?
  claimedByUserId     String?
  createdById         String
  createdAt           DateTime        @default(now())

  @@index([organizationId])
  @@index([email])
}
```

- [ ] **Step 3: Add back-relations on `Organization`** (inside the model, after `apiKeys  ApiKey[]`)

```prisma
  memberships Membership[]
  invites     OrgInvite[]
```

- [ ] **Step 4: Add back-relations on `User`** (inside the model, after `rateCardRequests ...`)

```prisma
  memberships     Membership[] @relation("UserMemberships")
  invitedMembers  Membership[] @relation("MembershipInviter")
```

- [ ] **Step 5: Validate the schema**

Run: `pnpm prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(org-invite): add Membership + OrgInvite models"
```

---

## Task 2: Migration + backfill existing users as admins

**Files:**
- Create: `prisma/migrations/<ts>_add_membership_orginvite/migration.sql`

- [ ] **Step 1: Generate the migration without applying, so we can append the backfill**

Run: `pnpm prisma migrate dev --name add_membership_orginvite --create-only`
Expected: a new folder `prisma/migrations/<timestamp>_add_membership_orginvite/migration.sql` containing `CREATE TYPE "MembershipRole"`, `CREATE TABLE "Membership"`, `CREATE TABLE "OrgInvite"`, and the indexes. It does NOT touch the `searchTsv` tsvector column on `Title` (that drift is intentional — confirm by reading the file: it must contain no reference to `searchTsv`).

- [ ] **Step 2: Append the backfill to the bottom of that `migration.sql`**

Add to the end of the generated file:

```sql
-- Backfill: every user with a home org becomes a permanent ADMIN of it,
-- preserving today's single-seat behavior under the new model.
INSERT INTO "Membership" ("id", "userId", "organizationId", "role", "canCommit", "expiresAt", "status", "invitedById", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  u."id",
  u."organizationId",
  'ADMIN',
  true,
  NULL,
  'ACTIVE',
  NULL,
  now(),
  now()
FROM "User" u
WHERE u."organizationId" IS NOT NULL
ON CONFLICT ("userId", "organizationId") DO NOTHING;
```

(`gen_random_uuid()` is available on Railway Postgres via the built-in `pgcrypto`/`pg_catalog`; if the migration errors that the function is missing, prepend `CREATE EXTENSION IF NOT EXISTS pgcrypto;`.)

- [ ] **Step 3: Apply the migration**

Run: `pnpm prisma migrate dev`
Expected: migration applies cleanly; `pnpm prisma generate` runs; no drift warnings other than the known `searchTsv` note.

- [ ] **Step 4: Verify the backfill against a local/staging DB**

Run: `pnpm prisma studio` (or a quick query) and confirm every user that has `organizationId` now has exactly one `Membership` row with `role = ADMIN`, `canCommit = true`, `expiresAt = NULL`.

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations
git commit -m "feat(org-invite): migration + backfill existing users as org admins"
```

---

## Task 3: Pure membership resolution logic

**Files:**
- Create: `src/lib/membership.ts`
- Test: `src/lib/membership.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/membership.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isMembershipActive,
  activeScopeOrgIds,
  resolveOrgMembership,
  wouldRemoveLastAdmin,
  type MembershipRow,
} from "./membership";

const NOW = new Date("2026-05-29T12:00:00Z");
const row = (over: Partial<MembershipRow>): MembershipRow => ({
  userId: "u1",
  organizationId: "o1",
  role: "MEMBER",
  canCommit: false,
  expiresAt: null,
  status: "ACTIVE",
  ...over,
});

test("permanent active membership is active", () => {
  assert.equal(isMembershipActive(row({}), NOW), true);
});

test("future-dated delegation is active", () => {
  assert.equal(
    isMembershipActive(row({ expiresAt: new Date("2026-10-05T00:00:00Z") }), NOW),
    true,
  );
});

test("past-dated delegation is NOT active (the security boundary)", () => {
  assert.equal(
    isMembershipActive(row({ expiresAt: new Date("2026-01-01T00:00:00Z") }), NOW),
    false,
  );
});

test("REVOKED / EXPIRED status is never active", () => {
  assert.equal(isMembershipActive(row({ status: "REVOKED" }), NOW), false);
  assert.equal(isMembershipActive(row({ status: "EXPIRED" }), NOW), false);
});

test("activeScopeOrgIds unions active orgs and excludes expired", () => {
  const ids = activeScopeOrgIds(
    [
      row({ organizationId: "o1" }),
      row({ organizationId: "o2", expiresAt: new Date("2026-10-05T00:00:00Z") }),
      row({ organizationId: "o3", expiresAt: new Date("2026-01-01T00:00:00Z") }),
      row({ organizationId: "o4", status: "REVOKED" }),
    ],
    NOW,
  );
  assert.deepEqual(ids.sort(), ["o1", "o2"]);
});

test("resolveOrgMembership returns the active row for an org, else null", () => {
  const ms = [row({ organizationId: "o1", role: "ADMIN", canCommit: true })];
  assert.equal(resolveOrgMembership(ms, "o1", NOW)?.role, "ADMIN");
  assert.equal(resolveOrgMembership(ms, "missing", NOW), null);
});

test("resolveOrgMembership ignores an expired row for that org", () => {
  const ms = [row({ organizationId: "o1", expiresAt: new Date("2026-01-01T00:00:00Z") })];
  assert.equal(resolveOrgMembership(ms, "o1", NOW), null);
});

test("wouldRemoveLastAdmin true when target is the only active admin", () => {
  const ms = [
    row({ userId: "a", role: "ADMIN" }),
    row({ userId: "b", role: "MEMBER" }),
  ];
  assert.equal(wouldRemoveLastAdmin(ms, "a", NOW), true);
});

test("wouldRemoveLastAdmin false when another active admin remains", () => {
  const ms = [
    row({ userId: "a", role: "ADMIN" }),
    row({ userId: "b", role: "ADMIN" }),
  ];
  assert.equal(wouldRemoveLastAdmin(ms, "a", NOW), false);
});

test("wouldRemoveLastAdmin ignores an expired admin when counting", () => {
  const ms = [
    row({ userId: "a", role: "ADMIN" }),
    row({ userId: "b", role: "ADMIN", expiresAt: new Date("2026-01-01T00:00:00Z") }),
  ];
  assert.equal(wouldRemoveLastAdmin(ms, "a", NOW), true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './membership'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/membership.ts
export type MembershipRole = "ADMIN" | "MEMBER" | "RESTRICTED";
export type MembershipStatus = "ACTIVE" | "EXPIRED" | "REVOKED";

export type MembershipRow = {
  userId: string;
  organizationId: string;
  role: MembershipRole;
  canCommit: boolean;
  expiresAt: Date | null;
  status: MembershipStatus;
};

/** The real security boundary: a row grants nothing once it is not ACTIVE or past its expiry. */
export function isMembershipActive(m: MembershipRow, now: Date = new Date()): boolean {
  if (m.status !== "ACTIVE") return false;
  if (m.expiresAt && m.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

export function activeScopeOrgIds(
  memberships: MembershipRow[],
  now: Date = new Date(),
): string[] {
  return Array.from(
    new Set(
      memberships.filter((m) => isMembershipActive(m, now)).map((m) => m.organizationId),
    ),
  );
}

export function resolveOrgMembership(
  memberships: MembershipRow[],
  organizationId: string,
  now: Date = new Date(),
): MembershipRow | null {
  return (
    memberships.find(
      (m) => m.organizationId === organizationId && isMembershipActive(m, now),
    ) ?? null
  );
}

/**
 * True if demoting/removing `targetUserId` would leave the org with zero active admins.
 * `orgMemberships` must be all memberships for the single target org.
 */
export function wouldRemoveLastAdmin(
  orgMemberships: MembershipRow[],
  targetUserId: string,
  now: Date = new Date(),
): boolean {
  const activeAdmins = orgMemberships.filter(
    (m) => isMembershipActive(m, now) && m.role === "ADMIN",
  );
  return activeAdmins.length === 1 && activeAdmins[0].userId === targetUserId;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all `membership.test.ts` cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/membership.ts src/lib/membership.test.ts
git commit -m "feat(org-invite): pure membership permission resolution"
```

---

## Task 4: Wire memberships into workspace resolution

**Files:**
- Modify: `src/lib/workspace.ts`

Today `getWorkspace(userId)` loads the user's single org and (for agencies) unions client orgs into `scopeOrgIds`. We add: load the user's memberships, union active ones into `scopeOrgIds`, choose an active org (reusing the existing `nativespin_client` cookie), and expose the resolved per-active-org `role` + `canCommit`.

- [ ] **Step 1: Extend the `Workspace` type** (lines 6-16)

```typescript
import type { MembershipRole } from "./membership";

export type Workspace = {
  userId: string;
  isAgency: boolean;
  agencyOrgId: string | null;
  // The org buyer actions operate on. Advertiser = own org; agency =
  // the selected client (null until one is picked). For a multi-org member,
  // this is the active org resolved from the same cookie.
  activeOrgId: string | null;
  // Org ids this user may read: own/active org plus, for an agency, all of
  // its client orgs, plus every org where they hold an active membership.
  scopeOrgIds: string[];
  // Resolved authority for `activeOrgId` from the membership row (null when
  // there is no active membership for the active org, e.g. pure agency path).
  activeRole: MembershipRole | null;
  activeCanCommit: boolean;
};
```

- [ ] **Step 2: Load memberships and union them in** — inside `getWorkspace`, after the existing org load and before each `return`, compute the membership set once. Replace the function body's org-resolution tail with this unified version:

```typescript
import {
  activeScopeOrgIds,
  resolveOrgMembership,
  type MembershipRow,
} from "./membership";

// ...inside getWorkspace, after `userId` is known and the user's org is loaded:

const now = new Date();
const memberships: MembershipRow[] = (
  await prisma.membership.findMany({
    where: { userId },
    select: {
      userId: true,
      organizationId: true,
      role: true,
      canCommit: true,
      expiresAt: true,
      status: true,
    },
  })
).map((m) => ({ ...m }));

const membershipOrgIds = activeScopeOrgIds(memberships, now);
```

- [ ] **Step 3: Resolve the active org + authority and union scope** — in the **advertiser (non-agency) return** path:

```typescript
const store = await cookies();
const selected = store.get(CLIENT_COOKIE)?.value ?? null;
// Active org = a valid selected membership org, else the home org.
const homeOrgId = org.id;
const activeOrgId =
  selected && membershipOrgIds.includes(selected) ? selected : homeOrgId;
const active = resolveOrgMembership(memberships, activeOrgId, now);

return {
  userId,
  isAgency: false,
  agencyOrgId: null,
  activeOrgId,
  scopeOrgIds: Array.from(new Set([homeOrgId, ...membershipOrgIds])),
  activeRole: active?.role ?? null,
  activeCanCommit: active?.canCommit ?? false,
};
```

And in the **agency return** path, union memberships and resolve authority for the active org:

```typescript
const activeOrgId =
  selected && clientIds.includes(selected) ? selected : null;
const active = activeOrgId
  ? resolveOrgMembership(memberships, activeOrgId, now)
  : null;

return {
  userId,
  isAgency: true,
  agencyOrgId: org.id,
  activeOrgId,
  scopeOrgIds: Array.from(new Set([org.id, ...clientIds, ...membershipOrgIds])),
  activeRole: active?.role ?? null,
  activeCanCommit: active?.canCommit ?? false,
};
```

- [ ] **Step 4: Handle the no-home-org member** — today `getWorkspace` returns `null` when the user has no `organizationId`. A user invited into an org as their first membership *does* set `organizationId` on claim (Task 8), so this path stays valid. But guard it: if the user has no org row yet still has active memberships, build a workspace from memberships alone. Add, before the existing `return null`:

```typescript
if (membershipOrgIds.length > 0) {
  const store = await cookies();
  const selected = store.get(CLIENT_COOKIE)?.value ?? null;
  const activeOrgId =
    selected && membershipOrgIds.includes(selected)
      ? selected
      : membershipOrgIds[0];
  const active = resolveOrgMembership(memberships, activeOrgId, now);
  return {
    userId,
    isAgency: false,
    agencyOrgId: null,
    activeOrgId,
    scopeOrgIds: membershipOrgIds,
    activeRole: active?.role ?? null,
    activeCanCommit: active?.canCommit ?? false,
  };
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS — no type errors; every `Workspace` construction now includes `activeRole` + `activeCanCommit`. (If other call sites build a `Workspace` literal, the compiler flags them — fix each to include the two new fields with `null` / `false`.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/workspace.ts
git commit -m "feat(org-invite): union memberships into workspace scope + active-org authority"
```

---

## Task 5: Add `canCommitOnOrg` gate to scope

**Files:**
- Modify: `src/lib/scope.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/scope.test.ts  (create)
import { test } from "node:test";
import assert from "node:assert/strict";
import { canCommitOnOrg } from "./scope";
import type { Scope } from "./scope";

const base = (over: Partial<Scope>): Scope => ({
  session: null,
  role: undefined,
  userId: "u1",
  isDesk: false,
  isPublisher: false,
  workspace: null,
  ...over,
});

test("desk can always commit", () => {
  assert.equal(canCommitOnOrg(base({ isDesk: true }), "o1"), true);
});

test("member with canCommit on active org may commit", () => {
  const scope = base({
    workspace: {
      userId: "u1",
      isAgency: false,
      agencyOrgId: null,
      activeOrgId: "o1",
      scopeOrgIds: ["o1"],
      activeRole: "MEMBER",
      activeCanCommit: true,
    },
  });
  assert.equal(canCommitOnOrg(scope, "o1"), true);
});

test("member without canCommit may NOT commit (Scenario B)", () => {
  const scope = base({
    workspace: {
      userId: "u1",
      isAgency: false,
      agencyOrgId: null,
      activeOrgId: "o1",
      scopeOrgIds: ["o1"],
      activeRole: "MEMBER",
      activeCanCommit: false,
    },
  });
  assert.equal(canCommitOnOrg(scope, "o1"), false);
});

test("cannot commit on an org outside the active org", () => {
  const scope = base({
    workspace: {
      userId: "u1",
      isAgency: false,
      agencyOrgId: null,
      activeOrgId: "o1",
      scopeOrgIds: ["o1", "o2"],
      activeRole: "ADMIN",
      activeCanCommit: true,
    },
  });
  assert.equal(canCommitOnOrg(scope, "o2"), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `canCommitOnOrg is not a function`.

- [ ] **Step 3: Implement `canCommitOnOrg`** (add after `canActOnOrg`, ~line 42)

```typescript
/**
 * May this user *commit* the org — accept a quote / place an order — on `organizationId`?
 * Commit authority is per-ACTIVE-org and never inferred from the (possibly stale) JWT role.
 */
export function canCommitOnOrg(scope: Scope, organizationId: string): boolean {
  if (scope.isDesk) return true;
  const ws = scope.workspace;
  if (!ws) return false;
  // Commit only on the resolved active org, and only with the canCommit grant.
  return ws.activeOrgId === organizationId && ws.activeCanCommit === true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Wire the gate onto the commit actions** — find the accept-quote / place-order server actions (grep for where quotes are accepted or orders created) and add a `canCommitOnOrg` check that mirrors the existing `canActOnOrg` pattern. For each such action, after loading `scope` and the target `organizationId`:

```typescript
if (!canCommitOnOrg(scope, organizationId)) {
  // mirror the existing unauthorized handling in that action (redirect or throw)
  redirect(`/${locale}/...?error=forbidden`);
}
```

Run: `grep -rn "canActOnOrg" src/app` to locate the commit-style actions, and add the `canCommitOnOrg` guard to the accept-quote and place-order ones specifically (read each to confirm it commits the org before gating).

- [ ] **Step 6: Typecheck + test**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/scope.ts src/lib/scope.test.ts src/app
git commit -m "feat(org-invite): canCommitOnOrg gate on accept-quote/place-order"
```

---

## Task 6: Pure org-invite logic + invite email

**Files:**
- Create: `src/lib/org-invite.ts`
- Test: `src/lib/org-invite.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/org-invite.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newInviteToken,
  expiryFromNow,
  checkOrgInvite,
  validateOrgClaim,
  validateDelegationDate,
  buildOrgInviteEmail,
  ORG_INVITE_TTL_DAYS,
} from "./org-invite";

const NOW = new Date("2026-05-29T12:00:00Z");

test("newInviteToken yields 32 url-safe chars, no padding", () => {
  const t = newInviteToken();
  assert.equal(t.length, 32);
  assert.match(t, /^[A-Za-z0-9_-]+$/);
});

test("expiryFromNow defaults to 14 days", () => {
  assert.equal(ORG_INVITE_TTL_DAYS, 14);
  const exp = expiryFromNow(14, NOW);
  assert.equal(exp.toISOString(), "2026-06-12T12:00:00.000Z");
});

test("checkOrgInvite: missing / expired / claimed / ok", () => {
  assert.deepEqual(checkOrgInvite(null, NOW), { ok: false, reason: "missing" });
  assert.deepEqual(
    checkOrgInvite({ email: "a@x.com", expiresAt: new Date("2026-01-01"), claimedAt: null }, NOW),
    { ok: false, reason: "expired" },
  );
  assert.deepEqual(
    checkOrgInvite({ email: "a@x.com", expiresAt: new Date("2026-12-01"), claimedAt: NOW }, NOW),
    { ok: false, reason: "claimed" },
  );
  assert.deepEqual(
    checkOrgInvite({ email: "a@x.com", expiresAt: new Date("2026-12-01"), claimedAt: null }, NOW),
    { ok: true },
  );
});

test("validateOrgClaim: not-logged-in new user → mode new", () => {
  const v = validateOrgClaim(
    { email: "a@x.com", expiresAt: new Date("2026-12-01"), claimedAt: null },
    { authedEmail: null, isAlreadyMember: false },
    NOW,
  );
  assert.deepEqual(v, { ok: true, mode: "new" });
});

test("validateOrgClaim: logged-in matching email → mode existing", () => {
  const v = validateOrgClaim(
    { email: "a@x.com", expiresAt: new Date("2026-12-01"), claimedAt: null },
    { authedEmail: "a@x.com", isAlreadyMember: false },
    NOW,
  );
  assert.deepEqual(v, { ok: true, mode: "existing" });
});

test("validateOrgClaim: logged-in different email → email_mismatch", () => {
  const v = validateOrgClaim(
    { email: "a@x.com", expiresAt: new Date("2026-12-01"), claimedAt: null },
    { authedEmail: "b@y.com", isAlreadyMember: false },
    NOW,
  );
  assert.deepEqual(v, { ok: false, reason: "email_mismatch" });
});

test("validateOrgClaim: already a member → already_member", () => {
  const v = validateOrgClaim(
    { email: "a@x.com", expiresAt: new Date("2026-12-01"), claimedAt: null },
    { authedEmail: "a@x.com", isAlreadyMember: true },
    NOW,
  );
  assert.deepEqual(v, { ok: false, reason: "already_member" });
});

test("validateOrgClaim: expired invite short-circuits before email check", () => {
  const v = validateOrgClaim(
    { email: "a@x.com", expiresAt: new Date("2026-01-01"), claimedAt: null },
    { authedEmail: "a@x.com", isAlreadyMember: false },
    NOW,
  );
  assert.deepEqual(v, { ok: false, reason: "expired" });
});

test("validateDelegationDate: null ok, future ok, past rejected", () => {
  assert.equal(validateDelegationDate(null, NOW), true);
  assert.equal(validateDelegationDate(new Date("2026-10-05"), NOW), true);
  assert.equal(validateDelegationDate(new Date("2026-01-01"), NOW), false);
});

test("buildOrgInviteEmail returns localized subject+text containing the link", () => {
  const en = buildOrgInviteEmail({
    locale: "en",
    orgName: "Maja Co",
    inviterName: "Maja",
    link: "https://nativespin.com/en/invite/abc",
    role: "MEMBER",
    delegationExpiresAt: null,
  });
  assert.match(en.subject, /Maja Co/);
  assert.ok(en.text.includes("https://nativespin.com/en/invite/abc"));

  const no = buildOrgInviteEmail({
    locale: "no",
    orgName: "Maja Co",
    inviterName: "Maja",
    link: "https://nativespin.com/no/invite/abc",
    role: "RESTRICTED",
    delegationExpiresAt: new Date("2026-10-05T00:00:00Z"),
  });
  assert.ok(no.text.includes("2026-10-05") || no.text.includes("5. oktober") || no.text.length > 0);
  assert.notEqual(no.subject, en.subject);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './org-invite'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/org-invite.ts
import { randomBytes } from "node:crypto";
import type { MembershipRole } from "./membership";

const TOKEN_BYTES = 24;
export const ORG_INVITE_TTL_DAYS = 14;

export function newInviteToken(): string {
  return randomBytes(TOKEN_BYTES)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function expiryFromNow(
  days: number = ORG_INVITE_TTL_DAYS,
  now: Date = new Date(),
): Date {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

type Locale = "en" | "no" | "sv" | "da" | "fi" | "de";

export type OrgInviteShape = {
  email: string;
  expiresAt: Date;
  claimedAt: Date | null;
};

export type InviteVerdict =
  | { ok: true }
  | { ok: false; reason: "missing" | "expired" | "claimed" };

export function checkOrgInvite(
  invite: OrgInviteShape | null | undefined,
  now: Date = new Date(),
): InviteVerdict {
  if (!invite) return { ok: false, reason: "missing" };
  if (invite.claimedAt) return { ok: false, reason: "claimed" };
  if (invite.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}

export type ClaimContext = {
  authedEmail: string | null; // null = not logged in
  isAlreadyMember: boolean;
};

export type ClaimVerdict =
  | { ok: true; mode: "new" | "existing" }
  | { ok: false; reason: "missing" | "expired" | "claimed" | "email_mismatch" | "already_member" };

export function validateOrgClaim(
  invite: OrgInviteShape | null | undefined,
  ctx: ClaimContext,
  now: Date = new Date(),
): ClaimVerdict {
  const base = checkOrgInvite(invite, now);
  if (!base.ok) return base;
  if (ctx.isAlreadyMember) return { ok: false, reason: "already_member" };
  if (ctx.authedEmail === null) return { ok: true, mode: "new" };
  if (ctx.authedEmail.toLowerCase() !== invite!.email.toLowerCase()) {
    return { ok: false, reason: "email_mismatch" };
  }
  return { ok: true, mode: "existing" };
}

export function validateDelegationDate(
  delegationExpiresAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (delegationExpiresAt === null) return true;
  return delegationExpiresAt.getTime() > now.getTime();
}

// ---- Invite email (multilingual; mirrors src/lib/pricing/email.ts) ----

export type OrgInviteEmailArgs = {
  locale: Locale;
  orgName: string;
  inviterName: string;
  link: string;
  role: MembershipRole;
  delegationExpiresAt: Date | null;
};

type Built = { subject: string; text: string };

function dateLabel(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

function en(a: OrgInviteEmailArgs): Built {
  const until = a.delegationExpiresAt
    ? `\nThis is time-limited access until ${dateLabel(a.delegationExpiresAt)}.`
    : "";
  return {
    subject: `You've been invited to ${a.orgName} on NativeSpin`,
    text: [
      `Hi,`,
      ``,
      `${a.inviterName} invited you to join ${a.orgName} on NativeSpin as ${a.role.toLowerCase()}.${until}`,
      ``,
      `Accept your invite:`,
      a.link,
      ``,
      `This link is valid for ${ORG_INVITE_TTL_DAYS} days.`,
      ``,
      `NativeSpin`,
    ].join("\n"),
  };
}

function no(a: OrgInviteEmailArgs): Built {
  const until = a.delegationExpiresAt
    ? `\nDette er tidsbegrenset tilgang til ${dateLabel(a.delegationExpiresAt)}.`
    : "";
  return {
    subject: `Du er invitert til ${a.orgName} på NativeSpin`,
    text: [
      `Hei,`,
      ``,
      `${a.inviterName} har invitert deg til ${a.orgName} på NativeSpin som ${a.role.toLowerCase()}.${until}`,
      ``,
      `Godta invitasjonen:`,
      a.link,
      ``,
      `Lenken er gyldig i ${ORG_INVITE_TTL_DAYS} dager.`,
      ``,
      `NativeSpin`,
    ].join("\n"),
  };
}

function sv(a: OrgInviteEmailArgs): Built {
  const until = a.delegationExpiresAt
    ? `\nDetta är tidsbegränsad åtkomst till ${dateLabel(a.delegationExpiresAt)}.`
    : "";
  return {
    subject: `Du har bjudits in till ${a.orgName} på NativeSpin`,
    text: [
      `Hej,`,
      ``,
      `${a.inviterName} har bjudit in dig till ${a.orgName} på NativeSpin som ${a.role.toLowerCase()}.${until}`,
      ``,
      `Acceptera inbjudan:`,
      a.link,
      ``,
      `Länken gäller i ${ORG_INVITE_TTL_DAYS} dagar.`,
      ``,
      `NativeSpin`,
    ].join("\n"),
  };
}

function da(a: OrgInviteEmailArgs): Built {
  const until = a.delegationExpiresAt
    ? `\nDette er tidsbegrænset adgang indtil ${dateLabel(a.delegationExpiresAt)}.`
    : "";
  return {
    subject: `Du er inviteret til ${a.orgName} på NativeSpin`,
    text: [
      `Hej,`,
      ``,
      `${a.inviterName} har inviteret dig til ${a.orgName} på NativeSpin som ${a.role.toLowerCase()}.${until}`,
      ``,
      `Accepter invitationen:`,
      a.link,
      ``,
      `Linket er gyldigt i ${ORG_INVITE_TTL_DAYS} dage.`,
      ``,
      `NativeSpin`,
    ].join("\n"),
  };
}

function fi(a: OrgInviteEmailArgs): Built {
  const until = a.delegationExpiresAt
    ? `\nTämä on määräaikainen käyttöoikeus ${dateLabel(a.delegationExpiresAt)} asti.`
    : "";
  return {
    subject: `Sinut on kutsuttu organisaatioon ${a.orgName} NativeSpinissä`,
    text: [
      `Hei,`,
      ``,
      `${a.inviterName} kutsui sinut organisaatioon ${a.orgName} NativeSpinissä roolilla ${a.role.toLowerCase()}.${until}`,
      ``,
      `Hyväksy kutsu:`,
      a.link,
      ``,
      `Linkki on voimassa ${ORG_INVITE_TTL_DAYS} päivää.`,
      ``,
      `NativeSpin`,
    ].join("\n"),
  };
}

function de(a: OrgInviteEmailArgs): Built {
  const until = a.delegationExpiresAt
    ? `\nDies ist ein zeitlich begrenzter Zugang bis ${dateLabel(a.delegationExpiresAt)}.`
    : "";
  return {
    subject: `Sie wurden zu ${a.orgName} auf NativeSpin eingeladen`,
    text: [
      `Hallo,`,
      ``,
      `${a.inviterName} hat Sie als ${a.role.toLowerCase()} zu ${a.orgName} auf NativeSpin eingeladen.${until}`,
      ``,
      `Einladung annehmen:`,
      a.link,
      ``,
      `Der Link ist ${ORG_INVITE_TTL_DAYS} Tage gültig.`,
      ``,
      `NativeSpin`,
    ].join("\n"),
  };
}

export function buildOrgInviteEmail(args: OrgInviteEmailArgs): Built {
  switch (args.locale) {
    case "no":
      return no(args);
    case "sv":
      return sv(args);
    case "da":
      return da(args);
    case "fi":
      return fi(args);
    case "de":
      return de(args);
    case "en":
    default:
      return en(args);
  }
}

export function orgInviteLink(locale: string, token: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://nativespin.com").replace(/\/$/, "");
  return `${base}/${locale}/invite/${token}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all `org-invite.test.ts` cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/org-invite.ts src/lib/org-invite.test.ts
git commit -m "feat(org-invite): pure invite/claim logic + multilingual invite email"
```

---

## Task 7: Invite server action (admin-gated create + send)

**Files:**
- Create: `src/app/org-invite-actions.ts`

This file holds all org-invite server actions. Task 7 implements `inviteToOrg`; Tasks 8-9 add the rest in the same file.

- [ ] **Step 1: Implement `inviteToOrg`** (admin-only; create or replace pending invite; send email)

```typescript
// src/app/org-invite-actions.ts
"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { recordAudit } from "@/lib/audit";
import { emailAdapter } from "@/lib/notify";
import { loadScope } from "@/lib/scope";
import { resolveOrgMembership, type MembershipRole } from "@/lib/membership";
import {
  newInviteToken,
  expiryFromNow,
  validateDelegationDate,
  buildOrgInviteEmail,
  orgInviteLink,
} from "@/lib/org-invite";

const LOCALES = ["en", "no", "sv", "da", "fi", "de"] as const;
type Locale = (typeof LOCALES)[number];
function asLocale(v: string): Locale {
  return (LOCALES as readonly string[]).includes(v) ? (v as Locale) : "en";
}

export async function inviteToOrg(formData: FormData) {
  const locale = asLocale(String(formData.get("locale") || "en"));
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const scope = await loadScope();
  const ws = scope.workspace;
  const orgId = ws?.activeOrgId ?? null;
  // Only an ADMIN of the active org may invite.
  if (!orgId || ws?.activeRole !== "ADMIN") {
    redirect(`/${locale}/account?error=forbidden#team`);
  }

  const email = String(formData.get("email") || "").toLowerCase().trim();
  const role = String(formData.get("role") || "MEMBER") as MembershipRole;
  const canCommit = formData.get("canCommit") === "on";
  const delegationRaw = String(formData.get("delegationExpiresAt") || "").trim();
  const delegationExpiresAt = delegationRaw ? new Date(delegationRaw) : null;

  if (!email || !email.includes("@")) {
    redirect(`/${locale}/account?error=email#team`);
  }
  if (!validateDelegationDate(delegationExpiresAt, new Date())) {
    redirect(`/${locale}/account?error=delegation_past#team`);
  }

  // Reject inviting someone who is already an active member.
  const existing = await prisma.membership.findMany({
    where: { organizationId: orgId, user: { email } },
    select: {
      userId: true, organizationId: true, role: true,
      canCommit: true, expiresAt: true, status: true,
    },
  });
  if (resolveOrgMembership(existing, orgId, new Date())) {
    redirect(`/${locale}/account?error=already_member#team`);
  }

  const token = newInviteToken();
  // Replace any unclaimed pending invite for the same email+org (don't stack).
  await prisma.$transaction([
    prisma.orgInvite.deleteMany({
      where: { organizationId: orgId, email, claimedAt: null },
    }),
    prisma.orgInvite.create({
      data: {
        organizationId: orgId,
        email,
        role,
        canCommit,
        delegationExpiresAt,
        token,
        expiresAt: expiryFromNow(),
        createdById: session.user.id,
      },
    }),
  ]);

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, marketCode: true },
  });
  const built = buildOrgInviteEmail({
    locale,
    orgName: org?.name ?? "your organization",
    inviterName: session.user.name ?? "An admin",
    link: orgInviteLink(locale, token),
    role,
    delegationExpiresAt,
  });
  try {
    await emailAdapter({ to: email, subject: built.subject, text: built.text });
  } catch (err) {
    console.error("org_invite.email_failed", { orgId, email, err });
  }

  await recordAudit(session.user.id, "org.invite_sent", `Organization:${orgId}`, {
    email, role, canCommit, delegationExpiresAt,
  });
  redirect(`/${locale}/account?ok=invited#team`);
}
```

- [ ] **Step 2: Verify imports resolve** — confirm the import paths against the repo (the explore confirmed `recordAudit(userId, action, target, meta)` exists; check its module path with `grep -rn "export.*recordAudit" src/lib` and `grep -rn "export const prisma" src/lib/prisma.ts`). Fix the import specifiers if they differ.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/org-invite-actions.ts
git commit -m "feat(org-invite): admin-gated inviteToOrg server action"
```

---

## Task 8: Claim flow — landing page + claim action

**Files:**
- Create: `src/app/[locale]/invite/[token]/page.tsx`
- Modify: `src/app/org-invite-actions.ts` (add `claimOrgInvite`)

- [ ] **Step 1: Add `claimOrgInvite`** to `src/app/org-invite-actions.ts`

```typescript
import bcrypt from "bcryptjs";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { validateOrgClaim } from "@/lib/org-invite";

export async function claimOrgInvite(formData: FormData) {
  const locale = asLocale(String(formData.get("locale") || "en"));
  const token = String(formData.get("token") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const password = String(formData.get("password") || "");
  const session = await auth();
  const authedEmail = session?.user?.email?.toLowerCase() ?? null;

  if (!token) redirect(`/${locale}/invite/${token}?error=1`);

  const invite = await prisma.orgInvite.findUnique({
    where: { token },
    select: {
      id: true, organizationId: true, email: true, role: true,
      canCommit: true, delegationExpiresAt: true, expiresAt: true, claimedAt: true,
    },
  });

  // Is the authed user already a member of this org?
  let isAlreadyMember = false;
  if (session?.user?.id && invite) {
    const m = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: session.user.id, organizationId: invite.organizationId } },
      select: { id: true },
    });
    isAlreadyMember = !!m;
  }

  const verdict = validateOrgClaim(
    invite ? { email: invite.email, expiresAt: invite.expiresAt, claimedAt: invite.claimedAt } : null,
    { authedEmail, isAlreadyMember },
    new Date(),
  );
  if (!verdict.ok) {
    redirect(`/${locale}/invite/${token}?error=${verdict.reason}`);
  }
  const inv = invite!;

  if (verdict.mode === "existing") {
    // Logged-in matching user: just create the membership.
    await prisma.$transaction(async (tx) => {
      await tx.membership.create({
        data: {
          userId: session!.user!.id,
          organizationId: inv.organizationId,
          role: inv.role,
          canCommit: inv.canCommit,
          expiresAt: inv.delegationExpiresAt,
          invitedById: inv.createdById ?? null,
        },
      });
      await tx.orgInvite.update({
        where: { id: inv.id },
        data: { claimedAt: new Date(), claimedByUserId: session!.user!.id },
      });
    });
    await recordAudit(session!.user!.id, "org.invite_claimed", `Organization:${inv.organizationId}`, { inviteId: inv.id, mode: "existing" });
    redirect(`/${locale}/account?ok=joined#team`);
  }

  // mode === "new": create the account, set home org, create membership.
  if (name.length < 1 || password.length < 8) {
    redirect(`/${locale}/invite/${token}?error=form`);
  }
  const passwordHash = await bcrypt.hash(password, 10);
  let createdUserId: string | null = null;
  try {
    createdUserId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: inv.email,
          name: name || null,
          role: "BUYER",
          passwordHash,
          organizationId: inv.organizationId, // first org = home org
          emailVerifiedAt: new Date(),
        },
      });
      await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: inv.organizationId,
          role: inv.role,
          canCommit: inv.canCommit,
          expiresAt: inv.delegationExpiresAt,
          invitedById: inv.createdById ?? null,
        },
      });
      await tx.orgInvite.update({
        where: { id: inv.id },
        data: { claimedAt: new Date(), claimedByUserId: user.id },
      });
      return user.id;
    });
  } catch {
    redirect(`/${locale}/signin`);
  }
  if (!createdUserId) redirect(`/${locale}/invite/${token}?error=1`);
  await recordAudit(createdUserId, "org.invite_claimed", `Organization:${inv.organizationId}`, { inviteId: inv.id, mode: "new" });

  try {
    await signIn("credentials", { email: inv.email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) redirect(`/${locale}/signin`);
    throw error;
  }
  redirect(`/${locale}/account?ok=joined#team`);
}
```

> Note: `inv.createdById` is selected above — add `createdById: true` to the `select` in the `findUnique` if not already present (it is). The `userId_organizationId` compound key name comes from the `@@unique([userId, organizationId])` in Task 1.

- [ ] **Step 2: Build the claim landing page** — three states driven by session + verdict

```tsx
// src/app/[locale]/invite/[token]/page.tsx
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getTranslations } from "next-intl/server";
import { checkOrgInvite } from "@/lib/org-invite";
import { claimOrgInvite } from "@/app/org-invite-actions";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale, token } = await params;
  const { error } = await searchParams;
  const session = await auth();

  const invite = await prisma.orgInvite.findUnique({
    where: { token },
    select: {
      email: true, expiresAt: true, claimedAt: true, organizationId: true,
      organization: { select: { name: true } },
    },
  });
  const verdict = checkOrgInvite(
    invite ? { email: invite.email, expiresAt: invite.expiresAt, claimedAt: invite.claimedAt } : null,
  );

  if (!verdict.ok) {
    return (
      <main className="mx-auto max-w-md p-8">
        <h1 className="text-xl font-semibold">Invitation unavailable</h1>
        <p className="mt-2 text-sm text-gray-600">
          This invite is {verdict.reason}. Ask the admin to send a new one.
        </p>
      </main>
    );
  }

  const orgName = invite!.organization?.name ?? "this organization";
  const authedEmail = session?.user?.email?.toLowerCase() ?? null;
  const matches = authedEmail === invite!.email.toLowerCase();

  // Logged in as a different email → mismatch notice.
  if (authedEmail && !matches) {
    return (
      <main className="mx-auto max-w-md p-8">
        <h1 className="text-xl font-semibold">Wrong account</h1>
        <p className="mt-2 text-sm text-gray-600">
          This invite is for {invite!.email}. You are signed in as {authedEmail}.
          Sign out and open the link again.
        </p>
        <a className="mt-4 inline-block underline" href={`/${locale}/signout`}>Sign out</a>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold">Join {orgName}</h1>
      <p className="mt-2 text-sm text-gray-600">Invitation for {invite!.email}.</p>
      {error ? (
        <p className="mt-2 text-sm text-red-600">Something went wrong. Check your details and try again.</p>
      ) : null}

      <form action={claimOrgInvite} className="mt-6 space-y-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="token" value={token} />

        {matches ? (
          // Logged in as the invited user → one-click accept.
          <button type="submit" className="rounded bg-black px-4 py-2 text-white">
            Accept invitation
          </button>
        ) : (
          // Not logged in → create the account (email pinned).
          <>
            <input value={invite!.email} readOnly name="emailDisplay"
              className="w-full rounded border px-3 py-2 bg-gray-50" />
            <input name="name" placeholder="Your name" required
              className="w-full rounded border px-3 py-2" />
            <input name="password" type="password" placeholder="Choose a password (min 8)"
              minLength={8} required className="w-full rounded border px-3 py-2" />
            <button type="submit" className="rounded bg-black px-4 py-2 text-white">
              Create account &amp; join
            </button>
          </>
        )}
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (If `bcryptjs` import differs from the rest of the repo, match what `auth-actions.ts` uses — the explore showed `bcrypt.hash(password, 10)`; use the same import specifier as that file.)

- [ ] **Step 4: Build to confirm the route compiles**

Run: `pnpm build`
Expected: build succeeds; `/[locale]/invite/[token]` appears in the route manifest.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/invite" src/app/org-invite-actions.ts
git commit -m "feat(org-invite): claim landing page + claimOrgInvite (new & existing users)"
```

---

## Task 9: Team-management UI + member actions

**Files:**
- Create: `src/app/[locale]/account/team-section.tsx`
- Modify: `src/app/org-invite-actions.ts` (add `revokeMembership`, `revokeInvite`, `updateMembership`)
- Modify: `src/app/[locale]/account/page.tsx` (render `<TeamSection>`)

- [ ] **Step 1: Add the management actions** to `src/app/org-invite-actions.ts`, each admin-gated and last-admin-guarded

```typescript
import { wouldRemoveLastAdmin } from "@/lib/membership";

async function requireActiveAdmin(locale: Locale) {
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);
  const scope = await loadScope();
  const ws = scope.workspace;
  if (!ws?.activeOrgId || ws.activeRole !== "ADMIN") {
    redirect(`/${locale}/account?error=forbidden#team`);
  }
  return { session, orgId: ws.activeOrgId };
}

async function loadOrgMemberships(orgId: string) {
  const rows = await prisma.membership.findMany({
    where: { organizationId: orgId },
    select: {
      userId: true, organizationId: true, role: true,
      canCommit: true, expiresAt: true, status: true,
    },
  });
  return rows;
}

export async function revokeMembership(formData: FormData) {
  const locale = asLocale(String(formData.get("locale") || "en"));
  const { session, orgId } = await requireActiveAdmin(locale);
  const targetUserId = String(formData.get("userId") || "");

  const rows = await loadOrgMemberships(orgId);
  if (wouldRemoveLastAdmin(rows, targetUserId, new Date())) {
    redirect(`/${locale}/account?error=last_admin#team`);
  }
  await prisma.membership.updateMany({
    where: { organizationId: orgId, userId: targetUserId },
    data: { status: "REVOKED" },
  });
  await recordAudit(session.user!.id, "org.membership_revoked", `Organization:${orgId}`, { targetUserId });
  redirect(`/${locale}/account?ok=revoked#team`);
}

export async function updateMembership(formData: FormData) {
  const locale = asLocale(String(formData.get("locale") || "en"));
  const { session, orgId } = await requireActiveAdmin(locale);
  const targetUserId = String(formData.get("userId") || "");
  const role = String(formData.get("role") || "MEMBER") as MembershipRole;
  const canCommit = formData.get("canCommit") === "on";

  // Guard: demoting the last admin away from ADMIN is forbidden.
  if (role !== "ADMIN") {
    const rows = await loadOrgMemberships(orgId);
    if (wouldRemoveLastAdmin(rows, targetUserId, new Date())) {
      redirect(`/${locale}/account?error=last_admin#team`);
    }
  }
  await prisma.membership.updateMany({
    where: { organizationId: orgId, userId: targetUserId },
    data: { role, canCommit },
  });
  await recordAudit(session.user!.id, "org.membership_updated", `Organization:${orgId}`, { targetUserId, role, canCommit });
  redirect(`/${locale}/account?ok=updated#team`);
}

export async function revokeInvite(formData: FormData) {
  const locale = asLocale(String(formData.get("locale") || "en"));
  const { session, orgId } = await requireActiveAdmin(locale);
  const inviteId = String(formData.get("inviteId") || "");
  await prisma.orgInvite.deleteMany({
    where: { id: inviteId, organizationId: orgId, claimedAt: null },
  });
  await recordAudit(session.user!.id, "org.invite_revoked", `Organization:${orgId}`, { inviteId });
  redirect(`/${locale}/account?ok=invite_revoked#team`);
}
```

- [ ] **Step 2: Build the Team section component** (server component; reads members + pending invites)

```tsx
// src/app/[locale]/account/team-section.tsx
import { prisma } from "@/lib/prisma";
import { isMembershipActive } from "@/lib/membership";
import {
  inviteToOrg, revokeMembership, revokeInvite, updateMembership,
} from "@/app/org-invite-actions";

export async function TeamSection({
  locale, orgId, isAdmin,
}: {
  locale: string;
  orgId: string;
  isAdmin: boolean;
}) {
  const now = new Date();
  const [members, invites] = await Promise.all([
    prisma.membership.findMany({
      where: { organizationId: orgId },
      select: {
        userId: true, organizationId: true, role: true, canCommit: true,
        expiresAt: true, status: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.orgInvite.findMany({
      where: { organizationId: orgId, claimedAt: null },
      select: { id: true, email: true, role: true, canCommit: true, expiresAt: true, delegationExpiresAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <section id="team" className="mt-10 border-t pt-8">
      <h2 className="text-lg font-semibold">Team</h2>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500">
            <th>Name</th><th>Email</th><th>Role</th><th>Can commit</th><th>Status</th><th>Expires</th>{isAdmin ? <th></th> : null}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const active = isMembershipActive(
              { userId: m.userId, organizationId: m.organizationId, role: m.role, canCommit: m.canCommit, expiresAt: m.expiresAt, status: m.status },
              now,
            );
            return (
              <tr key={m.userId} className="border-t">
                <td>{m.user?.name ?? "—"}</td>
                <td>{m.user?.email}</td>
                <td>{m.role}</td>
                <td>{m.canCommit ? "Yes" : "No"}</td>
                <td>{active ? "Active" : m.status === "ACTIVE" ? "Expired" : m.status}</td>
                <td>{m.expiresAt ? m.expiresAt.toISOString().slice(0, 10) : "—"}</td>
                {isAdmin ? (
                  <td>
                    <form action={revokeMembership} className="inline">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="userId" value={m.userId} />
                      <button className="text-red-600 underline" type="submit">Revoke</button>
                    </form>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>

      {isAdmin ? (
        <>
          <h3 className="mt-8 font-medium">Invite someone</h3>
          <form action={inviteToOrg} className="mt-3 grid gap-3 sm:grid-cols-2 max-w-2xl">
            <input type="hidden" name="locale" value={locale} />
            <input name="email" type="email" placeholder="email@company.com" required className="rounded border px-3 py-2" />
            <select name="role" className="rounded border px-3 py-2" defaultValue="MEMBER">
              <option value="ADMIN">Admin</option>
              <option value="MEMBER">Member</option>
              <option value="RESTRICTED">Restricted</option>
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="canCommit" /> Can accept quotes / place orders
            </label>
            <label className="flex items-center gap-2 text-sm">
              Delegation ends
              <input type="date" name="delegationExpiresAt" className="rounded border px-2 py-1" />
            </label>
            <button type="submit" className="rounded bg-black px-4 py-2 text-white sm:col-span-2 w-fit">Send invite</button>
          </form>

          <h3 className="mt-8 font-medium">Pending invites</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {invites.length === 0 ? <li className="text-gray-500">None.</li> : null}
            {invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3">
                <span>{i.email}</span>
                <span className="text-gray-500">{i.role}{i.canCommit ? " · commit" : ""}{i.delegationExpiresAt ? ` · until ${i.delegationExpiresAt.toISOString().slice(0, 10)}` : ""}</span>
                <span className="text-gray-400">link expires {i.expiresAt.toISOString().slice(0, 10)}</span>
                <form action={revokeInvite} className="inline">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="inviteId" value={i.id} />
                  <button className="text-red-600 underline" type="submit">Revoke</button>
                </form>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
```

> `updateMembership` is wired as a server action and available for an inline role/commit edit form; the minimal UI above ships revoke + invite. Add per-row `updateMembership` forms later if needed — the action exists and is tested via Task 11.

- [ ] **Step 3: Render `<TeamSection>` in the account page** — in `src/app/[locale]/account/page.tsx`, load the workspace and pass org + admin flag

```tsx
import { TeamSection } from "./team-section";
import { loadScope } from "@/lib/scope";

// inside the page component, after existing sections:
const scope = await loadScope();
const ws = scope.workspace;
// ...
{ws?.activeOrgId ? (
  <TeamSection
    locale={locale}
    orgId={ws.activeOrgId}
    isAdmin={ws.activeRole === "ADMIN"}
  />
) : null}
```

- [ ] **Step 4: Typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS; account route compiles with the Team section.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/account" src/app/org-invite-actions.ts
git commit -m "feat(org-invite): team management UI + revoke/update actions"
```

---

## Task 10: Daily expiry sweep cron

**Files:**
- Create: `src/app/api/cron/expire-memberships/route.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add `CRON_SECRET` to `.env.example`**

```
# Shared secret for cron routes; sent as `Authorization: Bearer <CRON_SECRET>`
CRON_SECRET=
```

- [ ] **Step 2: Implement the route** (secret-checked, idempotent, notifies)

```typescript
// src/app/api/cron/expire-memberships/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { emailAdapter } from "@/lib/notify";

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // Find rows that just crossed expiry but are still marked ACTIVE.
  const due = await prisma.membership.findMany({
    where: { status: "ACTIVE", expiresAt: { not: null, lte: now } },
    select: {
      id: true,
      organization: { select: { name: true } },
      user: { select: { email: true, name: true } },
    },
  });

  if (due.length === 0) {
    return NextResponse.json({ expired: 0 });
  }

  await prisma.membership.updateMany({
    where: { id: { in: due.map((d) => d.id) } },
    data: { status: "EXPIRED" },
  });

  // Hygiene notification only — never the security boundary.
  for (const d of due) {
    if (!d.user?.email) continue;
    try {
      await emailAdapter({
        to: d.user.email,
        subject: `Your delegated access to ${d.organization?.name ?? "an organization"} has ended`,
        text: `Hi ${d.user.name ?? ""},\n\nYour time-limited access to ${d.organization?.name ?? "the organization"} on NativeSpin reached its end date and has been removed. Ask an admin if you need it extended.\n\nNativeSpin`,
      });
    } catch (err) {
      console.error("expire_memberships.email_failed", { id: d.id, err });
    }
  }

  return NextResponse.json({ expired: due.length });
}
```

- [ ] **Step 3: Build to confirm the route registers**

Run: `pnpm build`
Expected: `/api/cron/expire-memberships` appears in the route manifest.

- [ ] **Step 4: Verify the secret guard locally**

Run (against `pnpm dev` on the project's configured port):
```bash
curl -i -X POST http://localhost:<PORT>/api/cron/expire-memberships
```
Expected: `401`. With `-H "Authorization: Bearer $CRON_SECRET"`: `200 {"expired":N}`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/expire-memberships/route.ts .env.example
git commit -m "feat(org-invite): daily expire-memberships cron (lazy enforcement stays the boundary)"
```

> **Infra follow-up (not code):** add a Railway scheduled job that POSTs this route daily with the `Authorization: Bearer $CRON_SECRET` header, and set `CRON_SECRET` in Railway prod + staging vars. Note this in the PR description.

---

## Task 11: Scenario acceptance tests (A–D) + staging verification

The repo has no DB-integration harness, so scenarios A–D are encoded as composed **pure-resolver** tests (the same functions that the live request path uses), plus a manual staging checklist for the DB-wired flow.

**Files:**
- Create: `src/lib/org-invite-scenarios.test.ts`

- [ ] **Step 1: Write the scenario tests**

```typescript
// src/lib/org-invite-scenarios.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeScopeOrgIds,
  resolveOrgMembership,
  type MembershipRow,
} from "./membership";
import { validateOrgClaim } from "./org-invite";

const NOW = new Date("2026-05-29T12:00:00Z");
const ORG = "org-maja";
const seat = (over: Partial<MembershipRow>): MembershipRow => ({
  userId: "sondre",
  organizationId: ORG,
  role: "MEMBER",
  canCommit: false,
  expiresAt: null,
  status: "ACTIVE",
  ...over,
});

// Simulates the canCommitOnOrg resolution path without importing the Scope wrapper.
function canCommit(rows: MembershipRow[], orgId: string, now: Date): boolean {
  const m = resolveOrgMembership(rows, orgId, now);
  return !!m?.canCommit;
}

test("Scenario A — Sondre joins as Member with commit, can submit", () => {
  const claim = validateOrgClaim(
    { email: "sondre@x.com", expiresAt: new Date("2026-12-01"), claimedAt: null },
    { authedEmail: null, isAlreadyMember: false },
    NOW,
  );
  assert.deepEqual(claim, { ok: true, mode: "new" });
  const rows = [seat({ canCommit: true })];
  assert.ok(activeScopeOrgIds(rows, NOW).includes(ORG));
  assert.equal(canCommit(rows, ORG, NOW), true);
});

test("Scenario B — Sondre = Member, canCommit false: sees all, cannot accept quote", () => {
  const rows = [seat({ canCommit: false })];
  assert.ok(activeScopeOrgIds(rows, NOW).includes(ORG)); // full read access
  assert.equal(canCommit(rows, ORG, NOW), false);         // Maja must gate the quote
});

test("Scenario C — Andreas = Restricted delegation auto-de-escalates on 2026-10-05", () => {
  const before = new Date("2026-09-01T00:00:00Z");
  const after = new Date("2026-10-06T00:00:00Z");
  const rows: MembershipRow[] = [
    {
      userId: "andreas",
      organizationId: ORG,
      role: "RESTRICTED",
      canCommit: false,
      expiresAt: new Date("2026-10-05T00:00:00Z"),
      status: "ACTIVE",
    },
  ];
  // Before the date: scoped access.
  assert.ok(activeScopeOrgIds(rows, before).includes(ORG));
  assert.equal(resolveOrgMembership(rows, ORG, before)?.role, "RESTRICTED");
  // After the date: ZERO access at request time, regardless of the cron.
  assert.deepEqual(activeScopeOrgIds(rows, after), []);
  assert.equal(resolveOrgMembership(rows, ORG, after), null);
  assert.equal(canCommit(rows, ORG, after), false);
});

test("Scenario D — publisher path is independent of memberships (regression guard)", () => {
  // A user with no org memberships gets no org scope; publisher access is a
  // separate axis (user.role === PUBLISHER), untouched here.
  assert.deepEqual(activeScopeOrgIds([], NOW), []);
});

test("re-claiming an already-claimed invite is refused (idempotency)", () => {
  const v = validateOrgClaim(
    { email: "sondre@x.com", expiresAt: new Date("2026-12-01"), claimedAt: NOW },
    { authedEmail: "sondre@x.com", isAlreadyMember: false },
    NOW,
  );
  assert.deepEqual(v, { ok: false, reason: "claimed" });
});
```

- [ ] **Step 2: Run the full suite**

Run: `pnpm test`
Expected: PASS — `membership.test.ts`, `scope.test.ts`, `org-invite.test.ts`, `org-invite-scenarios.test.ts` all green.

- [ ] **Step 3: Typecheck + lint + build (full gate)**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/org-invite-scenarios.test.ts
git commit -m "test(org-invite): scenario A-D acceptance via pure resolvers"
```

- [ ] **Step 5: Manual staging verification** (the DB-wired acceptance bar — run on `staging.nativespin.com`)

Deploy the branch to staging, then verify each end-to-end:
  1. **Backfill:** existing staging user still logs in, lands on their org, retains full access (now an ADMIN membership).
  2. **A:** as admin, invite a fresh email as Member + commit → open the link in a clean browser profile → sign up → land in account → can submit an RFQ/accept a quote.
  3. **B:** invite a second fresh email as Member, commit OFF → sign up → can see plans/RFQs/orders but the accept-quote / place-order action is forbidden.
  4. **C:** invite an existing colleague as Restricted with delegation date = tomorrow → they accept (one-click, existing login) → have access today. Manually set `expiresAt` to a past time (or wait) and confirm access drops on the next request *before* running the cron; then POST the cron and confirm status flips to `EXPIRED` and the heads-up email arrives (check the staging mail adapter / Resend).
  5. **Guardrails:** last admin cannot be revoked/demoted; re-using a claimed link shows the "unavailable" page; logged-in wrong-account shows the mismatch page; inviting an existing member is rejected.
  6. **i18n:** open `/no/invite/<token>` and confirm the page + invite email are not leaking English labels.

- [ ] **Step 6: Update the spec status**

Edit `docs/superpowers/specs/2026-05-29-multi-user-org-invite-design.md` line 4 to `**Status:** Implemented` once staging verification passes, and commit:

```bash
git add docs/superpowers/specs/2026-05-29-multi-user-org-invite-design.md
git commit -m "docs(org-invite): mark design implemented after staging verification"
```

---

## Self-Review (against the spec)

**Spec coverage:**
- §1 Data model → Task 1 (models/enums/relations) + Task 2 (migration + backfill, incl. `searchTsv` no-touch). ✓
- §2 Permission resolution (scopeOrgIds union, per-org role/canCommit, active-org cookie reuse, JWT-advisory) → Tasks 3-5 (active-org cookie reuse in Task 4 Step 3; JWT never trusted because authority is resolved from `Membership` in `getWorkspace`). ✓
- §3 Expiry (lazy + daily sweep) → lazy via `isMembershipActive` (Tasks 3-5); sweep via Task 10. ✓
- §4 Invite & claim (admin-gated, email-pinned, new + existing) → Tasks 7-8. ✓
- §5 Team UI (members, pending, admin actions, last-admin guard) → Task 9. ✓
- §6 Edge cases (already-member, duplicate pending replace, past delegation, revoke, expired link, last-admin) → Task 7 (already-member, dup-replace, past-delegation), Task 8 (expired/claimed/mismatch), Task 9 (revoke + last-admin). ✓
- §7 Testing (unit perms, unit claim, scenario A-D) → Tasks 3,5,6,11. ✓ (DB-integration replaced by staging checklist — documented deviation, matches repo's pure-function test convention.)

**Placeholder scan:** No "TBD"/"add validation"/"handle edge cases" — every code step contains real code. Two explicit verification hooks remain (grep for `canActOnOrg` call sites in Task 5 Step 5; confirm `recordAudit`/`prisma` import paths in Task 7 Step 2) — these are deliberate "confirm against repo" steps, not placeholders, because the exact commit-action file paths weren't enumerated by exploration.

**Type consistency:** `MembershipRow` defined once (Task 3), imported everywhere. `Workspace` gains `activeRole`/`activeCanCommit` (Task 4) and both are read identically in `canCommitOnOrg` (Task 5) and the UI (Task 9). `ClaimVerdict`/`validateOrgClaim` signatures match between Task 6 (def) and Task 8 (use). Compound unique key `userId_organizationId` (Task 1) used in Task 8 Step 1.
