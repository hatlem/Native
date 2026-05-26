import {
  PrismaClient,
  MarketCode,
  ProductType,
  PriceVisibility,
  Prisma,
} from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DESK_EMAIL = (
  process.env.DESK_ADMIN_EMAIL || "desk@atnative.com"
).toLowerCase();
const DESK_PASSWORD = process.env.DESK_ADMIN_PASSWORD || "atnative-desk";
const PUB_EMAIL = (
  process.env.PUBLISHER_EMAIL || "publisher@atnative.com"
).toLowerCase();
const PUB_PASSWORD = process.env.PUBLISHER_PASSWORD || "atnative-pub";
const BUYER_EMAIL = (
  process.env.BUYER_EMAIL || "buyer@atnative.com"
).toLowerCase();
const BUYER_PASSWORD = process.env.BUYER_PASSWORD || "atnative-buyer";
const BUYER_ORG = "Demo Advertiser AS";
const AGENCY_EMAIL = (
  process.env.AGENCY_EMAIL || "agency@atnative.com"
).toLowerCase();
const AGENCY_PASSWORD = process.env.AGENCY_PASSWORD || "atnative-agency";
const AGENCY_ORG = "Demo Media Agency";
const SUPERADMIN_EMAIL = (
  process.env.SUPERADMIN_EMAIL || "superadmin@atnative.com"
).toLowerCase();
const SUPERADMIN_PASSWORD =
  process.env.SUPERADMIN_PASSWORD || "atnative-superadmin";

type SeedMarket = {
  code: MarketCode;
  name: string;
  currency: string;
  defaultLocale: string;
  disclosure: string;
};

type SeedMarketSpec = SeedMarket & { vatRatePct: number };

// VAT rates and disclosure labels are common-knowledge defaults
// (Eurostat / national tax authorities); tune in the desk admin once we
// open commerce in each non-Nordic market.
const MARKETS: SeedMarketSpec[] = [
  {
    code: MarketCode.NO,
    name: "Norway",
    currency: "NOK",
    defaultLocale: "no",
    disclosure: "Annonsørinnhold",
    vatRatePct: 25,
  },
  {
    code: MarketCode.SE,
    name: "Sweden",
    currency: "SEK",
    defaultLocale: "sv",
    disclosure: "Annons",
    vatRatePct: 25,
  },
  {
    code: MarketCode.DK,
    name: "Denmark",
    currency: "DKK",
    defaultLocale: "da",
    disclosure: "Annonce / Sponsoreret indhold",
    vatRatePct: 25,
  },
  {
    code: MarketCode.FI,
    name: "Finland",
    currency: "EUR",
    defaultLocale: "en",
    disclosure: "Kaupallinen yhteistyö",
    vatRatePct: 25.5,
  },
  {
    code: MarketCode.DE,
    name: "Germany",
    currency: "EUR",
    defaultLocale: "en",
    disclosure: "Anzeige",
    vatRatePct: 19,
  },
  {
    code: MarketCode.AT,
    name: "Austria",
    currency: "EUR",
    defaultLocale: "en",
    disclosure: "Anzeige",
    vatRatePct: 20,
  },
  {
    code: MarketCode.CH,
    name: "Switzerland",
    currency: "CHF",
    defaultLocale: "en",
    disclosure: "Bezahlte Anzeige",
    vatRatePct: 8.1,
  },
  {
    code: MarketCode.UK,
    name: "United Kingdom",
    currency: "GBP",
    defaultLocale: "en",
    disclosure: "Sponsored",
    vatRatePct: 20,
  },
  {
    code: MarketCode.IE,
    name: "Ireland",
    currency: "EUR",
    defaultLocale: "en",
    disclosure: "Sponsored",
    vatRatePct: 23,
  },
];

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Minimal RFC 4180 CSV parser. Keep inline to avoid a runtime dep.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c === "\r") {
        // ignore
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function nonEmpty(value: string | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function toInt(value: string | undefined): number | null {
  const v = nonEmpty(value);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

function toDecimal(value: string | undefined): number | null {
  const v = nonEmpty(value);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Truthy-ish flags from CSV cells. Accepts "1", "true", "yes", "y",
// "on" (case-insensitive) as true; "0", "false", "no", "n", "off",
// blank as false. Returns null when the cell is missing entirely so
// the caller can fall back to the schema default.
function toFlag(value: string | undefined): boolean | null {
  const v = nonEmpty(value);
  if (v == null) return null;
  const lo = v.toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(lo)) return true;
  if (["0", "false", "no", "n", "off"].includes(lo)) return false;
  return null;
}

// Find the first column whose header matches `name` (case-insensitive,
// trimmed). Returns null when the column isn't present. Used for the
// optional RateCard / RateCardCurrency / PricesPublic columns so the
// existing CSV (which doesn't have them) keeps importing unchanged.
function findColumnIndex(header: string[], name: string): number | null {
  const lower = name.toLowerCase();
  for (let i = 0; i < header.length; i++) {
    if ((header[i] ?? "").trim().toLowerCase() === lower) return i;
  }
  return null;
}

type CsvRow = {
  country: string;
  title: string;
  type: string | null;
  category: string;
  frequency: string | null;
  ownerGroup: string | null;
  publisher: string;
  adSales: string | null;
  locationNote: string | null;
  circulation: number | null;
  vertical: string | null;
  audience: string | null;
  b2bB2c: string | null;
  reach: string | null;
  format: string | null;
  nativeFit: string | null;
  tags: string | null;
  url: string | null;
  urlStatus: string | null;
  // Optional columns added for the buyer-facing pricing levers — these
  // only populate when the CSV actually includes the named columns;
  // existing 20-column exports continue to import unchanged.
  publishedRateCard: number | null;
  publishedRateCurrency: string | null;
  pricesPublic: boolean | null;
};

function readMediaCsv(): CsvRow[] {
  const path = join(process.cwd(), "prisma", "data", "medier_alle.csv");
  const text = readFileSync(path, "utf8");
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headerRow = rows[0] ?? [];
  // Existing 20-column layout is still index-based (columns 1 and 11
  // are both labelled "Country" — a duplicate in the source export,
  // so we can't use the header name for those). The buyer-facing
  // pricing columns are read by NAME so they can be added anywhere
  // in the file (including future columns inserted in the middle)
  // without breaking the import. Missing columns ⇒ field stays null.
  const rateCardIdx = findColumnIndex(headerRow, "RateCard");
  const rateCardCurrencyIdx = findColumnIndex(headerRow, "RateCardCurrency");
  const pricesPublicIdx = findColumnIndex(headerRow, "PricesPublic");

  const out: CsvRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 2) continue;
    const country = (r[0] ?? "").trim();
    const title = (r[1] ?? "").trim();
    const publisher = (r[6] ?? "").trim();
    const category = (r[3] ?? "").trim();
    if (!country || !title || !publisher || !category) continue;
    const rateCard =
      rateCardIdx !== null ? toDecimal(r[rateCardIdx]) : null;
    const rateCardCurrencyRaw =
      rateCardCurrencyIdx !== null ? nonEmpty(r[rateCardCurrencyIdx]) : null;
    out.push({
      country,
      title,
      type: nonEmpty(r[2]),
      category,
      frequency: nonEmpty(r[4]),
      ownerGroup: nonEmpty(r[5]),
      publisher,
      adSales: nonEmpty(r[7]),
      locationNote: nonEmpty(r[8]),
      circulation: toInt(r[9]),
      vertical: nonEmpty(r[11]),
      audience: nonEmpty(r[12]),
      b2bB2c: nonEmpty(r[13]),
      reach: nonEmpty(r[14]),
      format: nonEmpty(r[15]),
      nativeFit: nonEmpty(r[16]),
      tags: nonEmpty(r[17]),
      url: nonEmpty(r[18]),
      urlStatus: nonEmpty(r[19]),
      publishedRateCard: rateCard,
      publishedRateCurrency:
        rateCard != null && rateCardCurrencyRaw
          ? rateCardCurrencyRaw.toUpperCase()
          : null,
      pricesPublic:
        pricesPublicIdx !== null ? toFlag(r[pricesPublicIdx]) : null,
    });
  }
  return out;
}

// Create a Market for every country in the CSV (NO/SE/DK/FI/DE/AT/CH/UK/IE)
// so every Title and Publisher has a non-null Market FK.
async function seedMarkets(): Promise<Map<string, string>> {
  const codeToId = new Map<string, string>();
  for (const m of MARKETS) {
    const market = await prisma.market.create({
      data: {
        code: m.code,
        name: m.name,
        currency: m.currency,
        defaultLocale: m.defaultLocale,
        vatRatePct: m.vatRatePct,
        disclosureLabel: m.disclosure,
      },
    });
    codeToId.set(m.code, market.id);
  }
  return codeToId;
}

// Bulk-imports every CSV row into Publisher + Title. Returns a slug→id
// map so the commerce blueprint below can promote a small curated set
// to active products.
async function seedFromCsv(
  marketIds: Map<string, string>,
): Promise<Map<string, string>> {
  const rows = readMediaCsv();

  // Dedupe publishers up-front. The CSV's "Publisher" column is the
  // legal entity (e.g. "Aftenposten AS"); we get ~1,900 unique
  // (country, publisher) pairs. Bulk-insert with createMany, then look
  // up ids in one query.
  const pubKey = (country: string, name: string) => `${country}|${name}`;
  const publisherSeen = new Map<string, { countryCode: string; name: string }>();
  for (const r of rows) {
    const k = pubKey(r.country, r.publisher);
    if (!publisherSeen.has(k)) {
      publisherSeen.set(k, { countryCode: r.country, name: r.publisher });
    }
  }
  await prisma.publisher.createMany({
    data: Array.from(publisherSeen.values())
      .map((p) => {
        const marketId = marketIds.get(p.countryCode);
        if (!marketId) return null;
        return {
          name: p.name,
          countryCode: p.countryCode,
          marketId,
          paymentTerms: "net 30",
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
    skipDuplicates: true,
  });

  const publisherRows = await prisma.publisher.findMany({
    select: { id: true, countryCode: true, name: true },
  });
  const publisherIdByKey = new Map<string, string>();
  for (const p of publisherRows) {
    publisherIdByKey.set(pubKey(p.countryCode, p.name), p.id);
  }

  // Dedupe titles by slug (a few CSV rows are exact duplicates — 4
  // pairs as of the May 2026 export).
  const titleSeen = new Map<string, CsvRow>();
  for (const r of rows) {
    const slug = slugify(`${r.title}-${r.country}`);
    if (!titleSeen.has(slug)) titleSeen.set(slug, r);
  }

  // createMany is dramatically faster than per-row create (3k vs ~6s)
  // and we never need the returned ids for non-commerce titles.
  const titleData: Prisma.TitleCreateManyInput[] = [];
  for (const [slug, r] of titleSeen) {
    const publisherId = publisherIdByKey.get(pubKey(r.country, r.publisher));
    const marketId = marketIds.get(r.country);
    if (!publisherId || !marketId) continue;
    titleData.push({
      name: r.title,
      slug,
      publisherId,
      countryCode: r.country,
      marketId,
      category: r.category,
      websiteUrl: r.url,
      active: false,
      lastVerifiedAt: null,
      type: r.type,
      frequency: r.frequency,
      ownerGroup: r.ownerGroup,
      publisherName: r.publisher,
      adSales: r.adSales,
      locationNote: r.locationNote,
      circulation: r.circulation,
      vertical: r.vertical,
      audience: r.audience,
      b2bB2c: r.b2bB2c,
      reach: r.reach,
      format: r.format,
      nativeFit: r.nativeFit,
      tags: r.tags,
      urlStatus: r.urlStatus,
      ...(r.publishedRateCard != null
        ? {
            publishedRateCard: r.publishedRateCard,
            publishedRateCurrency: r.publishedRateCurrency,
          }
        : {}),
      ...(r.pricesPublic !== null ? { pricesPublic: r.pricesPublic } : {}),
    });
  }
  await prisma.title.createMany({ data: titleData, skipDuplicates: true });

  const titleRows = await prisma.title.findMany({
    select: { id: true, slug: true },
  });
  const titleIdBySlug = new Map<string, string>();
  for (const t of titleRows) titleIdBySlug.set(t.slug, t.id);
  return titleIdBySlug;
}

type RateCardTier = {
  label: string;
  minVolume: number;
  marginPct: number;
  seasonalMultiplier: number;
};

const PRODUCT_BLUEPRINT: {
  type: ProductType;
  perThousandReach: number;
  leadTimeDays: number;
  visibility: PriceVisibility;
  rateCard: RateCardTier[];
}[] = [
  {
    type: ProductType.NATIVE_ARTICLE,
    perThousandReach: 25,
    leadTimeDays: 12,
    visibility: PriceVisibility.INDICATIVE,
    rateCard: [
      { label: "standard", minVolume: 1, marginPct: 22, seasonalMultiplier: 1 },
      { label: "series", minVolume: 3, marginPct: 18, seasonalMultiplier: 1 },
    ],
  },
  {
    type: ProductType.ADVERTORIAL,
    perThousandReach: 18,
    leadTimeDays: 10,
    visibility: PriceVisibility.INDICATIVE,
    rateCard: [
      { label: "standard", minVolume: 1, marginPct: 18, seasonalMultiplier: 1 },
      { label: "series", minVolume: 3, marginPct: 15, seasonalMultiplier: 1 },
    ],
  },
  {
    type: ProductType.NATIVE_DISPLAY,
    perThousandReach: 12,
    leadTimeDays: 7,
    visibility: PriceVisibility.FIRM,
    rateCard: [
      {
        label: "standard",
        minVolume: 1,
        marginPct: 12,
        seasonalMultiplier: 1.1,
      },
      { label: "bulk", minVolume: 5, marginPct: 9, seasonalMultiplier: 1.1 },
    ],
  },
];

// Curated commerce subset — these are the Phase-0 titles that ship with
// products + price rules + specs. Slugs are computed from the CSV
// titles' (name, country); look them up via the slug map returned by
// `seedFromCsv`. monthlyReach is hand-curated (estimated monthly
// readers; differs from print circulation captured in `Title.circulation`).
type CommerceTitle = {
  slug: string;
  monthlyReach: number;
};

const COMMERCE_TITLES: CommerceTitle[] = [
  // ---------- NO/SE/DK ---------- hand-curated, with monthly-reach
  // estimates that reflect print + digital audience.
  { slug: slugify("Aftenposten-NO"), monthlyReach: 1_200_000 },
  { slug: slugify("Verdens Gang (VG)-NO"), monthlyReach: 2_000_000 },
  { slug: slugify("E24-NO"), monthlyReach: 600_000 },
  { slug: slugify("Nettavisen-NO"), monthlyReach: 900_000 },
  { slug: slugify("Dagens Nyheter-SE"), monthlyReach: 1_500_000 },
  { slug: slugify("Dagens Industri-SE"), monthlyReach: 700_000 },
  { slug: slugify("Aftonbladet-SE"), monthlyReach: 2_500_000 },
  { slug: slugify("Politiken-DK"), monthlyReach: 800_000 },
  { slug: slugify("Morgenavisen Jyllands-Posten-DK"), monthlyReach: 700_000 },
  { slug: slugify("Berlingske-DK"), monthlyReach: 500_000 },
  // ---------- FI/DE/AT/CH/UK/IE ---------- top three by circulation in
  // each market (queried from prisma/data/medier_alle.csv). reach is
  // the CSV circulation; refine once we get publisher rate cards.
  { slug: slugify("Pirkka-FI"), monthlyReach: 2_200_000 },
  { slug: slugify("Yhteishyvä-FI"), monthlyReach: 1_800_000 },
  { slug: slugify("7 päivää-FI"), monthlyReach: 280_000 },
  { slug: slugify("ADAC Motorwelt-DE"), monthlyReach: 11_500_000 },
  { slug: slugify("Apotheken Umschau-DE"), monthlyReach: 9_000_000 },
  { slug: slugify("rtv-DE"), monthlyReach: 5_000_000 },
  { slug: slugify("ÖAMTC AutoTouring-AT"), monthlyReach: 2_100_000 },
  { slug: slugify("Kronen Zeitung-AT"), monthlyReach: 600_000 },
  { slug: slugify("ÖAV Bergauf-AT"), monthlyReach: 600_000 },
  { slug: slugify("Coopzeitung-CH"), monthlyReach: 2_400_000 },
  { slug: slugify("Migros Magazin-CH"), monthlyReach: 1_500_000 },
  { slug: slugify("Touring (TCS)-CH"), monthlyReach: 1_300_000 },
  { slug: slugify("The Economist-UK"), monthlyReach: 1_500_000 },
  { slug: slugify("The Sun-UK"), monthlyReach: 1_200_000 },
  { slug: slugify("The Sun on Sunday-UK"), monthlyReach: 1_100_000 },
  { slug: slugify("Sunday Independent-IE"), monthlyReach: 130_000 },
  { slug: slugify("Sunday World-IE"), monthlyReach: 110_000 },
  { slug: slugify("Irish Farmers Journal-IE"), monthlyReach: 70_000 },
];

async function activateCommerceTitles(
  marketIds: Map<string, string>,
  titleIdBySlug: Map<string, string>,
): Promise<number> {
  let activated = 0;
  for (const c of COMMERCE_TITLES) {
    const titleId = titleIdBySlug.get(c.slug);
    if (!titleId) continue;
    const title = await prisma.title.findUnique({
      where: { id: titleId },
      select: {
        id: true,
        name: true,
        countryCode: true,
        marketId: true,
      },
    });
    if (!title || !title.marketId) continue;
    const market = MARKETS.find((m) => m.code === title.countryCode);
    if (!market) continue;

    await prisma.title.update({
      where: { id: title.id },
      data: {
        active: true,
        monthlyReach: c.monthlyReach,
        lastVerifiedAt: new Date(),
      },
    });

    for (const bp of PRODUCT_BLUEPRINT) {
      const basePrice = Math.round((c.monthlyReach / 1000) * bp.perThousandReach);
      await prisma.product.create({
        data: {
          titleId: title.id,
          type: bp.type,
          name: `${title.name} — ${bp.type}`,
          currency: market.currency,
          basePrice,
          visibility: bp.visibility,
          leadTimeDays: bp.leadTimeDays,
          priceRules: {
            create: bp.rateCard.map((rc) => ({
              label: rc.label,
              minVolume: rc.minVolume,
              marginPct: rc.marginPct,
              seasonalMultiplier: rc.seasonalMultiplier,
            })),
          },
          spec: {
            create: {
              wordCountMin:
                bp.type === ProductType.NATIVE_DISPLAY ? null : 500,
              wordCountMax:
                bp.type === ProductType.NATIVE_DISPLAY ? null : 900,
              imagesMin: 2,
              disclosureLabel: market.disclosure,
              fileFormats: "JPG, PNG",
              requirements:
                "Clearly marked as paid; editorial-quality copy aligned to the title's house style.",
            },
          },
        },
      });
    }
    activated++;
  }
  void marketIds;
  return activated;
}

// Refuse to seed the documented demo passwords against a production
// database — every account here lands with a deterministic password from
// the README, and the SUPERADMIN role grants full tenant access. Allow it
// when the operator has supplied their own value via the *_PASSWORD env
// vars (those values won't equal the literal default), or when they set
// SEED_ALLOW_PRODUCTION=1 to acknowledge they really want demo accounts.
function assertSeedCredentials() {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.SEED_ALLOW_PRODUCTION === "1") return;
  const defaults: Array<[string, string]> = [
    [DESK_PASSWORD, "atnative-desk"],
    [PUB_PASSWORD, "atnative-pub"],
    [BUYER_PASSWORD, "atnative-buyer"],
    [AGENCY_PASSWORD, "atnative-agency"],
    [SUPERADMIN_PASSWORD, "atnative-superadmin"],
  ];
  const stillDefault = defaults
    .filter(([v, def]) => v === def)
    .map(([, def]) => def);
  if (stillDefault.length === 0) return;
  throw new Error(
    `Refusing to seed demo users in production with the documented default passwords: ${stillDefault.join(", ")}. ` +
      `Set DESK_ADMIN_PASSWORD / PUBLISHER_PASSWORD / BUYER_PASSWORD / AGENCY_PASSWORD / SUPERADMIN_PASSWORD before running seed, ` +
      `or set SEED_ALLOW_PRODUCTION=1 to override (not recommended).`,
  );
}

async function main() {
  assertSeedCredentials();
  // Clean catalog tables for an idempotent reseed (no commerce data yet).
  await prisma.availability.deleteMany();
  await prisma.priceRule.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.product.deleteMany();
  await prisma.title.deleteMany();
  await prisma.publisher.deleteMany();
  await prisma.market.deleteMany();

  const marketIds = await seedMarkets();
  const titleIdBySlug = await seedFromCsv(marketIds);
  const activeCount = await activateCommerceTitles(marketIds, titleIdBySlug);

  const passwordHash = await bcrypt.hash(DESK_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: DESK_EMAIL },
    update: { passwordHash, role: "DESK" },
    create: {
      email: DESK_EMAIL,
      name: "Desk Admin",
      role: "DESK",
      passwordHash,
    },
  });

  const superadminHash = await bcrypt.hash(SUPERADMIN_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: SUPERADMIN_EMAIL },
    update: { passwordHash: superadminHash, role: "SUPERADMIN" },
    create: {
      email: SUPERADMIN_EMAIL,
      name: "Super Admin",
      role: "SUPERADMIN",
      passwordHash: superadminHash,
    },
  });

  // Publisher user is linked to whichever Publisher owns the
  // "aftenposten-no" title — that anchors the demo publisher to a real
  // commerce-active title without hard-coding a name.
  const aftenposten = await prisma.title.findUnique({
    where: { slug: slugify("Aftenposten-NO") },
    select: { publisherId: true },
  });
  if (aftenposten) {
    const pubHash = await bcrypt.hash(PUB_PASSWORD, 10);
    await prisma.user.upsert({
      where: { email: PUB_EMAIL },
      update: {
        passwordHash: pubHash,
        role: "PUBLISHER",
        publisherId: aftenposten.publisherId,
      },
      create: {
        email: PUB_EMAIL,
        name: "Publisher Admin",
        role: "PUBLISHER",
        passwordHash: pubHash,
        publisherId: aftenposten.publisherId,
      },
    });
  }

  let buyerOrg = await prisma.organization.findFirst({
    where: { name: BUYER_ORG },
  });
  buyerOrg ??= await prisma.organization.create({
    data: { name: BUYER_ORG, type: "ADVERTISER", marketCode: MarketCode.NO },
  });
  const buyerHash = await bcrypt.hash(BUYER_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: BUYER_EMAIL },
    update: {
      passwordHash: buyerHash,
      role: "BUYER",
      organizationId: buyerOrg.id,
    },
    create: {
      email: BUYER_EMAIL,
      name: "Demo Buyer",
      role: "BUYER",
      passwordHash: buyerHash,
      organizationId: buyerOrg.id,
    },
  });

  // Agency workspace: an AGENCY org managing two advertiser clients.
  let agencyOrg = await prisma.organization.findFirst({
    where: { name: AGENCY_ORG },
  });
  agencyOrg ??= await prisma.organization.create({
    data: { name: AGENCY_ORG, type: "AGENCY", marketCode: MarketCode.NO },
  });
  const agencyHash = await bcrypt.hash(AGENCY_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: AGENCY_EMAIL },
    update: {
      passwordHash: agencyHash,
      role: "ORG_ADMIN",
      organizationId: agencyOrg.id,
    },
    create: {
      email: AGENCY_EMAIL,
      name: "Agency Admin",
      role: "ORG_ADMIN",
      passwordHash: agencyHash,
      organizationId: agencyOrg.id,
    },
  });
  const agencyClients: [string, MarketCode][] = [
    ["Client One AS", MarketCode.NO],
    ["Client Two AB", MarketCode.SE],
  ];
  for (const [cname, mc] of agencyClients) {
    const exists = await prisma.organization.findFirst({
      where: { name: cname, parentOrgId: agencyOrg.id },
    });
    if (!exists) {
      await prisma.organization.create({
        data: {
          name: cname,
          type: "ADVERTISER",
          marketCode: mc,
          parentOrgId: agencyOrg.id,
        },
      });
    }
  }

  const titleCount = await prisma.title.count();
  const publisherCount = await prisma.publisher.count();
  const productCount = await prisma.product.count();
  console.log(
    `Seeded ${MARKETS.length} markets, ${publisherCount} publishers, ${titleCount} titles (${activeCount} active commerce), ${productCount} products, superadmin ${SUPERADMIN_EMAIL}, desk ${DESK_EMAIL}, publisher ${PUB_EMAIL}, buyer ${BUYER_EMAIL}, agency ${AGENCY_EMAIL}.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
