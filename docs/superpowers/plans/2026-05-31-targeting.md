# Targeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver honest targeting — a reach-tier catalog filter, structured geo (city/region) enrichment, a campaign-level targeting brief on the Plan, and honest targeting marketing — without ever claiming user-level sociodemographic/behavioral/retargeting capability.

**Architecture:** Targeting = selecting and briefing by real `Title` attributes. Add one clean catalog filter (reach-tier, no schema change), enrich geo into structured `Title.city`/`Title.region` via a deterministic confident-only backfill, capture structured intent in new nullable `Plan.target*` fields surfaced to the desk, and name the three honest dimensions (contextual/geographic/audience-segment) in marketing. Pure parse/segment logic is unit-tested; everything else is guarded by `tsc` + build + i18n parity.

**Tech Stack:** Next.js App Router, Prisma/PostgreSQL, next-intl (root `src/messages/{locale}.json` namespaces + `src/messages/landing/{locale}/` for landing). Tests: `node:test` (NOT Vitest). Locales: en, no, sv, da, fi, de.

**Branch:** `feat/targeting` (already created off `feat/formats-native-plus-video`; do NOT switch). Spec: `docs/superpowers/specs/2026-05-31-targeting-design.md`.

**Conventions (verified, do not deviate):**
- `prisma migrate dev`/`reset` are BLOCKED for the agent. Hand-author migration SQL under `prisma/migrations/<ts>_name/migration.sql`, then `prisma db execute --schema prisma/schema.prisma --file <sql>` + `prisma migrate resolve --applied <name>` + `prisma generate`. New migration timestamp must sort AFTER `20260531120000_add_native_plus_content_video`.
- Commands: `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm tsx <script>`.
- The repo's shell intermittently mangles long terminal output — **before every Edit, re-read the exact current lines** of the target file with Read; do not trust line numbers in this plan blindly (they may have drifted).
- Catalog translation namespaces in `catalog/page.tsx`: `nativeFit` (values High/Medium/Low), `marketCode`, `productType`, plus `catalog.filters` for filter labels. The reach filter mirrors the existing **single-select `nativeFit`** filter exactly.

---

## File Structure

**Slice 1 — reach filter (no schema):**
- `src/app/[locale]/catalog/page.tsx` — add `REACH_VALUES`, `tReach`, parse `reach`, add to `where`, pass `reaches` prop.
- `src/app/[locale]/catalog/_components/CatalogFilters.tsx` — `reaches` prop + `initial.reach` + a select group mirroring nativeFit.
- `src/messages/{locale}.json` — new `reachTier` namespace + `catalog.filters.reach` label.

**Slice 2 — geo schema + parseGeo:**
- `prisma/schema.prisma` — `Title.city`, `Title.region` (+indexes); `Plan.targetGeo/targetAudience/targetContext`.
- `prisma/migrations/20260531130000_add_title_geo_and_plan_targeting/migration.sql`.
- `src/lib/targeting/geo.ts` — pure `parseGeo(locationNote, marketCode)` + per-market city→region tables.
- `src/lib/targeting/geo.test.ts` — node:test.

**Slice 3 — backfill:**
- `scripts/backfill-title-geo.ts` — idempotent, confident-only, prints per-market coverage.

**Slice 4 — catalog region filter:**
- `catalog/page.tsx` + `CatalogFilters.tsx` — region multi-select (mirrors `vertical`); add `city` to search columns.

**Slice 5 — Plan targeting brief:**
- `src/lib/targeting/segments.ts` — typed audience-segment taxonomy + label keys.
- `src/app/[locale]/plan/page.tsx` — geo/audience/context selectors.
- `src/app/actions.ts` — read + persist `target*` on Plan; include in `briefSummary`.
- `src/lib/basket.ts` — extend `PlanBrief` cookie type with target fields.
- `src/messages/{locale}.json` — plan-form targeting labels + segment labels.

**Slice 6 — marketing + claim fix:**
- `src/app/[locale]/(marketing)/for-advertisers/page.tsx` — targeting section.
- `src/messages/{locale}.json` — `advertisers` targeting copy; fix `formats.native-display.bestFor` (drop retargeting).

---

## Task 1: Reach-tier catalog filter

**Files:**
- Modify: `src/app/[locale]/catalog/page.tsx`
- Modify: `src/app/[locale]/catalog/_components/CatalogFilters.tsx`
- Modify: `src/messages/{en,no,sv,da,fi,de}.json`

- [ ] **Step 1: Add `reachTier` i18n namespace + filter label (English).** In `src/messages/en.json`, add a root namespace:

```json
  "reachTier": {
    "reach": "Reach",
    "National": "National",
    "Regional": "Regional",
    "Local": "Local",
    "Niche": "Niche"
  },
```

And add a `reach` key to the existing `catalog.filters` object: `"reach": "Reach"`.

- [ ] **Step 2: Translate `reachTier` + `catalog.filters.reach` into no/sv/da/fi/de.** Natural labels:
  - no: Reach→"Rekkevidde", National→"Nasjonal", Regional→"Regional", Local→"Lokal", Niche→"Nisje"
  - sv: "Räckvidd"/"Nationell"/"Regional"/"Lokal"/"Nisch"
  - da: "Rækkevidde"/"National"/"Regional"/"Lokal"/"Niche"
  - fi: "Tavoittavuus"/"Valtakunnallinen"/"Alueellinen"/"Paikallinen"/"Nichemedia"
  - de: "Reichweite"/"National"/"Regional"/"Lokal"/"Nische"
  Set `catalog.filters.reach` to the same word as `reachTier.reach` per locale.

- [ ] **Step 3: Wire the page.** In `catalog/page.tsx`: (a) add `const REACH_VALUES = ["National","Regional","Local","Niche"] as const;` beside `NATIVE_FIT_VALUES`; (b) add `const tReach = await getTranslations({ locale, namespace: "reachTier" });` beside `tFit`; (c) parse it beside `nativeFit`:

```ts
  const reach = asEnum(
    typeof sp.reach === "string" ? sp.reach : undefined,
    REACH_VALUES,
  );
```

(d) add to the `where` object beside `...(nativeFit ? { nativeFit } : {})`:

```ts
    ...(reach ? { reach } : {}),
```

(e) pass to `<CatalogFilters>` a new prop and initial value:

```tsx
        reaches={REACH_VALUES.map((v) => ({ value: v, label: tReach(v) }))}
```

and inside `initial={{ ... }}` add `reach: reach ?? "",`.

- [ ] **Step 4: Wire the component.** In `CatalogFilters.tsx`: add `reaches: Option[];` to `Props`, add `reach: string;` to `initial`, destructure `reaches` in the function signature, and add a select group immediately after the `nativeFit` group, mirroring it exactly:

```tsx
        <div className="filter-field">
          <label htmlFor="reach">{t("reach")}</label>
          <select
            id="reach"
            value={initial.reach}
            onChange={(e) => setSingle("reach", e.target.value)}
          >
            <option value="">{t("any")}</option>
            {reaches.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </div>
```

> Re-read the actual `nativeFit` group block first and copy its exact wrapper classes / "any" option key — match whatever it uses (the snippet above assumes `filter-field` + `t("any")`; adjust to the real markup).

- [ ] **Step 5: Verify.**

Run: `pnpm typecheck` → expect no new errors (only pre-existing untracked `content-fee.it.test.ts`).
Run: `pnpm build` → "Compiled successfully".

- [ ] **Step 6: Commit.**

```bash
git add "src/app/[locale]/catalog/page.tsx" "src/app/[locale]/catalog/_components/CatalogFilters.tsx" src/messages
git commit -m "feat(targeting): reach-tier catalog filter (six locales)"
```

---

## Task 2: Geo + Plan-targeting schema, migration, and `parseGeo`

**Files:**
- Modify: `prisma/schema.prisma` (Title ~244-331; Plan model)
- Create: `prisma/migrations/20260531130000_add_title_geo_and_plan_targeting/migration.sql`
- Create: `src/lib/targeting/geo.ts`, `src/lib/targeting/geo.test.ts`

- [ ] **Step 1: Schema — Title geo columns.** In `model Title`, after `locationNote String?`, add:

```prisma
  // Structured geo derived from locationNote where confident (Title geo
  // enrichment). Null when national/unknown; locationNote stays the raw note.
  city   String?
  region String?
```

Add to the Title `@@index` block: `@@index([city])` and `@@index([region])`.

- [ ] **Step 2: Schema — Plan targeting fields.** In `model Plan`, after `goal String?`, add:

```prisma
  // Structured campaign targeting intent — what the buyer wants to reach.
  // Descriptive (used by the desk to pick titles); NOT an ad-server audience.
  targetGeo      String? // markets/regions chosen, comma-separated
  targetAudience String? // audience-segment labels, comma-separated
  targetContext  String? // categories/verticals, comma-separated
```

- [ ] **Step 3: Write the migration.** Create `prisma/migrations/20260531130000_add_title_geo_and_plan_targeting/migration.sql`:

```sql
-- Title geo enrichment + Plan structured targeting brief. All additive,
-- all nullable; no enum changes, safe to run as one transaction.

-- AlterTable: Title
ALTER TABLE "Title"
  ADD COLUMN IF NOT EXISTS "city" TEXT,
  ADD COLUMN IF NOT EXISTS "region" TEXT;

-- AlterTable: Plan
ALTER TABLE "Plan"
  ADD COLUMN IF NOT EXISTS "targetGeo" TEXT,
  ADD COLUMN IF NOT EXISTS "targetAudience" TEXT,
  ADD COLUMN IF NOT EXISTS "targetContext" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Title_city_idx" ON "Title"("city");
CREATE INDEX IF NOT EXISTS "Title_region_idx" ON "Title"("region");
```

- [ ] **Step 4: Apply + generate.**

```bash
pnpm prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20260531130000_add_title_geo_and_plan_targeting/migration.sql
pnpm prisma migrate resolve --applied 20260531130000_add_title_geo_and_plan_targeting
pnpm prisma generate
```

Run: `pnpm prisma migrate status` → "Database schema is up to date!"

- [ ] **Step 5: Write the failing test for `parseGeo`.** Create `src/lib/targeting/geo.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGeo } from "./geo";

test("parseGeo maps a known city to city + region", () => {
  assert.deepEqual(parseGeo("Bergen", "NO"), { city: "Bergen", region: "Vestlandet" });
});

test("parseGeo strips a trailing descriptor before matching", () => {
  assert.deepEqual(parseGeo("Dresden consumer", "DE"), { city: "Dresden", region: "Sachsen" });
});

test("parseGeo handles a multi-city note sharing one region", () => {
  assert.deepEqual(parseGeo("Asker/Bærum", "NO"), { city: "Asker", region: "Østlandet" });
});

test("parseGeo returns nulls for a non-place note", () => {
  assert.deepEqual(parseGeo("Diabetes", "NO"), { city: null, region: null });
});

test("parseGeo returns nulls for empty/whitespace", () => {
  assert.deepEqual(parseGeo("   ", "NO"), { city: null, region: null });
  assert.deepEqual(parseGeo(null, "NO"), { city: null, region: null });
});

test("parseGeo only matches within the given market", () => {
  // "Bergen" is a Norwegian city; it must not match for a German title.
  assert.deepEqual(parseGeo("Bergen", "DE"), { city: null, region: null });
});
```

- [ ] **Step 6: Run test to verify it fails.**

Run: `pnpm test 2>&1 | grep -A2 parseGeo`
Expected: FAIL — cannot find module `./geo`.

- [ ] **Step 7: Implement `src/lib/targeting/geo.ts`.** Deterministic per-market city→region tables (seed from the distinct `locationNote` values captured in planning; start with the confident ones below and expand). The function lowercases, strips a trailing descriptor word, and looks up the leading city token.

```ts
export type ParsedGeo = { city: string | null; region: string | null };

// Per-market city → region lookup. Keys are lowercase city names; values are
// { city: display-cased, region }. Confident matches only — anything not here
// stays null. Expand over time; partial coverage is acceptable by design.
type CityEntry = { city: string; region: string };
const CITY_TABLES: Record<string, Record<string, CityEntry>> = {
  NO: {
    oslo: { city: "Oslo", region: "Østlandet" },
    asker: { city: "Asker", region: "Østlandet" },
    bærum: { city: "Bærum", region: "Østlandet" },
    drammen: { city: "Drammen", region: "Østlandet" },
    fredrikstad: { city: "Fredrikstad", region: "Østlandet" },
    sarpsborg: { city: "Sarpsborg", region: "Østlandet" },
    moss: { city: "Moss", region: "Østlandet" },
    lillestrøm: { city: "Lillestrøm", region: "Østlandet" },
    hamar: { city: "Hamar", region: "Innlandet" },
    lillehammer: { city: "Lillehammer", region: "Innlandet" },
    gjøvik: { city: "Gjøvik", region: "Innlandet" },
    elverum: { city: "Elverum", region: "Innlandet" },
    bergen: { city: "Bergen", region: "Vestlandet" },
    stavanger: { city: "Stavanger", region: "Vestlandet" },
    sandnes: { city: "Sandnes", region: "Vestlandet" },
    haugesund: { city: "Haugesund", region: "Vestlandet" },
    ålesund: { city: "Ålesund", region: "Vestlandet" },
    førde: { city: "Førde", region: "Vestlandet" },
    jæren: { city: "Jæren", region: "Vestlandet" },
    bryne: { city: "Bryne", region: "Vestlandet" },
    egersund: { city: "Egersund", region: "Vestlandet" },
    trondheim: { city: "Trondheim", region: "Trøndelag" },
    steinkjer: { city: "Steinkjer", region: "Trøndelag" },
    levanger: { city: "Levanger", region: "Trøndelag" },
    namsos: { city: "Namsos", region: "Trøndelag" },
    tromsø: { city: "Tromsø", region: "Nord-Norge" },
    bodø: { city: "Bodø", region: "Nord-Norge" },
    harstad: { city: "Harstad", region: "Nord-Norge" },
    narvik: { city: "Narvik", region: "Nord-Norge" },
    "mo i rana": { city: "Mo i Rana", region: "Nord-Norge" },
    mosjøen: { city: "Mosjøen", region: "Nord-Norge" },
    alta: { city: "Alta", region: "Nord-Norge" },
    hammerfest: { city: "Hammerfest", region: "Nord-Norge" },
    kirkenes: { city: "Kirkenes", region: "Nord-Norge" },
    kristiansand: { city: "Kristiansand", region: "Sørlandet" },
    arendal: { city: "Arendal", region: "Sørlandet" },
    grimstad: { city: "Grimstad", region: "Sørlandet" },
    mandal: { city: "Mandal", region: "Sørlandet" },
    skien: { city: "Skien", region: "Østlandet" },
    porsgrunn: { city: "Porsgrunn", region: "Østlandet" },
    tønsberg: { city: "Tønsberg", region: "Østlandet" },
    sandefjord: { city: "Sandefjord", region: "Østlandet" },
    larvik: { city: "Larvik", region: "Østlandet" },
    kongsberg: { city: "Kongsberg", region: "Østlandet" },
  },
  SE: {
    stockholm: { city: "Stockholm", region: "Svealand" },
    uppsala: { city: "Uppsala", region: "Svealand" },
    västerås: { city: "Västerås", region: "Svealand" },
    örebro: { city: "Örebro", region: "Svealand" },
    göteborg: { city: "Göteborg", region: "Götaland" },
    malmö: { city: "Malmö", region: "Götaland" },
    lund: { city: "Lund", region: "Götaland" },
    helsingborg: { city: "Helsingborg", region: "Götaland" },
    linköping: { city: "Linköping", region: "Götaland" },
    norrköping: { city: "Norrköping", region: "Götaland" },
    jönköping: { city: "Jönköping", region: "Götaland" },
    växjö: { city: "Växjö", region: "Götaland" },
    kalmar: { city: "Kalmar", region: "Götaland" },
    umeå: { city: "Umeå", region: "Norrland" },
    luleå: { city: "Luleå", region: "Norrland" },
    sundsvall: { city: "Sundsvall", region: "Norrland" },
    gävle: { city: "Gävle", region: "Norrland" },
    östersund: { city: "Östersund", region: "Norrland" },
  },
  DK: {
    københavn: { city: "København", region: "Hovedstaden" },
    helsingør: { city: "Helsingør", region: "Hovedstaden" },
    hillerød: { city: "Hillerød", region: "Hovedstaden" },
    roskilde: { city: "Roskilde", region: "Sjælland" },
    holbæk: { city: "Holbæk", region: "Sjælland" },
    køge: { city: "Køge", region: "Sjælland" },
    odense: { city: "Odense", region: "Syddanmark" },
    esbjerg: { city: "Esbjerg", region: "Syddanmark" },
    fredericia: { city: "Fredericia", region: "Syddanmark" },
    vejle: { city: "Vejle", region: "Syddanmark" },
    aarhus: { city: "Aarhus", region: "Midtjylland" },
    horsens: { city: "Horsens", region: "Midtjylland" },
    herning: { city: "Herning", region: "Midtjylland" },
    viborg: { city: "Viborg", region: "Midtjylland" },
    randers: { city: "Randers", region: "Midtjylland" },
    aalborg: { city: "Aalborg", region: "Nordjylland" },
    hjørring: { city: "Hjørring", region: "Nordjylland" },
  },
  FI: {
    helsinki: { city: "Helsinki", region: "Uusimaa" },
    espoo: { city: "Espoo", region: "Uusimaa" },
    vantaa: { city: "Vantaa", region: "Uusimaa" },
    porvoo: { city: "Porvoo", region: "Uusimaa" },
    turku: { city: "Turku", region: "Varsinais-Suomi" },
    tampere: { city: "Tampere", region: "Pirkanmaa" },
    jyväskylä: { city: "Jyväskylä", region: "Keski-Suomi" },
    oulu: { city: "Oulu", region: "Pohjois-Pohjanmaa" },
    kuopio: { city: "Kuopio", region: "Pohjois-Savo" },
    lahti: { city: "Lahti", region: "Päijät-Häme" },
    pori: { city: "Pori", region: "Satakunta" },
    vaasa: { city: "Vaasa", region: "Pohjanmaa" },
    joensuu: { city: "Joensuu", region: "Pohjois-Karjala" },
    lappeenranta: { city: "Lappeenranta", region: "Etelä-Karjala" },
    rovaniemi: { city: "Rovaniemi", region: "Lappi" },
    seinäjoki: { city: "Seinäjoki", region: "Etelä-Pohjanmaa" },
    kotka: { city: "Kotka", region: "Kymenlaakso" },
    mikkeli: { city: "Mikkeli", region: "Etelä-Savo" },
    hämeenlinna: { city: "Hämeenlinna", region: "Kanta-Häme" },
    kouvola: { city: "Kouvola", region: "Kymenlaakso" },
  },
  DE: {
    berlin: { city: "Berlin", region: "Berlin" },
    hamburg: { city: "Hamburg", region: "Hamburg" },
    münchen: { city: "München", region: "Bayern" },
    munich: { city: "München", region: "Bayern" },
    nuremberg: { city: "Nürnberg", region: "Bayern" },
    nürnberg: { city: "Nürnberg", region: "Bayern" },
    augsburg: { city: "Augsburg", region: "Bayern" },
    regensburg: { city: "Regensburg", region: "Bayern" },
    ingolstadt: { city: "Ingolstadt", region: "Bayern" },
    passau: { city: "Passau", region: "Bayern" },
    cologne: { city: "Köln", region: "Nordrhein-Westfalen" },
    köln: { city: "Köln", region: "Nordrhein-Westfalen" },
    düsseldorf: { city: "Düsseldorf", region: "Nordrhein-Westfalen" },
    dortmund: { city: "Dortmund", region: "Nordrhein-Westfalen" },
    essen: { city: "Essen", region: "Nordrhein-Westfalen" },
    aachen: { city: "Aachen", region: "Nordrhein-Westfalen" },
    bonn: { city: "Bonn", region: "Nordrhein-Westfalen" },
    münster: { city: "Münster", region: "Nordrhein-Westfalen" },
    bielefeld: { city: "Bielefeld", region: "Nordrhein-Westfalen" },
    frankfurt: { city: "Frankfurt", region: "Hessen" },
    wiesbaden: { city: "Wiesbaden", region: "Hessen" },
    kassel: { city: "Kassel", region: "Hessen" },
    stuttgart: { city: "Stuttgart", region: "Baden-Württemberg" },
    mannheim: { city: "Mannheim", region: "Baden-Württemberg" },
    freiburg: { city: "Freiburg", region: "Baden-Württemberg" },
    ulm: { city: "Ulm", region: "Baden-Württemberg" },
    dresden: { city: "Dresden", region: "Sachsen" },
    leipzig: { city: "Leipzig", region: "Sachsen" },
    chemnitz: { city: "Chemnitz", region: "Sachsen" },
    bremen: { city: "Bremen", region: "Bremen" },
    hannover: { city: "Hannover", region: "Niedersachsen" },
    oldenburg: { city: "Oldenburg", region: "Niedersachsen" },
    osnabrück: { city: "Osnabrück", region: "Niedersachsen" },
    kiel: { city: "Kiel", region: "Schleswig-Holstein" },
    lübeck: { city: "Lübeck", region: "Schleswig-Holstein" },
    magdeburg: { city: "Magdeburg", region: "Sachsen-Anhalt" },
    halle: { city: "Halle", region: "Sachsen-Anhalt" },
    erfurt: { city: "Erfurt", region: "Thüringen" },
    rostock: { city: "Rostock", region: "Mecklenburg-Vorpommern" },
    potsdam: { city: "Potsdam", region: "Brandenburg" },
    mainz: { city: "Mainz", region: "Rheinland-Pfalz" },
    koblenz: { city: "Koblenz", region: "Rheinland-Pfalz" },
    trier: { city: "Trier", region: "Rheinland-Pfalz" },
    saarbrücken: { city: "Saarbrücken", region: "Saarland" },
    darmstadt: { city: "Darmstadt", region: "Hessen" },
  },
  AT: {
    vienna: { city: "Wien", region: "Wien" },
    wien: { city: "Wien", region: "Wien" },
    graz: { city: "Graz", region: "Steiermark" },
    linz: { city: "Linz", region: "Oberösterreich" },
    salzburg: { city: "Salzburg", region: "Salzburg" },
    innsbruck: { city: "Innsbruck", region: "Tirol" },
    klagenfurt: { city: "Klagenfurt", region: "Kärnten" },
  },
  CH: {
    zürich: { city: "Zürich", region: "Zürich" },
    zurich: { city: "Zürich", region: "Zürich" },
    bern: { city: "Bern", region: "Bern" },
    basel: { city: "Basel", region: "Basel" },
    geneva: { city: "Genève", region: "Genève" },
    genève: { city: "Genève", region: "Genève" },
    lausanne: { city: "Lausanne", region: "Vaud" },
    lucerne: { city: "Luzern", region: "Luzern" },
    luzern: { city: "Luzern", region: "Luzern" },
    fribourg: { city: "Fribourg", region: "Fribourg" },
    neuchâtel: { city: "Neuchâtel", region: "Neuchâtel" },
    aargau: { city: "Aarau", region: "Aargau" },
  },
  UK: {
    london: { city: "London", region: "England" },
    manchester: { city: "Manchester", region: "England" },
    birmingham: { city: "Birmingham", region: "England" },
    liverpool: { city: "Liverpool", region: "England" },
    leeds: { city: "Leeds", region: "England" },
    sheffield: { city: "Sheffield", region: "England" },
    bristol: { city: "Bristol", region: "England" },
    newcastle: { city: "Newcastle", region: "England" },
    nottingham: { city: "Nottingham", region: "England" },
    leicester: { city: "Leicester", region: "England" },
    cambridge: { city: "Cambridge", region: "England" },
    oxford: { city: "Oxford", region: "England" },
    brighton: { city: "Brighton", region: "England" },
    portsmouth: { city: "Portsmouth", region: "England" },
    southampton: { city: "Southampton", region: "England" },
    plymouth: { city: "Plymouth", region: "England" },
    aberdeen: { city: "Aberdeen", region: "Scotland" },
    glasgow: { city: "Glasgow", region: "Scotland" },
    edinburgh: { city: "Edinburgh", region: "Scotland" },
    dundee: { city: "Dundee", region: "Scotland" },
    cardiff: { city: "Cardiff", region: "Wales" },
    swansea: { city: "Swansea", region: "Wales" },
    newport: { city: "Newport", region: "Wales" },
    wrexham: { city: "Wrexham", region: "Wales" },
    belfast: { city: "Belfast", region: "Northern Ireland" },
  },
  IE: {
    dublin: { city: "Dublin", region: "Leinster" },
    cork: { city: "Cork", region: "Munster" },
    limerick: { city: "Limerick", region: "Munster" },
    galway: { city: "Galway", region: "Connacht" },
    waterford: { city: "Waterford", region: "Munster" },
    kilkenny: { city: "Kilkenny", region: "Leinster" },
    sligo: { city: "Sligo", region: "Connacht" },
    athlone: { city: "Athlone", region: "Leinster" },
    tralee: { city: "Tralee", region: "Munster" },
    dundalk: { city: "Dundalk", region: "Leinster" },
    wexford: { city: "Wexford", region: "Leinster" },
    wicklow: { city: "Wicklow", region: "Leinster" },
  },
};

// Trailing descriptors that follow a city in locationNote and should be
// stripped before matching ("Dresden consumer", "Vienna affluent").
const DESCRIPTOR_TAIL = /\s+(consumer|affluent|local|quality|premium|free|metro|edition|area|region)\b.*$/i;

export function parseGeo(
  locationNote: string | null | undefined,
  marketCode: string,
): ParsedGeo {
  const table = CITY_TABLES[marketCode];
  if (!table || !locationNote) return { city: null, region: null };
  let note = locationNote.trim();
  if (!note) return { city: null, region: null };

  // For "Asker/Bærum" take the first token; for "Dresden consumer" strip tail.
  note = note.split("/")[0]!.trim();
  note = note.replace(DESCRIPTOR_TAIL, "").trim();
  const key = note.toLowerCase();
  const hit = table[key];
  return hit ? { city: hit.city, region: hit.region } : { city: null, region: null };
}
```

> The test's "Asker/Bærum → Østlandet" works because `asker` is in the NO table. Confirm every city the tests reference exists in the tables before running.

- [ ] **Step 8: Run test to verify it passes.**

Run: `pnpm test 2>&1 | grep -E "parseGeo|pass|fail"`
Expected: PASS (6 tests).

- [ ] **Step 9: Typecheck + commit.**

```bash
pnpm typecheck   # no new errors
git add prisma/schema.prisma prisma/migrations/20260531130000_add_title_geo_and_plan_targeting src/lib/targeting/geo.ts src/lib/targeting/geo.test.ts
git commit -m "feat(targeting): Title geo + Plan targeting schema, parseGeo helper"
```

---

## Task 3: Geo backfill script

**Files:**
- Create: `scripts/backfill-title-geo.ts`

- [ ] **Step 1: Implement the script** (idempotent — only writes where city/region are null; prints per-market coverage):

```ts
import { prisma } from "@/lib/prisma";
import { parseGeo } from "@/lib/targeting/geo";

async function main() {
  const titles = await prisma.title.findMany({
    where: { locationNote: { not: null }, city: null, region: null },
    select: { id: true, countryCode: true, locationNote: true },
  });

  const perMarket: Record<string, { updated: number; seen: number }> = {};
  let updated = 0;

  for (const t of titles) {
    const m = (perMarket[t.countryCode] ??= { updated: 0, seen: 0 });
    m.seen += 1;
    const { city, region } = parseGeo(t.locationNote, t.countryCode);
    if (city || region) {
      await prisma.title.update({ where: { id: t.id }, data: { city, region } });
      updated += 1;
      m.updated += 1;
    }
  }

  console.log(`Backfill complete: ${updated} titles updated.`);
  console.log("Per market (updated / candidates with locationNote):");
  for (const [mk, v] of Object.entries(perMarket).sort()) {
    console.log(`  ${mk}: ${v.updated} / ${v.seen}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against the dev DB and capture coverage.**

Run: `pnpm tsx scripts/backfill-title-geo.ts`
Expected: prints "Backfill complete: N titles updated" and a per-market breakdown. Record the numbers — a meaningful share of NO/UK/DE/IE titles should get a region; markets with mostly non-place notes will be low, which is fine.

- [ ] **Step 3: Sanity-check no over-reach.** Run a quick check that no region was assigned to an obviously non-place note:

```bash
pnpm tsx -e "import {prisma} from '@/lib/prisma'; const r=await prisma.title.findMany({where:{region:{not:null}},select:{locationNote:true,city:true,region:true},take:20}); console.log(r); await prisma.\$disconnect();"
```

Expected: every row's `locationNote` is recognizably the assigned city. If any look wrong, tighten the table/descriptor regex and re-run (idempotent).

- [ ] **Step 4: Commit.**

```bash
git add scripts/backfill-title-geo.ts
git commit -m "feat(targeting): confident-only geo backfill script"
```

---

## Task 4: Catalog region filter + city in search

**Files:**
- Modify: `src/app/[locale]/catalog/page.tsx`
- Modify: `src/app/[locale]/catalog/_components/CatalogFilters.tsx`
- Modify: `src/messages/{en,no,sv,da,fi,de}.json`

- [ ] **Step 1: Page — parse + where + options (mirror `vertical`, which is multi-select).** In `catalog/page.tsx`:
  (a) parse beside `verticals`:

```ts
  const regionsRaw = typeof sp.region === "string" ? sp.region : "";
  const regions = regionsRaw.split(",").map((s) => s.trim()).filter(Boolean);
```

  (b) add to `where` beside `...(verticals.length ? { vertical: { in: verticals } } : {})`:

```ts
    ...(regions.length ? { region: { in: regions } } : {}),
```

  (c) add `city` to the ILIKE fallback `OR` array (beside the `tags` contains clause):

```ts
              { city: { contains: q, mode: "insensitive" } },
```

  (d) build distinct region options (mirror how `verticalOptions` is built — a `distinct` query on `Title.region` where not null). Add near `verticalOptions`:

```ts
  const regionRows = await prisma.title.findMany({
    where: { region: { not: null } },
    select: { region: true },
    distinct: ["region"],
    orderBy: { region: "asc" },
  });
  const regionOptions = regionRows.map((r) => r.region!).filter(Boolean);
```

  (e) pass to `<CatalogFilters>`:

```tsx
        regions={regionOptions.map((r) => ({ value: r, label: r }))}
```

  and in `initial={{ ... }}` add `regions,`.

- [ ] **Step 2: Component — region multi-select (mirror the `vertical`/category multi-select group).** In `CatalogFilters.tsx`: add `regions: Option[];` to `Props`, add `regions: string[];` to `initial`, destructure `regions`, and add a multi-select group modeled exactly on the existing vertical/category group (same open/close ref pattern, same `commit`/`setMulti` handler that does `p.set("region", values.join(","))` / `p.delete("region")`). Region values are display strings (no separate label namespace needed).

> Re-read the vertical/category group block first and copy its structure precisely, substituting `region` for `vertical`.

- [ ] **Step 3: i18n — region filter label (six locales).** Add `"region": "Region"` to `catalog.filters` in each `src/messages/{locale}.json`. ("Region" is the same word in en/no/sv/da/de; fi: "Alue".)

- [ ] **Step 4: Verify.**

Run: `pnpm typecheck` → no new errors.
Run: `pnpm build` → "Compiled successfully".

- [ ] **Step 5: Commit.**

```bash
git add "src/app/[locale]/catalog/page.tsx" "src/app/[locale]/catalog/_components/CatalogFilters.tsx" src/messages
git commit -m "feat(targeting): catalog region filter + city search (six locales)"
```

---

## Task 5: Plan targeting brief

**Files:**
- Create: `src/lib/targeting/segments.ts`
- Modify: `src/lib/basket.ts` (PlanBrief type + readPlanBrief)
- Modify: `src/app/[locale]/plan/page.tsx` (form selectors)
- Modify: `src/app/actions.ts` (submitRequest: read + persist + briefSummary)
- Modify: `src/messages/{en,no,sv,da,fi,de}.json` (labels + segment names)

- [ ] **Step 1: Audience-segment taxonomy.** Create `src/lib/targeting/segments.ts` — a curated controlled list distilled from the real `Title.audience` values (top values: General consumer, Regional consumer, then profession/lifestyle clusters):

```ts
// Curated campaign audience segments, distilled from the Title.audience
// taxonomy. These describe the editorial audience a buyer wants to reach
// (used by the desk to pick titles) — NOT user-level ad-targeting data.
export const AUDIENCE_SEGMENTS = [
  "general-consumer",
  "regional-local",
  "affluent",
  "families-parents",
  "seniors-50plus",
  "b2b-decision-makers",
  "healthcare-pros",
  "legal-finance-pros",
  "tech-it-pros",
  "construction-property-pros",
  "farming-rural",
  "lifestyle-hobby",
  "culture-media",
] as const;

export type AudienceSegment = (typeof AUDIENCE_SEGMENTS)[number];

export function isAudienceSegment(v: string): v is AudienceSegment {
  return (AUDIENCE_SEGMENTS as readonly string[]).includes(v);
}
```

- [ ] **Step 2: Test the guard.** Create `src/lib/targeting/segments.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAudienceSegment, AUDIENCE_SEGMENTS } from "./segments";

test("isAudienceSegment accepts a known segment", () => {
  assert.equal(isAudienceSegment("b2b-decision-makers"), true);
});

test("isAudienceSegment rejects an unknown segment", () => {
  assert.equal(isAudienceSegment("crypto-whales"), false);
});

test("AUDIENCE_SEGMENTS has no duplicates", () => {
  assert.equal(new Set(AUDIENCE_SEGMENTS).size, AUDIENCE_SEGMENTS.length);
});
```

Run: `pnpm test 2>&1 | grep -E "isAudienceSegment|pass|fail"` → PASS (3 tests).

- [ ] **Step 3: Extend the brief cookie.** In `src/lib/basket.ts`, extend the `PlanBrief` type and `readPlanBrief` defaults with the three target fields:

```ts
export type PlanBrief = {
  budget: string;
  audience: string;
  goal: string;
  brief: string;
  targetGeo: string;
  targetAudience: string;
  targetContext: string;
};
```

In `readPlanBrief`, add to the returned object: `targetGeo: String(parsed.targetGeo ?? ""), targetAudience: String(parsed.targetAudience ?? ""), targetContext: String(parsed.targetContext ?? ""),`. `planBriefHasContent` may stay as-is (the new fields are optional refinements).

- [ ] **Step 4: Form selectors.** In `src/app/[locale]/plan/page.tsx`, in the RFQ `<form action={submitRequest}>`, after the existing free-text `audience` field, add three structured controls writing `targetGeo` / `targetAudience` / `targetContext` (comma-joined values). Use the existing markup idiom (`field` wrapper + label). For audience segments, render checkboxes from `AUDIENCE_SEGMENTS` with localized labels via a `targetSegment` namespace; for geo, a market multi-select + a free region text input (regions are many; keep it a text input seeded from a datalist of the distinct regions if convenient, else a plain input); for context, a category text/multiselect. Hidden inputs collect the comma-joined values. Keep it lightweight — these post as plain strings.

```tsx
<div className="field">
  <label>{tr("targetAudienceLabel")}</label>
  <div className="checkbox-grid">
    {AUDIENCE_SEGMENTS.map((s) => (
      <label key={s} className="checkbox">
        <input type="checkbox" name="targetAudience" value={s} />
        {tSeg(s)}
      </label>
    ))}
  </div>
</div>
<div className="field">
  <label htmlFor="targetGeo">{tr("targetGeoLabel")}</label>
  <input id="targetGeo" name="targetGeo" defaultValue={briefDraft.targetGeo}
         placeholder={tr("targetGeoPlaceholder")} />
</div>
<div className="field">
  <label htmlFor="targetContext">{tr("targetContextLabel")}</label>
  <input id="targetContext" name="targetContext" defaultValue={briefDraft.targetContext}
         placeholder={tr("targetContextPlaceholder")} />
</div>
```

Import `AUDIENCE_SEGMENTS` from `@/lib/targeting/segments` and add `const tSeg = await getTranslations({ locale, namespace: "targetSegment" });` (`tr` is the existing rfq namespace instance).

- [ ] **Step 5: Persist in `submitRequest`.** In `src/app/actions.ts` `submitRequest`:
  (a) read the fields after the existing `audience`/`goal`/`brief` reads. `targetAudience` is a checkbox group → use `formData.getAll`:

```ts
  const targetGeo = str(formData, "targetGeo");
  const targetContext = str(formData, "targetContext");
  const targetAudience = formData.getAll("targetAudience")
    .map((v) => String(v)).filter(isAudienceSegment).join(",");
```

  (Import `isAudienceSegment` from `@/lib/targeting/segments`.)
  (b) add all three to the `briefDraft` object (so the cookie round-trips), and to `serializePlanBrief` input.
  (c) persist on the Plan create `data`:

```ts
      targetGeo: targetGeo || null,
      targetAudience: targetAudience || null,
      targetContext: targetContext || null,
```

  (d) fold them into the desk-facing `briefSummary` so the desk sees structured intent. Build it from the parts instead of `brief || null`:

```ts
  const targetingLines = [
    targetGeo && `Geo: ${targetGeo}`,
    targetAudience && `Audience: ${targetAudience}`,
    targetContext && `Context: ${targetContext}`,
  ].filter(Boolean);
  const briefSummary = [brief, ...targetingLines].filter(Boolean).join("\n") || null;
```

- [ ] **Step 6: i18n.** Add to the `rfq` namespace (all six locales): `targetAudienceLabel`, `targetGeoLabel`, `targetGeoPlaceholder`, `targetContextLabel`, `targetContextPlaceholder`. Add a new `targetSegment` namespace with a label for each of the 13 segment keys. English:

```json
  "targetSegment": {
    "general-consumer": "General consumers",
    "regional-local": "Regional / local audiences",
    "affluent": "Affluent / luxury",
    "families-parents": "Families & parents",
    "seniors-50plus": "Seniors (50+)",
    "b2b-decision-makers": "B2B decision-makers",
    "healthcare-pros": "Healthcare professionals",
    "legal-finance-pros": "Legal & finance professionals",
    "tech-it-pros": "Tech & IT professionals",
    "construction-property-pros": "Construction & property pros",
    "farming-rural": "Farming & rural",
    "lifestyle-hobby": "Lifestyle & hobby",
    "culture-media": "Culture & media"
  },
```

rfq labels (en): `targetAudienceLabel`="Audience segments (optional)", `targetGeoLabel`="Geographic focus (optional)", `targetGeoPlaceholder`="e.g. NO, SE — or Vestlandet, Oslo", `targetContextLabel`="Editorial context (optional)", `targetContextPlaceholder`="e.g. business, lifestyle, sport". Translate all into no/sv/da/fi/de.

- [ ] **Step 7: Verify.**

Run: `pnpm test` → all pass (incl. new segments tests).
Run: `pnpm typecheck` → no new errors.
Run: `pnpm build` → "Compiled successfully".

- [ ] **Step 8: Commit.**

```bash
git add src/lib/targeting/segments.ts src/lib/targeting/segments.test.ts src/lib/basket.ts "src/app/[locale]/plan/page.tsx" src/app/actions.ts src/messages
git commit -m "feat(targeting): structured campaign targeting brief on Plan (six locales)"
```

---

## Task 6: Marketing targeting section + claim fix

**Files:**
- Modify: `src/app/[locale]/(marketing)/for-advertisers/page.tsx`
- Modify: `src/messages/{en,no,sv,da,fi,de}.json` (`advertisers` namespace + `formats.native-display.bestFor`)

- [ ] **Step 1: Fix the false retargeting claim (all six locales).** Replace `formats["native-display"].bestFor` in each `src/messages/{locale}.json` with a retargeting-free version:
  - en: "Reach and awareness against a curated audience"
  - no: "Rekkevidde og kjennskap mot et kuratert publikum"
  - sv: "Räckvidd och kännedom mot en kurerad publik"
  - da: "Rækkevidde og kendskab mod et kurateret publikum"
  - fi: "Tavoittavuus ja tunnettuus kuratoidulle yleisölle"
  - de: "Reichweite und Awareness vor einer kuratierten Zielgruppe"

  (Leave the `landing.vs.bestFitDisplay` / `vs.json` strings unchanged — they describe display, the competitor, accurately.)

- [ ] **Step 2: English targeting copy.** Add a `targeting` block to the `advertisers` namespace in `src/messages/en.json`:

```json
    "targetingEyebrow": "Targeting",
    "targetingTitle": "Reach the right readers by where, what, and who.",
    "targetingLead": "Targeting on NativeSpin means choosing the right titles — not chasing people around the web.",
    "targetingContextTitle": "Contextual",
    "targetingContextBody": "Pick titles by category, vertical, and editorial topic, so your story runs where it belongs.",
    "targetingGeoTitle": "Geographic",
    "targetingGeoBody": "Filter by market, region, city, and reach tier — national brand build or a single city.",
    "targetingAudienceTitle": "Audience segment",
    "targetingAudienceBody": "Each title carries a defined editorial audience — from regional consumers to B2B decision-makers.",
    "targetingHonestyTitle": "What we don't do",
    "targetingHonestyBody": "No behavioural retargeting, no interest graphs, no user-level data. The relevance comes from the title, not from tracking the reader."
```

- [ ] **Step 2b: Render it.** In `for-advertisers/page.tsx`, add a section (after the formats section, before the CTA) rendering the targeting block — a section head + a 3-card grid (contextual/geo/audience) + a short "what we don't do" prose line. Mirror the existing `section` + `grid` + `card` markup already used on the page.

- [ ] **Step 3: Translate the `advertisers` targeting keys into no/sv/da/fi/de** — natural native copy, keeping the honest "what we don't do" line firm in each language.

- [ ] **Step 4: Verify.**

Run: `pnpm typecheck` → clean.
Run: `pnpm build` → "Compiled successfully".

Parity check:

```bash
node -e '
const fs=require("fs"); const L=["en","no","sv","da","fi","de"];
const need=["targetingTitle","targetingContextBody","targetingGeoBody","targetingAudienceBody","targetingHonestyBody"];
for(const l of L){ const a=JSON.parse(fs.readFileSync(`src/messages/${l}.json`,"utf8")).advertisers;
  for(const k of need) if(!a[k]) console.log("MISSING",l,k);
  const bf=JSON.parse(fs.readFileSync(`src/messages/${l}.json`,"utf8")).formats["native-display"].bestFor;
  if(/retarget/i.test(bf)) console.log("RETARGETING STILL PRESENT",l);
}
console.log("targeting marketing parity done");
'
```

Expected: only "targeting marketing parity done".

- [ ] **Step 5: Commit.**

```bash
git add "src/app/[locale]/(marketing)/for-advertisers/page.tsx" src/messages
git commit -m "feat(targeting): honest targeting section on /for-advertisers + drop false retargeting claim"
```

---

## Task 7: Full verification

- [ ] **Step 1: Typecheck.** Run: `pnpm typecheck` → no errors except pre-existing untracked `content-fee.it.test.ts`.
- [ ] **Step 2: Lint.** Run: `pnpm lint` → ✔ no warnings or errors.
- [ ] **Step 3: Tests.** Run: `pnpm test` → 0 failures (incl. geo + segments tests).
- [ ] **Step 4: Build.** Run: `pnpm build` → "Compiled successfully".
- [ ] **Step 5: Manual smoke (dev server on a NON-3000 port, e.g. `pnpm next dev -p 4010`).**
  1. `/en/catalog` — the reach-tier filter and region filter both appear and narrow results; selecting a region returns only titles with that region.
  2. `/en/plan` (signed in with a basket) — the targeting brief shows audience-segment checkboxes + geo/context inputs; submitting persists them (check the created Plan row / desk briefSummary contains the Geo/Audience/Context lines).
  3. `/en/for-advertisers` — the targeting section renders the three dimensions + the "what we don't do" line; native-display format card no longer says "retargeting".
  4. Spot-check `/no/for-advertisers` and `/de/catalog` for translated copy (no key-paths).
- [ ] **Step 6: Final commit (only if smoke fixes needed).**

```bash
git add -A && git commit -m "chore(targeting): verification fixes"
```

---

## Self-Review notes

- **Spec coverage:** reach-tier filter (T1) ✓; geo schema + parseGeo (T2) ✓; confident-only backfill + per-market coverage report (T3) ✓; catalog region filter + city-in-search (T4) ✓; Plan target* fields + structured brief selectors + desk summary + segments taxonomy (T5) ✓; honest targeting marketing + the single retargeting claim fix, leaving competitor `bestFitDisplay` untouched (T6) ✓; six-locale i18n + parity (T1/T4/T5/T6) ✓; node:test for parseGeo + segments (T2/T5) ✓.
- **Honesty boundary:** every surface is contextual/geo/audience-segment; the "what we don't do" line + the retargeting fix make the no-user-data boundary explicit. No user-level targeting introduced anywhere.
- **Risk isolation:** the region backfill (T3) is the only data-quality-risky step and is fully separable — empty/partial tables just yield null regions; the catalog still works.
- **Convention match:** migrate via db execute + resolve (migrate dev blocked); each Edit task re-reads exact lines first (terminal output is unreliable); pure logic unit-tested, UI/data guarded by tsc + build + parity.
