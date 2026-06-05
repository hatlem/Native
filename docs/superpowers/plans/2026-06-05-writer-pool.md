# Writer Pool & Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give freelance writers a first-class profile (languages, specialties, rate, capacity), attach a pool of candidate writers to each order, assign one writer per order line, and give writers a focused `/writer` console scoped to their assignments.

**Architecture:** Additive Prisma models (`WriterProfile`, `WriterLanguage`, `WriterSpecialty`, `OrderWriterPool`, `WriterInvite`) plus nullable columns on `OrderLine` and `ContentAsset`. All match/access/capacity logic lives in pure, unit-tested helpers under `src/lib/writers/`; server actions and pages are thin wrappers. Access for the existing `CONTENT` role tightens from "see all desk orders" to "write only on assigned lines".

**Tech Stack:** Next.js App Router (server components + server actions), Prisma/PostgreSQL, NextAuth (`auth()`), `node:test` via `tsx --test`, Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-05-writer-pool-design.md`

**Conventions to follow:**
- Tests are `*.test.ts` colocated next to source; run with `pnpm test` (`tsx --test "src/**/*.test.ts"`). Use `import { test } from "node:test"` + `import assert from "node:assert/strict"`.
- Server actions live in `*-actions.ts` files marked `"use server"`, read fields via a local `field(formData, key)` helper, call `recordAudit(userId, action, entity, detail?)`, and `redirect()` at the end.
- Conventional commits with the Claude co-author footer.
- Migrations are timestamped dirs under `prisma/migrations/` (format `YYYYMMDDHHMMSS_name`). Prod auto-runs `prisma migrate deploy` on start.

---

## Task 1: Prisma schema — enums, models, columns

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260605130000_writer_pool/migration.sql`

- [ ] **Step 1: Add enums** to `prisma/schema.prisma` in the `// ---------- Enums ----------` section (after `enum VerificationStatus`):

```prisma
// Languages writers produce content in — matches the src/messages locale
// set (no, sv, da, fi, de, en). Distinct from MarketCode because several
// markets share a language (DE/AT/CH → DE, UK/IE → EN).
enum ContentLanguage {
  NO
  SV
  DA
  FI
  DE
  EN
}

enum LanguageProficiency {
  NATIVE
  FLUENT
  WORKING
}

// Editorial specialty taxonomy for writer matching. Enum for v1 (simple,
// filterable); promote to a Topic table only if the desk needs to add
// categories itself.
enum ContentTopic {
  FINANCE
  HEALTH
  TECH
  LIFESTYLE
  B2B
  TRAVEL
  FOOD
  CULTURE
  SUSTAINABILITY
  OTHER
}
```

- [ ] **Step 2: Add the writer models** at the end of `prisma/schema.prisma`:

```prisma
// Freelance writer profile. 1:1 with a User whose role is CONTENT. Carries
// the matching signals the desk uses to staff an order: languages,
// specialties, rate, and capacity.
model WriterProfile {
  id                   String   @id @default(cuid())
  userId               String   @unique
  user                 User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  bio                  String?
  ratePerArticle       Decimal? @db.Decimal(12, 2)
  ratePerWord          Decimal? @db.Decimal(12, 4)
  currency             String? // ISO 4217; default from home market
  maxActiveAssignments Int? // capacity guidance; over-cap warns, never blocks
  active               Boolean  @default(true) // left / on pause
  portfolioUrl         String?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  languages       WriterLanguage[]
  specialties     WriterSpecialty[]
  poolMemberships OrderWriterPool[]
  assignedLines   OrderLine[]       @relation("LineAssignedWriter")
  authoredAssets  ContentAsset[]    @relation("AssetAuthor")
}

model WriterLanguage {
  id          String              @id @default(cuid())
  writerId    String
  writer      WriterProfile       @relation(fields: [writerId], references: [id], onDelete: Cascade)
  language    ContentLanguage
  proficiency LanguageProficiency @default(FLUENT)

  @@unique([writerId, language])
}

model WriterSpecialty {
  id       String        @id @default(cuid())
  writerId String
  writer   WriterProfile @relation(fields: [writerId], references: [id], onDelete: Cascade)
  topic    ContentTopic

  @@unique([writerId, topic])
}

// Candidate writers attached to an order. The desk builds this pool;
// per-line assignment (OrderLine.assignedWriter) must be a pool member.
model OrderWriterPool {
  id        String        @id @default(cuid())
  orderId   String
  order     Order         @relation(fields: [orderId], references: [id], onDelete: Cascade)
  writerId  String
  writer    WriterProfile @relation(fields: [writerId], references: [id])
  addedById String // desk user who added them
  addedAt   DateTime      @default(now())

  @@unique([orderId, writerId])
  @@index([writerId])
}

// Single-use, time-limited invite that binds a new User{role: CONTENT}
// and an empty WriterProfile on claim. Mirrors PublisherInvite.
model WriterInvite {
  id              String    @id @default(cuid())
  email           String
  token           String    @unique
  expiresAt       DateTime
  claimedAt       DateTime?
  claimedByUserId String?
  createdBy       String
  createdAt       DateTime  @default(now())

  @@index([email])
}
```

- [ ] **Step 3: Add columns + back-relations** to existing models.

In `model Order { ... }`, add to the relation block (after `creditNotes CreditNote[]`):

```prisma
  writerPool  OrderWriterPool[]
```

In `model OrderLine { ... }`, add after `lineTotal`:

```prisma
  assignedWriterId String?
  assignedWriter   WriterProfile? @relation("LineAssignedWriter", fields: [assignedWriterId], references: [id])
  assignedAt       DateTime?
  assignedById     String?
```

In `model ContentAsset { ... }`, add after `body String?`:

```prisma
  authorWriterId String?
  authorWriter   WriterProfile? @relation("AssetAuthor", fields: [authorWriterId], references: [id])
```

- [ ] **Step 4: Generate client and the migration.**

Run:
```bash
pnpm prisma generate
pnpm prisma migrate dev --name writer_pool --create-only
```
If `migrate dev` is blocked in this environment (no shadow DB), instead hand-author `prisma/migrations/20260605130000_writer_pool/migration.sql` with the equivalent `CREATE TYPE` / `CREATE TABLE` / `ALTER TABLE ... ADD COLUMN` statements, then run `pnpm prisma generate`. All new columns are nullable or have defaults, so the migration is safe on the existing prod DB.

Expected: `pnpm prisma generate` prints "Generated Prisma Client" and `WriterProfile` is importable from `@prisma/client`.

- [ ] **Step 5: Commit.**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(writers): schema for writer profiles, pools, assignment"
```

---

## Task 2: Language/topic derivation helpers (pure)

Derives match criteria from an order line's title. Pure + tested so match logic is deterministic.

**Files:**
- Create: `src/lib/writers/criteria.ts`
- Create: `src/lib/writers/criteria.test.ts`

- [ ] **Step 1: Write the failing test** in `src/lib/writers/criteria.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { languageForCountry, topicForCategory } from "./criteria";

test("languageForCountry maps shared-language markets", () => {
  assert.equal(languageForCountry("NO"), "NO");
  assert.equal(languageForCountry("SE"), "SV");
  assert.equal(languageForCountry("DK"), "DA");
  assert.equal(languageForCountry("FI"), "FI");
  assert.equal(languageForCountry("DE"), "DE");
  assert.equal(languageForCountry("AT"), "DE");
  assert.equal(languageForCountry("CH"), "DE");
  assert.equal(languageForCountry("UK"), "EN");
  assert.equal(languageForCountry("IE"), "EN");
});

test("languageForCountry returns null for unknown codes", () => {
  assert.equal(languageForCountry("XX"), null);
  assert.equal(languageForCountry(""), null);
});

test("topicForCategory maps known categories and falls back to OTHER", () => {
  assert.equal(topicForCategory("business"), "FINANCE");
  assert.equal(topicForCategory("lifestyle"), "LIFESTYLE");
  assert.equal(topicForCategory("general-news"), "OTHER");
  assert.equal(topicForCategory("totally-unknown"), "OTHER");
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm exec tsx --test src/lib/writers/criteria.test.ts`
Expected: FAIL — `Cannot find module './criteria'`.

- [ ] **Step 3: Write the implementation** in `src/lib/writers/criteria.ts`:

```ts
import type { ContentLanguage, ContentTopic } from "@prisma/client";

// Market country code → the language a writer must produce in. Several
// markets share a language (DE/AT/CH, UK/IE), which is exactly why match
// criteria use ContentLanguage rather than MarketCode.
const COUNTRY_LANGUAGE: Record<string, ContentLanguage> = {
  NO: "NO",
  SE: "SV",
  DK: "DA",
  FI: "FI",
  DE: "DE",
  AT: "DE",
  CH: "DE",
  UK: "EN",
  IE: "EN",
};

export function languageForCountry(
  countryCode: string,
): ContentLanguage | null {
  return COUNTRY_LANGUAGE[countryCode] ?? null;
}

// Loose map from a Title.category free-text value to a specialty topic.
// Unknown categories fall back to OTHER — matching still works off
// language; topic overlap is a secondary sort signal.
const CATEGORY_TOPIC: Record<string, ContentTopic> = {
  business: "FINANCE",
  finance: "FINANCE",
  economy: "FINANCE",
  health: "HEALTH",
  tech: "TECH",
  technology: "TECH",
  lifestyle: "LIFESTYLE",
  travel: "TRAVEL",
  food: "FOOD",
  culture: "CULTURE",
  sustainability: "SUSTAINABILITY",
};

export function topicForCategory(category: string): ContentTopic {
  return CATEGORY_TOPIC[category.toLowerCase()] ?? "OTHER";
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `pnpm exec tsx --test src/lib/writers/criteria.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/writers/criteria.ts src/lib/writers/criteria.test.ts
git commit -m "feat(writers): derive match language/topic from title"
```

---

## Task 3: Writer match scoring (pure)

**Files:**
- Create: `src/lib/writers/match.ts`
- Create: `src/lib/writers/match.test.ts`

- [ ] **Step 1: Write the failing test** in `src/lib/writers/match.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreWriter, rankWriters, type WriterForMatch } from "./match";

function writer(over: Partial<WriterForMatch>): WriterForMatch {
  return {
    active: true,
    maxActiveAssignments: null,
    activeAssignments: 0,
    languages: [],
    specialties: [],
    ...over,
  };
}

test("language match dominates the score", () => {
  const matchLang = writer({
    languages: [{ language: "NO", proficiency: "FLUENT" }],
  });
  const noLang = writer({
    specialties: [{ topic: "FINANCE" }, { topic: "TECH" }],
  });
  const a = scoreWriter(matchLang, { language: "NO", topics: ["FINANCE"] });
  const b = scoreWriter(noLang, { language: "NO", topics: ["FINANCE", "TECH"] });
  assert.equal(a.languageMatch, true);
  assert.equal(b.languageMatch, false);
  assert.ok(a.score > b.score);
});

test("native proficiency beats fluent on equal language", () => {
  const nativeW = writer({ languages: [{ language: "SV", proficiency: "NATIVE" }] });
  const fluentW = writer({ languages: [{ language: "SV", proficiency: "FLUENT" }] });
  const crit = { language: "SV" as const, topics: [] };
  assert.ok(scoreWriter(nativeW, crit).score > scoreWriter(fluentW, crit).score);
});

test("specialty overlap adds to the score and is reported", () => {
  const w = writer({
    languages: [{ language: "DE", proficiency: "FLUENT" }],
    specialties: [{ topic: "FINANCE" }, { topic: "B2B" }],
  });
  const res = scoreWriter(w, { language: "DE", topics: ["FINANCE", "B2B", "TECH"] });
  assert.equal(res.topicOverlap, 2);
});

test("inactive and over-capacity writers are penalised but selectable", () => {
  const inactive = writer({
    active: false,
    languages: [{ language: "NO", proficiency: "NATIVE" }],
  });
  const res = scoreWriter(inactive, { language: "NO", topics: [] });
  assert.ok(res.score < 0);

  const overCap = writer({
    maxActiveAssignments: 2,
    activeAssignments: 2,
    languages: [{ language: "NO", proficiency: "FLUENT" }],
  });
  assert.equal(scoreWriter(overCap, { language: "NO", topics: [] }).overCapacity, true);
});

test("rankWriters sorts best match first", () => {
  const weak: WriterForMatch & { id: string } = {
    ...writer({ specialties: [{ topic: "FOOD" }] }),
    id: "weak",
  };
  const strong: WriterForMatch & { id: string } = {
    ...writer({
      languages: [{ language: "NO", proficiency: "NATIVE" }],
      specialties: [{ topic: "FINANCE" }],
    }),
    id: "strong",
  };
  const ranked = rankWriters([weak, strong], { language: "NO", topics: ["FINANCE"] });
  assert.equal(ranked[0].id, "strong");
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm exec tsx --test src/lib/writers/match.test.ts`
Expected: FAIL — `Cannot find module './match'`.

- [ ] **Step 3: Write the implementation** in `src/lib/writers/match.ts`:

```ts
import type {
  ContentLanguage,
  ContentTopic,
  LanguageProficiency,
} from "@prisma/client";

export type WriterForMatch = {
  active: boolean;
  maxActiveAssignments: number | null;
  activeAssignments: number; // computed by the caller (see capacity.ts)
  languages: { language: ContentLanguage; proficiency: LanguageProficiency }[];
  specialties: { topic: ContentTopic }[];
};

export type MatchCriteria = {
  language: ContentLanguage | null;
  topics: ContentTopic[];
};

export type MatchResult = {
  score: number;
  languageMatch: boolean;
  topicOverlap: number;
  overCapacity: boolean;
};

const PROFICIENCY_BONUS: Record<LanguageProficiency, number> = {
  NATIVE: 2,
  FLUENT: 1,
  WORKING: 0,
};

// Language is the dominant signal (100), then proficiency (×10), then each
// specialty overlap (5). Inactive writers sink far below everyone;
// over-capacity is a mild penalty. Nothing is ever filtered out — the desk
// always retains the final pick.
export function scoreWriter(
  writer: WriterForMatch,
  criteria: MatchCriteria,
): MatchResult {
  const langEntry = criteria.language
    ? writer.languages.find((l) => l.language === criteria.language)
    : undefined;
  const languageMatch = Boolean(langEntry);

  const topicOverlap = writer.specialties.filter((s) =>
    criteria.topics.includes(s.topic),
  ).length;

  const overCapacity =
    writer.maxActiveAssignments != null &&
    writer.activeAssignments >= writer.maxActiveAssignments;

  let score = 0;
  if (langEntry) score += 100 + PROFICIENCY_BONUS[langEntry.proficiency] * 10;
  score += topicOverlap * 5;
  if (!writer.active) score -= 1000;
  if (overCapacity) score -= 50;

  return { score, languageMatch, topicOverlap, overCapacity };
}

export function rankWriters<T extends WriterForMatch>(
  writers: T[],
  criteria: MatchCriteria,
): (T & { match: MatchResult })[] {
  return writers
    .map((w) => ({ ...w, match: scoreWriter(w, criteria) }))
    .sort((a, b) => b.match.score - a.match.score);
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `pnpm exec tsx --test src/lib/writers/match.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/writers/match.ts src/lib/writers/match.test.ts
git commit -m "feat(writers): advisory match scoring + ranking"
```

---

## Task 4: Access + capacity + pool helpers (pure)

**Files:**
- Create: `src/lib/writers/access.ts`
- Create: `src/lib/writers/access.test.ts`

- [ ] **Step 1: Write the failing test** in `src/lib/writers/access.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canWriteLine,
  canAssignWriter,
  isAssignmentActive,
} from "./access";

test("desk and superadmin can always write a line", () => {
  const base = { userId: "u1", assignedWriterUserId: null };
  assert.equal(canWriteLine({ role: "DESK", ...base }), true);
  assert.equal(canWriteLine({ role: "SUPERADMIN", ...base }), true);
});

test("CONTENT can write only its own assigned line", () => {
  assert.equal(
    canWriteLine({ role: "CONTENT", userId: "u1", assignedWriterUserId: "u1" }),
    true,
  );
  assert.equal(
    canWriteLine({ role: "CONTENT", userId: "u1", assignedWriterUserId: "u2" }),
    false,
  );
  assert.equal(
    canWriteLine({ role: "CONTENT", userId: "u1", assignedWriterUserId: null }),
    false,
  );
});

test("buyers and missing users cannot write", () => {
  assert.equal(
    canWriteLine({ role: "BUYER", userId: "u1", assignedWriterUserId: "u1" }),
    false,
  );
  assert.equal(
    canWriteLine({ role: "DESK", userId: undefined, assignedWriterUserId: null }),
    false,
  );
});

test("a writer can only be assigned if present in the pool", () => {
  assert.equal(canAssignWriter(["w1", "w2"], "w2"), true);
  assert.equal(canAssignWriter(["w1", "w2"], "w3"), false);
  assert.equal(canAssignWriter([], "w1"), false);
});

test("an assignment is active until its latest asset is FINAL/RETRACTED", () => {
  assert.equal(isAssignmentActive(null), true); // assigned, not yet written
  assert.equal(isAssignmentActive("DRAFT"), true);
  assert.equal(isAssignmentActive("IN_REVIEW"), true);
  assert.equal(isAssignmentActive("FINAL"), false);
  assert.equal(isAssignmentActive("RETRACTED"), false);
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm exec tsx --test src/lib/writers/access.test.ts`
Expected: FAIL — `Cannot find module './access'`.

- [ ] **Step 3: Write the implementation** in `src/lib/writers/access.ts`:

```ts
import type { ContentAssetStatus } from "@prisma/client";

// Pure write-permission decision for a single order line. DESK/SUPERADMIN
// always; CONTENT only when the line is assigned to their own user id.
export function canWriteLine(args: {
  role: string | undefined;
  userId: string | undefined;
  assignedWriterUserId: string | null | undefined;
}): boolean {
  const { role, userId, assignedWriterUserId } = args;
  if (!userId) return false;
  if (role === "DESK" || role === "SUPERADMIN") return true;
  if (role === "CONTENT") return assignedWriterUserId === userId;
  return false;
}

// A line may only be assigned to a writer already in the order's pool.
export function canAssignWriter(
  poolWriterIds: string[],
  writerId: string,
): boolean {
  return poolWriterIds.includes(writerId);
}

// Capacity counting: an assignment is "active" until its latest content
// asset reaches FINAL or RETRACTED. No asset yet (null) still counts —
// the writer owes an article.
export function isAssignmentActive(
  latestAssetStatus: ContentAssetStatus | null,
): boolean {
  return latestAssetStatus !== "FINAL" && latestAssetStatus !== "RETRACTED";
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `pnpm exec tsx --test src/lib/writers/access.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/writers/access.ts src/lib/writers/access.test.ts
git commit -m "feat(writers): pure access, assignment, capacity helpers"
```

---

## Task 5: Route writers to the new console

**Files:**
- Modify: `src/lib/roles.ts`
- Modify: `src/lib/roles.test.ts:8-11`

- [ ] **Step 1: Update the test** in `src/lib/roles.test.ts`. Replace the first test body so CONTENT lands on `/writer`:

```ts
test("landingForRole routes desk roles to the console", () => {
  assert.equal(landingForRole("DESK", "en"), "/en/desk");
  assert.equal(landingForRole("SUPERADMIN", "no"), "/no/desk");
});

test("landingForRole routes writers to the writer console", () => {
  // CONTENT (freelance writers) get a focused console scoped to their
  // assigned lines, not the full desk surface.
  assert.equal(landingForRole("CONTENT", "sv"), "/sv/writer");
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm exec tsx --test src/lib/roles.test.ts`
Expected: FAIL — expected `/sv/writer`, got `/sv/desk`.

- [ ] **Step 3: Update `src/lib/roles.ts`.** Remove `case "CONTENT":` from the desk group and add its own branch:

```ts
export function landingForRole(
  role: string | undefined,
  locale: string,
): string {
  switch (role) {
    case "PUBLISHER":
      return `/${locale}/publisher`;
    case "CONTENT":
      // Writers get a focused console scoped to their assigned lines.
      return `/${locale}/writer`;
    case "DESK":
    case "SUPERADMIN":
      return `/${locale}/desk`;
    default:
      return `/${locale}/catalog`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `pnpm exec tsx --test src/lib/roles.test.ts`
Expected: PASS.

- [ ] **Step 5: Add a `writer` audience to nav.** In `src/lib/nav.ts`:

In `audienceFor`, change the desk branch and add writer:
```ts
  if (role === "PUBLISHER") return "publisher";
  if (role === "CONTENT") return "writer";
  if (role === "DESK") return "desk";
  if (role === "SUPERADMIN") return "superadmin";
```
Add `"writer"` to the `Audience` union type. In `navItemsFor`, add a case:
```ts
    case "writer":
      return [
        { key: "writerAssignments", label: t("orders"), href: "/writer" },
        { key: "writerProfile", label: t("account"), href: "/writer/profile" },
      ];
```
In `paletteItemsFor`'s `goWork` switch, add:
```ts
      case "writer":
        return [
          { key: "writerAssignments", label: t("orders"), href: "/writer" },
          { key: "writerProfile", label: t("account"), href: "/writer/profile" },
          { key: "notifications", label: t("notifications"), href: "/notifications" },
        ];
```

- [ ] **Step 6: Run the full suite to confirm nav still compiles/tests pass.**

Run: `pnpm test`
Expected: PASS (all existing + new tests).

- [ ] **Step 7: Commit.**

```bash
git add src/lib/roles.ts src/lib/roles.test.ts src/lib/nav.ts
git commit -m "feat(writers): route CONTENT role to /writer console"
```

---

## Task 6: Capacity query helper

Loads writers with their computed active-assignment counts for matching. Thin DB wrapper around the pure helpers.

**Files:**
- Create: `src/lib/writers/roster.ts`

- [ ] **Step 1: Write the implementation** in `src/lib/writers/roster.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { isAssignmentActive } from "./access";
import type { WriterForMatch } from "./match";

export type RosterWriter = WriterForMatch & {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  ratePerArticle: number | null;
  currency: string | null;
};

// All writer profiles with languages, specialties, and a live count of
// active assignments (assigned lines whose latest asset isn't FINAL/
// RETRACTED). Used by the desk Writers panel for match ranking.
export async function loadRoster(): Promise<RosterWriter[]> {
  const writers = await prisma.writerProfile.findMany({
    include: {
      user: { select: { name: true, email: true } },
      languages: { select: { language: true, proficiency: true } },
      specialties: { select: { topic: true } },
      assignedLines: {
        select: {
          brief: {
            select: {
              assets: {
                orderBy: { version: "desc" },
                take: 1,
                select: { status: true },
              },
            },
          },
        },
      },
    },
  });

  return writers.map((w) => {
    const activeAssignments = w.assignedLines.filter((line) =>
      isAssignmentActive(line.brief?.assets[0]?.status ?? null),
    ).length;
    return {
      id: w.id,
      userId: w.userId,
      name: w.user.name,
      email: w.user.email,
      active: w.active,
      maxActiveAssignments: w.maxActiveAssignments,
      activeAssignments,
      ratePerArticle: w.ratePerArticle ? Number(w.ratePerArticle) : null,
      currency: w.currency,
      languages: w.languages,
      specialties: w.specialties,
    };
  });
}
```

Note: `OrderLine.brief` is the existing `ContentBrief?` relation (`prisma/schema.prisma` `model OrderLine`). `ContentBrief.assets` is the existing `ContentAsset[]` relation.

- [ ] **Step 2: Typecheck.**

Run: `pnpm exec tsc --noEmit`
Expected: no errors in `src/lib/writers/roster.ts`.

- [ ] **Step 3: Commit.**

```bash
git add src/lib/writers/roster.ts
git commit -m "feat(writers): roster loader with active-assignment counts"
```

---

## Task 7: Pool + assignment server actions

**Files:**
- Create: `src/app/writer-pool-actions.ts`

- [ ] **Step 1: Write the actions** in `src/app/writer-pool-actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAssignWriter } from "@/lib/writers/access";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function requireDeskUser(
  locale: string,
): Promise<string> {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    redirect(`/${locale}/signin`);
  }
  return session.user.id;
}

export async function addWriterToPool(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  const writerId = field(formData, "writerId");
  const userId = await requireDeskUser(locale);

  await prisma.orderWriterPool.upsert({
    where: { orderId_writerId: { orderId, writerId } },
    update: {},
    create: { orderId, writerId, addedById: userId },
  });
  await recordAudit(userId, "writer.pool_add", `Order:${orderId}`, { writerId });

  redirect(`/${locale}/desk/orders/${orderId}`);
}

export async function removeWriterFromPool(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  const writerId = field(formData, "writerId");
  const userId = await requireDeskUser(locale);

  // Clear any line assignments to this writer on this order first, so we
  // never leave a line assigned to a non-pool writer.
  await prisma.orderLine.updateMany({
    where: { orderId, assignedWriterId: writerId },
    data: { assignedWriterId: null, assignedAt: null, assignedById: null },
  });
  await prisma.orderWriterPool.deleteMany({ where: { orderId, writerId } });
  await recordAudit(userId, "writer.pool_remove", `Order:${orderId}`, { writerId });

  redirect(`/${locale}/desk/orders/${orderId}`);
}

export async function assignWriterToLine(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  const orderLineId = field(formData, "orderLineId");
  const writerId = field(formData, "writerId"); // "" → unassign
  const userId = await requireDeskUser(locale);

  if (writerId === "") {
    await prisma.orderLine.update({
      where: { id: orderLineId },
      data: { assignedWriterId: null, assignedAt: null, assignedById: null },
    });
    await recordAudit(userId, "line.unassign", `OrderLine:${orderLineId}`);
    redirect(`/${locale}/desk/orders/${orderId}`);
  }

  const pool = await prisma.orderWriterPool.findMany({
    where: { orderId },
    select: { writerId: true },
  });
  if (!canAssignWriter(pool.map((p) => p.writerId), writerId)) {
    // Reject out-of-pool assignment silently — UI only offers pool members.
    redirect(`/${locale}/desk/orders/${orderId}`);
  }

  await prisma.orderLine.update({
    where: { id: orderLineId },
    data: { assignedWriterId: writerId, assignedById: userId, assignedAt: new Date() },
  });
  await recordAudit(userId, "line.assign", `OrderLine:${orderLineId}`, { writerId });

  redirect(`/${locale}/desk/orders/${orderId}`);
}
```

Note: the `orderId_writerId` compound `where` key comes from the `@@unique([orderId, writerId])` on `OrderWriterPool` (Task 1).

- [ ] **Step 2: Typecheck.**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add src/app/writer-pool-actions.ts
git commit -m "feat(writers): pool add/remove + per-line assignment actions"
```

---

## Task 8: Scope CONTENT writing + stamp asset author

Tighten the existing asset actions so a CONTENT user can only act on a line assigned to them, and record the author on draft.

**Files:**
- Create: `src/lib/writers/guard.ts`
- Modify: `src/app/desk-actions.ts` (`saveDraft`, `runSpecCheck`, `setAssetStatus`)

- [ ] **Step 1: Write the guard** in `src/lib/writers/guard.ts`:

```ts
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canWriteLine } from "./access";

// Authorises a content action on a specific order line. DESK/SUPERADMIN
// pass straight through; CONTENT must be the line's assigned writer.
// Returns the acting user id and (when CONTENT) their WriterProfile id.
export async function requireLineWriter(
  orderLineId: string,
  locale: string,
): Promise<{ userId: string; role: string; writerProfileId: string | null }> {
  const session = await auth();
  const role = session?.user?.role;
  const userId = session?.user?.id;
  if (!session?.user || !userId) redirect(`/${locale}/signin`);

  const line = await prisma.orderLine.findUnique({
    where: { id: orderLineId },
    select: { assignedWriter: { select: { id: true, userId: true } } },
  });

  if (
    !canWriteLine({
      role,
      userId,
      assignedWriterUserId: line?.assignedWriter?.userId ?? null,
    })
  ) {
    redirect(`/${locale}/writer`);
  }

  const writerProfileId =
    role === "CONTENT" ? (line?.assignedWriter?.id ?? null) : null;
  return { userId, role: role as string, writerProfileId };
}
```

- [ ] **Step 2: Update `saveDraft`** in `src/app/desk-actions.ts` (around line 144). Replace the guard call and the asset create so it uses the line guard and stamps the author:

```ts
export async function saveDraft(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderLineId = field(formData, "orderLineId");
  const orderId = field(formData, "orderId");
  const body = field(formData, "body");
  const sourceAssetId = field(formData, "sourceAssetId") || null;
  const { userId, writerProfileId, role } = await requireLineWriter(
    orderLineId,
    locale,
  );

  const brief = await prisma.contentBrief.findUnique({
    where: { orderLineId },
    include: { assets: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (brief && body) {
    const nextVersion = (brief.assets[0]?.version ?? 0) + 1;
    const asset = await prisma.contentAsset.create({
      data: {
        briefId: brief.id,
        version: nextVersion,
        status: "DRAFT",
        body,
        sourceAssetId: sourceAssetId || null,
        authorWriterId: writerProfileId,
      },
    });
    await recordAudit(userId, "asset.draft", `ContentAsset:${asset.id}`, {
      version: nextVersion,
      sourceAssetId: sourceAssetId || null,
    });
    await enqueue("spec.check", { assetId: asset.id });
  }
  // CONTENT writers return to their console; desk stays on the order page.
  redirect(
    role === "CONTENT"
      ? `/${locale}/writer/lines/${orderLineId}`
      : `/${locale}/desk/orders/${orderId}`,
  );
}
```

The same role-based redirect pattern applies to `runSpecCheck` and `setAssetStatus` below — capture `role` from `requireLineWriter` and resolve `orderLineId` from the asset's brief (already fetched), then redirect to `/${locale}/writer/lines/${orderLineId}` for CONTENT, else the desk order page.

- [ ] **Step 3: Update `runSpecCheck` and `setAssetStatus`** to authorise on the line. `runSpecCheck` (line ~181) — replace `const { userId } = await requireDeskOrContent(locale);` with a lookup of the asset's line then the guard:

```ts
export async function runSpecCheck(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const orderId = field(formData, "orderId");
  const asset = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: { brief: { select: { orderLineId: true } } },
  });
  const { userId } = await requireLineWriter(
    asset?.brief.orderLineId ?? "",
    locale,
  );

  await runSpecCheckForAsset(assetId);
  await recordAudit(userId, "asset.spec_check", `ContentAsset:${assetId}`);

  redirect(`/${locale}/desk/orders/${orderId}`);
}
```

For `setAssetStatus` (line ~193) — replace the guard with the line guard, keeping the existing CONTENT target restriction:

```ts
export async function setAssetStatus(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const assetId = field(formData, "assetId");
  const orderId = field(formData, "orderId");
  const target = field(formData, "target") as ContentAssetStatus;
  const assetForLine = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: { brief: { select: { orderLineId: true } } },
  });
  const { userId, role } = await requireLineWriter(
    assetForLine?.brief.orderLineId ?? "",
    locale,
  );

  if (role === "CONTENT" && !CONTENT_ASSET_TARGETS.has(target)) {
    redirect(`/${locale}/desk/orders/${orderId}`);
  }
  // ... existing body unchanged from here (ASSET_TARGETS check etc.) ...
```

Add the import at the top of `src/app/desk-actions.ts`:
```ts
import { requireLineWriter } from "@/lib/writers/guard";
```
The now-unused `requireDeskOrContent` and `CONTENT_ASSET_TARGETS` stay if still referenced; if `requireDeskOrContent` is no longer used anywhere, delete it to satisfy lint.

- [ ] **Step 4: Typecheck + tests.**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no type errors; all tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/writers/guard.ts src/app/desk-actions.ts
git commit -m "feat(writers): scope CONTENT to assigned lines + stamp author"
```

---

## Task 9: Writer profile self-service actions

**Files:**
- Create: `src/app/writer-profile-actions.ts`

- [ ] **Step 1: Write the actions** in `src/app/writer-profile-actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import {
  ContentLanguage,
  ContentTopic,
  LanguageProficiency,
} from "@prisma/client";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function decimalOrNull(raw: string): string | null {
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? String(n) : null;
}

async function requireWriter(
  locale: string,
): Promise<{ userId: string; writerId: string }> {
  const session = await auth();
  if (!session?.user || session.user.role !== "CONTENT") {
    redirect(`/${locale}/signin`);
  }
  const profile = await prisma.writerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) redirect(`/${locale}/signin`);
  return { userId: session.user.id, writerId: profile.id };
}

export async function updateWriterProfile(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const { userId, writerId } = await requireWriter(locale);

  const languages = formData
    .getAll("languages")
    .filter((v): v is string => typeof v === "string")
    .filter((v) => v in ContentLanguage) as ContentLanguage[];
  const topics = formData
    .getAll("specialties")
    .filter((v): v is string => typeof v === "string")
    .filter((v) => v in ContentTopic) as ContentTopic[];
  const proficiency =
    (field(formData, "proficiency") as LanguageProficiency) || "FLUENT";

  await prisma.$transaction([
    prisma.writerProfile.update({
      where: { id: writerId },
      data: {
        bio: field(formData, "bio") || null,
        portfolioUrl: field(formData, "portfolioUrl") || null,
        currency: field(formData, "currency") || null,
        ratePerArticle: decimalOrNull(field(formData, "ratePerArticle")),
        ratePerWord: decimalOrNull(field(formData, "ratePerWord")),
        maxActiveAssignments: field(formData, "maxActiveAssignments")
          ? Number(field(formData, "maxActiveAssignments"))
          : null,
        active: field(formData, "active") === "on",
      },
    }),
    prisma.writerLanguage.deleteMany({ where: { writerId } }),
    prisma.writerSpecialty.deleteMany({ where: { writerId } }),
    prisma.writerLanguage.createMany({
      data: languages.map((language) => ({ writerId, language, proficiency })),
    }),
    prisma.writerSpecialty.createMany({
      data: topics.map((topic) => ({ writerId, topic })),
    }),
  ]);
  await recordAudit(userId, "writer.profile_update", `WriterProfile:${writerId}`);

  redirect(`/${locale}/writer/profile`);
}
```

Note: `field(formData,"active") === "on"` reads an HTML checkbox; `proficiency` is one global value applied to all selected languages (v1 — per-language proficiency editing is out of scope).

- [ ] **Step 2: Typecheck.**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add src/app/writer-profile-actions.ts
git commit -m "feat(writers): writer self-service profile update action"
```

---

## Task 10: Writer invite + claim

**Files:**
- Create: `src/app/writer-invite-actions.ts`
- Read for pattern: `src/app/[locale]/publisher` claim flow and any existing `PublisherInvite` action (search `publisherInvite` usage)

- [ ] **Step 1: Find the existing invite/claim pattern.**

Run: `grep -rn "publisherInvite\|PublisherInvite" src/app | head`
Read the matching action + signup page so the writer flow mirrors token generation, expiry, and single-use claim exactly.

- [ ] **Step 2: Write the actions** in `src/app/writer-invite-actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// Desk/superadmin issues a single-use, 14-day writer invite.
export async function createWriterInvite(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const email = field(formData, "email").toLowerCase();
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    redirect(`/${locale}/signin`);
  }
  if (!email) redirect(`/${locale}/desk/writers`);

  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  await prisma.writerInvite.create({
    data: { email, token, expiresAt, createdBy: session.user.id },
  });
  await recordAudit(session.user.id, "writer.invite", `WriterInvite:${email}`, {
    email,
  });

  // The desk surfaces the resulting /writer/claim/<token> link to send.
  redirect(`/${locale}/desk/writers`);
}

// Binds a new CONTENT user + empty WriterProfile when the invite is claimed.
// Call from the claim/signup route handler after the password is set and the
// User row is created; pass the freshly created userId.
export async function claimWriterInvite(
  token: string,
  newUserId: string,
): Promise<boolean> {
  const invite = await prisma.writerInvite.findUnique({ where: { token } });
  if (!invite || invite.claimedAt || invite.expiresAt < new Date()) {
    return false;
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: newUserId },
      data: { role: "CONTENT", emailVerifiedAt: new Date() },
    }),
    prisma.writerProfile.create({ data: { userId: newUserId } }),
    prisma.writerInvite.update({
      where: { token },
      data: { claimedAt: new Date(), claimedByUserId: newUserId },
    }),
  ]);
  await recordAudit(newUserId, "writer.invite_claim", `WriterInvite:${invite.id}`);
  return true;
}
```

Note: wire `claimWriterInvite` into the existing signup/claim route the way `PublisherInvite` is wired (found in Step 1). If the publisher flow uses a dedicated page under `src/app/[locale]/...`, add a parallel `src/app/[locale]/writer/claim/[token]/page.tsx` that reuses the shared signup form and calls `claimWriterInvite` on submit.

- [ ] **Step 3: Typecheck.**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add src/app/writer-invite-actions.ts src/app/[locale]/writer/claim 2>/dev/null
git commit -m "feat(writers): writer invite + claim binding CONTENT + profile"
```

---

## Task 11: Desk "Writers" panel on the order page

**Files:**
- Create: `src/app/[locale]/desk/orders/[orderId]/writers-panel.tsx`
- Modify: `src/app/[locale]/desk/orders/[orderId]/page.tsx` (import + render the panel; add per-line assignment dropdown)

- [ ] **Step 1: Read the order page** to match its data-loading and layout conventions.

Run: `sed -n '1,80p' src/app/[locale]/desk/orders/[orderId]/page.tsx`
Identify: how the `order` (with `lines`) is fetched, the `locale` param, and where line content blocks render.

- [ ] **Step 2: Create the panel** `src/app/[locale]/desk/orders/[orderId]/writers-panel.tsx`:

```tsx
import { loadRoster } from "@/lib/writers/roster";
import { rankWriters } from "@/lib/writers/match";
import { languageForCountry, topicForCategory } from "@/lib/writers/criteria";
import {
  addWriterToPool,
  removeWriterFromPool,
} from "@/app/writer-pool-actions";
import type { ContentLanguage, ContentTopic } from "@prisma/client";

type Props = {
  locale: string;
  orderId: string;
  poolWriterIds: string[];
  // Derived from the order's lines' titles (country code + category).
  criteriaCountry: string;
  criteriaCategory: string;
};

export async function WritersPanel({
  locale,
  orderId,
  poolWriterIds,
  criteriaCountry,
  criteriaCategory,
}: Props) {
  const roster = await loadRoster();
  const language: ContentLanguage | null = languageForCountry(criteriaCountry);
  const topics: ContentTopic[] = [topicForCategory(criteriaCategory)];
  const ranked = rankWriters(roster, { language, topics });

  return (
    <section className="rounded-lg border border-neutral-200 p-4">
      <h2 className="text-sm font-semibold">Writers</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Ranked by language ({language ?? "—"}) and specialty (
        {topics.join(", ")}). Add candidates to this order&apos;s pool, then
        assign one per line below.
      </p>
      <ul className="mt-3 divide-y divide-neutral-100">
        {ranked.map((w) => {
          const inPool = poolWriterIds.includes(w.id);
          return (
            <li key={w.id} className="flex items-center justify-between py-2">
              <div className="text-sm">
                <span className="font-medium">{w.name ?? w.email}</span>
                <span className="ml-2 text-xs text-neutral-500">
                  {w.languages.map((l) => l.language).join(", ") || "no langs"}
                  {" · "}
                  {w.specialties.map((s) => s.topic).join(", ") || "no topics"}
                  {w.maxActiveAssignments != null
                    ? ` · ${w.activeAssignments}/${w.maxActiveAssignments}`
                    : ` · ${w.activeAssignments} active`}
                  {!w.active ? " · inactive" : ""}
                  {w.match.overCapacity ? " · ⚠ over capacity" : ""}
                </span>
              </div>
              <form action={inPool ? removeWriterFromPool : addWriterToPool}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="orderId" value={orderId} />
                <input type="hidden" name="writerId" value={w.id} />
                <button
                  type="submit"
                  className="text-xs underline"
                >
                  {inPool ? "Remove" : "Add to pool"}
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: Render the panel + per-line dropdown** in `page.tsx`.

Ensure the order query includes the pool and line assignment:
```ts
// add to the order findUnique include:
writerPool: { select: { writerId: true, writer: { select: { user: { select: { name: true, email: true } } } } } },
lines: {
  // ...existing selects...
  // add:
  // assignedWriterId, and product->title->market countryCode + title.category
},
```
Render `<WritersPanel ... />` above the lines section, passing `poolWriterIds = order.writerPool.map(p => p.writerId)` and deriving `criteriaCountry`/`criteriaCategory` from the first line's title (`line.product?.title.countryCode`, `line.product?.title.category`).

For each line's content block, add an assignment dropdown limited to pool members:
```tsx
<form action={assignWriterToLine}>
  <input type="hidden" name="locale" value={locale} />
  <input type="hidden" name="orderId" value={order.id} />
  <input type="hidden" name="orderLineId" value={line.id} />
  <select name="writerId" defaultValue={line.assignedWriterId ?? ""}
          className="text-xs border rounded px-1 py-0.5">
    <option value="">— Unassigned —</option>
    {order.writerPool.map((p) => (
      <option key={p.writerId} value={p.writerId}>
        {p.writer.user.name ?? p.writer.user.email}
      </option>
    ))}
  </select>
  <button type="submit" className="ml-2 text-xs underline">Assign</button>
</form>
```
Add `import { assignWriterToLine } from "@/app/writer-pool-actions";` and `import { WritersPanel } from "./writers-panel";` to `page.tsx`.

- [ ] **Step 4: Typecheck + build.**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add "src/app/[locale]/desk/orders/[orderId]"
git commit -m "feat(writers): desk Writers panel + per-line assignment UI"
```

---

## Task 12: Writer console pages

**Files:**
- Create: `src/app/[locale]/writer/page.tsx` (My assignments)
- Create: `src/app/[locale]/writer/lines/[lineId]/page.tsx` (write surface)
- Create: `src/app/[locale]/writer/profile/page.tsx` (profile editor)

- [ ] **Step 1: My assignments** `src/app/[locale]/writer/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export default async function WriterHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "CONTENT" && role !== "DESK" && role !== "SUPERADMIN")) {
    redirect(`/${locale}/signin`);
  }

  const profile = await prisma.writerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  const lines = profile
    ? await prisma.orderLine.findMany({
        where: { assignedWriterId: profile.id },
        select: {
          id: true,
          product: {
            select: {
              name: true,
              title: { select: { name: true, countryCode: true } },
            },
          },
          brief: {
            select: {
              message: true,
              assets: {
                orderBy: { version: "desc" },
                take: 1,
                select: { status: true },
              },
            },
          },
          order: { select: { id: true } },
        },
        orderBy: { assignedAt: "desc" },
      })
    : [];

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-lg font-semibold">My assignments</h1>
      {lines.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-500">
          No assignments yet. The desk will assign you articles here.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-neutral-100">
          {lines.map((line) => (
            <li key={line.id} className="py-3">
              <Link
                href={`/${locale}/writer/lines/${line.id}`}
                className="font-medium underline"
              >
                {line.product?.title.name ?? "Article"} — {line.product?.name}
              </Link>
              <div className="text-xs text-neutral-500">
                {line.product?.title.countryCode} ·{" "}
                {line.brief?.assets[0]?.status ?? "NOT STARTED"}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Write surface** `src/app/[locale]/writer/lines/[lineId]/page.tsx`. Reuse `requireLineWriter` for authorisation and the existing `saveDraft`, `runSpecCheck`, `setAssetStatus` actions:

```tsx
import { prisma } from "@/lib/prisma";
import { requireLineWriter } from "@/lib/writers/guard";
import { saveDraft, runSpecCheck, setAssetStatus } from "@/app/desk-actions";

export default async function WriterLine({
  params,
}: {
  params: Promise<{ locale: string; lineId: string }>;
}) {
  const { locale, lineId } = await params;
  await requireLineWriter(lineId, locale); // redirects if not assigned

  const line = await prisma.orderLine.findUnique({
    where: { id: lineId },
    select: {
      id: true,
      orderId: true,
      brief: {
        select: {
          id: true,
          message: true,
          audience: true,
          doNotes: true,
          dontNotes: true,
          assets: {
            orderBy: { version: "desc" },
            take: 1,
            select: { id: true, status: true, body: true, specPassed: true, reviewNotes: true },
          },
        },
      },
    },
  });
  if (!line?.brief) {
    return <main className="p-6 text-sm">No brief for this line yet.</main>;
  }
  const latest = line.brief.assets[0];

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <section>
        <h1 className="text-lg font-semibold">Brief</h1>
        <dl className="mt-2 text-sm space-y-1">
          <div><dt className="inline font-medium">Message: </dt><dd className="inline">{line.brief.message}</dd></div>
          <div><dt className="inline font-medium">Audience: </dt><dd className="inline">{line.brief.audience}</dd></div>
          <div><dt className="inline font-medium">Do: </dt><dd className="inline">{line.brief.doNotes}</dd></div>
          <div><dt className="inline font-medium">Don&apos;t: </dt><dd className="inline">{line.brief.dontNotes}</dd></div>
        </dl>
      </section>

      <form action={saveDraft} className="space-y-2">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="orderId" value={line.orderId} />
        <input type="hidden" name="orderLineId" value={line.id} />
        <label className="block text-sm font-medium">Article</label>
        <textarea
          name="body"
          defaultValue={latest?.body ?? ""}
          rows={18}
          className="w-full rounded border p-2 text-sm font-mono"
        />
        <button type="submit" className="rounded bg-black px-3 py-1.5 text-sm text-white">
          Save draft
        </button>
      </form>

      {latest ? (
        <div className="flex items-center gap-4 text-sm">
          <span>Status: <strong>{latest.status}</strong>{latest.specPassed === true ? " · spec ✓" : latest.specPassed === false ? " · spec ✗" : ""}</span>
          <form action={runSpecCheck}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orderId" value={line.orderId} />
            <input type="hidden" name="assetId" value={latest.id} />
            <button type="submit" className="underline">Run spec check</button>
          </form>
          <form action={setAssetStatus}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orderId" value={line.orderId} />
            <input type="hidden" name="assetId" value={latest.id} />
            <input type="hidden" name="target" value="IN_REVIEW" />
            <button type="submit" className="underline">Submit for review</button>
          </form>
        </div>
      ) : null}
      {latest?.reviewNotes ? (
        <p className="text-sm text-amber-700">Review notes: {latest.reviewNotes}</p>
      ) : null}
    </main>
  );
}
```

Note: the role-based redirects added in Task 8 already send CONTENT writers back to `/${locale}/writer/lines/${orderLineId}` after save/spec-check/submit, so this page round-trips correctly. No further change needed here.

- [ ] **Step 3: Profile editor** `src/app/[locale]/writer/profile/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { updateWriterProfile } from "@/app/writer-profile-actions";
import { ContentLanguage, ContentTopic } from "@prisma/client";

export default async function WriterProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user || session.user.role !== "CONTENT") {
    redirect(`/${locale}/signin`);
  }
  const profile = await prisma.writerProfile.findUnique({
    where: { userId: session.user.id },
    include: { languages: true, specialties: true },
  });
  if (!profile) redirect(`/${locale}/signin`);

  const myLangs = new Set(profile.languages.map((l) => l.language));
  const myTopics = new Set(profile.specialties.map((s) => s.topic));

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-lg font-semibold">My profile</h1>
      <form action={updateWriterProfile} className="mt-4 space-y-4 text-sm">
        <input type="hidden" name="locale" value={locale} />

        <label className="block">
          <span className="font-medium">Bio</span>
          <textarea name="bio" defaultValue={profile.bio ?? ""} rows={3} className="mt-1 w-full rounded border p-2" />
        </label>

        <fieldset>
          <legend className="font-medium">Languages</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {Object.values(ContentLanguage).map((lang) => (
              <label key={lang} className="flex items-center gap-1">
                <input type="checkbox" name="languages" value={lang} defaultChecked={myLangs.has(lang)} />
                {lang}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="font-medium">Proficiency (applies to all selected)</span>
          <select name="proficiency" defaultValue="FLUENT" className="mt-1 block rounded border p-1">
            <option value="NATIVE">Native</option>
            <option value="FLUENT">Fluent</option>
            <option value="WORKING">Working</option>
          </select>
        </label>

        <fieldset>
          <legend className="font-medium">Specialties</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {Object.values(ContentTopic).map((topic) => (
              <label key={topic} className="flex items-center gap-1">
                <input type="checkbox" name="specialties" value={topic} defaultChecked={myTopics.has(topic)} />
                {topic}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="font-medium">Rate / article</span>
            <input name="ratePerArticle" defaultValue={profile.ratePerArticle ? String(profile.ratePerArticle) : ""} className="mt-1 w-full rounded border p-1" />
          </label>
          <label className="block">
            <span className="font-medium">Rate / word</span>
            <input name="ratePerWord" defaultValue={profile.ratePerWord ? String(profile.ratePerWord) : ""} className="mt-1 w-full rounded border p-1" />
          </label>
          <label className="block">
            <span className="font-medium">Currency</span>
            <input name="currency" defaultValue={profile.currency ?? ""} className="mt-1 w-full rounded border p-1" />
          </label>
          <label className="block">
            <span className="font-medium">Max active assignments</span>
            <input name="maxActiveAssignments" type="number" defaultValue={profile.maxActiveAssignments ?? ""} className="mt-1 w-full rounded border p-1" />
          </label>
        </div>

        <label className="block">
          <span className="font-medium">Portfolio URL</span>
          <input name="portfolioUrl" defaultValue={profile.portfolioUrl ?? ""} className="mt-1 w-full rounded border p-1" />
        </label>

        <label className="flex items-center gap-2">
          <input type="checkbox" name="active" defaultChecked={profile.active} />
          <span className="font-medium">Available for new work</span>
        </label>

        <button type="submit" className="rounded bg-black px-3 py-1.5 text-white">Save profile</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Typecheck + build.**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: type-clean; build succeeds.

- [ ] **Step 5: Commit.**

```bash
git add "src/app/[locale]/writer"
git commit -m "feat(writers): writer console — assignments, write surface, profile"
```

---

## Task 13: Full verification pass

- [ ] **Step 1: Run the whole test suite.**

Run: `pnpm test`
Expected: all tests pass, including the new `criteria`, `match`, `access`, and updated `roles` tests.

- [ ] **Step 2: Typecheck + lint + build.**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: clean.

- [ ] **Step 3: Manual smoke (optional, against a dev DB).**
- Seed a CONTENT user + `WriterProfile` (or claim an invite); sign in → lands on `/writer`.
- As desk, open a firm order → Writers panel ranks the roster → add two writers to pool → assign one to a line.
- As that writer → `/writer` shows the line → open it → save draft → run spec check → submit for review.
- Confirm a non-assigned writer is redirected away from `/writer/lines/<id>`.

- [ ] **Step 4: Final commit (if any lint fixes).**

```bash
git add -A
git commit -m "chore(writers): lint/build fixes for writer pool feature"
```

---

## Notes / decisions carried from the spec
- Matching is **advisory** — nothing is filtered out; the desk always picks.
- Capacity is **advisory** — over-cap warns, never blocks.
- Writers **do not self-claim** in v1; the desk assigns.
- `ContentTopic` is an **enum** for v1; promote to a table only if the desk needs to edit categories.
- All schema changes are **additive/nullable** → safe on auto-deploy-on-push prod.
