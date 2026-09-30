import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { resolveCatalogSearch, searchTitleIds } from "./catalog-search";

// Index side (the generated "searchTsv", migration
// 20260924120000_fts_split_separators) and query side (buildTsQuery) must
// tokenize the same way — a unit test of either half alone can't catch them
// drifting apart, which is how slash names and domains silently went
// unsearchable in prod. Gated like the other DB suites: RUN_DB_IT=1 (CI).
const RUN_DB_IT = process.env.RUN_DB_IT === "1";
const PREFIX = "fts-it-";

const TITLES = [
  { key: "slash", name: "Bärgslagsbladet", aliases: ["Bärgslagsbladet/Arboga Tidning"], url: "https://www.bblat.se" },
  { key: "oe", name: "Österreich/oe24", aliases: [], url: "https://www.oe24.at" },
  { key: "vg", name: "Verdens Gang (VG)", aliases: [], url: "https://www.vg.no/" },
  { key: "ton", name: "t-online.de/auto", aliases: [], url: "https://www.t-online.de/auto" },
  { key: "bb", name: "Bo Bedre (DK)", aliases: ["Bobedre.dk"], url: "https://www.bobedre.dk" },
  { key: "merged", name: "StrategicRISK", aliases: ["Strategic Risk"], url: "https://www.strategic-risk-global.com" },
  { key: "installer", name: "Installatøren", aliases: [], url: "https://www.fts-it-installer.example" },
  { key: "semi", name: "Semitrailer Nytt", aliases: [], url: "https://www.fts-it-semi.example" },
  // Unique made-up words so the assertions don't depend on the rest of the DB.
  { key: "zq", name: "Zqøyvik Budstikke", aliases: ["Qwxasker og Qwxbærums Budstikke"], url: "https://www.fts-it-zq.example" },
  { key: "zq2", name: "Qwxasker Posten", aliases: [], url: "https://www.fts-it-zq2.example" },
] as const;

const ids: Record<string, string> = {};

before(async () => {
  if (!RUN_DB_IT) return;
  const publisher = await prisma.publisher.findFirstOrThrow({ select: { id: true } });
  const market = await prisma.market.findFirstOrThrow({ select: { id: true, code: true } });
  for (const t of TITLES) {
    const row = await prisma.title.create({
      data: {
        id: `${PREFIX}${t.key}`,
        slug: `${PREFIX}${t.key}`,
        name: t.name,
        aliases: [...t.aliases],
        websiteUrl: t.url,
        category: "news",
        countryCode: market.code,
        marketId: market.id,
        publisherId: publisher.id,
      },
    });
    ids[t.key] = row.id;
  }
});

after(async () => {
  if (!RUN_DB_IT) return;
  await prisma.title.deleteMany({ where: { id: { startsWith: PREFIX } } });
});

async function finds(query: string, key: string): Promise<boolean> {
  const hits = (await searchTitleIds(query)) ?? [];
  return hits.includes(ids[key]);
}

test("FTS: every part of a slash-joined name or alias is searchable", { skip: !RUN_DB_IT }, async () => {
  assert.ok(await finds("Arboga Tidning", "slash"));
  assert.ok(await finds("Bärgslagsbladet", "slash"));
  assert.ok(await finds("oe24", "oe"));
  assert.ok(await finds("Österreich", "oe"));
});

test("FTS: a typed domain or pasted URL finds the title by its website", { skip: !RUN_DB_IT }, async () => {
  assert.ok(await finds("vg.no", "vg"));
  assert.ok(await finds("https://www.vg.no/nyheter", "vg"));
  assert.ok(await finds("t-online.de", "ton"));
  assert.ok(await finds("Bobedre.dk", "bb"));
});

test("FTS: a bare country code does not match every site in that country", { skip: !RUN_DB_IT }, async () => {
  // The host is indexed whole, never split — "no" must not reach VG through
  // its website vg.no (its name "Verdens Gang (VG)" has no "no…" word).
  assert.equal(await finds("no", "vg"), false);
});

test("FTS: both names of a merged title find the survivor", { skip: !RUN_DB_IT }, async () => {
  assert.ok(await finds("StrategicRISK", "merged"));
  assert.ok(await finds("Strategic Risk", "merged"));
  assert.ok(await finds("Verdens Gang", "vg"));
});

test("FTS: trade vocabulary reaches titles named with a synonym", { skip: !RUN_DB_IT }, async () => {
  // A buyer searching the everyday word must find the trade title.
  assert.ok(await finds("elektriker", "installer"));
  assert.ok(await finds("elektro", "installer"));
  // "semitrailer" sits past the per-word synonym cap in the transport group;
  // the searched word itself must still be queried.
  assert.ok(await finds("semitrailer", "semi"));
});

async function resolves(query: string, key: string): Promise<{ found: boolean; match: string | undefined }> {
  const search = await resolveCatalogSearch(query);
  const hits = search
    ? await prisma.title.findMany({ where: { AND: [search.where, { id: { startsWith: PREFIX } }] }, select: { id: true } })
    : [];
  return { found: hits.some((h) => h.id === ids[key]), match: search?.match };
}

test("search: a multi-word query matches EVERY word (filler words aside), not any", { skip: !RUN_DB_IT }, async () => {
  // Before: "og" alone matched (OR per word), flooding the results.
  const both = await resolves("Qwxasker og Qwxbærum", "zq");
  assert.deepEqual(both, { found: true, match: "all" });
  // A title with only one of the words is not an all-words match.
  assert.equal((await resolves("Qwxasker og Qwxbærum", "zq2")).found, false);
});

test("search: widens to ANY word only when nothing matches them all, and says so", { skip: !RUN_DB_IT }, async () => {
  const widened = await resolves("Qwxasker Nonexistentword", "zq2");
  assert.deepEqual(widened, { found: true, match: "some" });
});

test("search: a publisher's name finds its titles (the index has no publisher column)", { skip: !RUN_DB_IT }, async () => {
  const pub = await prisma.title.findUniqueOrThrow({ where: { id: ids.zq }, select: { publisher: { select: { name: true } } } });
  const hits = await resolveCatalogSearch(pub.publisher.name);
  const found = await prisma.title.findMany({ where: { AND: [hits!.where, { id: ids.zq }] }, select: { id: true } });
  assert.equal(found.length, 1);
});

test("search: ASCII spellings find æ/ø/å names", { skip: !RUN_DB_IT }, async () => {
  assert.ok((await resolves("zqoyvik", "zq")).found, "ø typed as o");
  assert.ok((await resolves("qwxbaerums", "zq")).found, "æ typed as ae");
  assert.ok((await resolves("Zqøyvik", "zq")).found, "as written");
});

test("search: a publisher name matches on word prefixes, never inside another name", { skip: !RUN_DB_IT }, async () => {
  // "Amedia" listed 31 Otavamedia titles: the publisher match was a substring.
  const market = await prisma.market.findFirstOrThrow({ select: { id: true, code: true } });
  const mk = async (key: string, publisherName: string) => {
    const pub = await prisma.publisher.create({
      data: { id: `${PREFIX}pub-${key}`, name: publisherName, countryCode: market.code, marketId: market.id },
    });
    await prisma.title.create({
      data: {
        id: `${PREFIX}${key}`,
        slug: `${PREFIX}${key}`,
        name: `Pubtest ${key}`,
        websiteUrl: `https://www.${PREFIX}${key}.example`,
        category: "news",
        countryCode: market.code,
        marketId: market.id,
        publisherId: pub.id,
      },
    });
    ids[key] = `${PREFIX}${key}`;
  };
  try {
    await mk("pubexact", "Qwxmedia Lokal");
    await mk("pubinside", "Otaqwxmedia");
    await mk("pubhyphen", "Aller-Qwxmedia");
    assert.ok((await resolves("Qwxmedia", "pubexact")).found, "name starts with the word");
    assert.ok((await resolves("qwxmed", "pubexact")).found, "a prefix of the word");
    assert.ok((await resolves("Qwxmedia", "pubhyphen")).found, "a word after a hyphen");
    assert.equal((await resolves("Qwxmedia", "pubinside")).found, false, "not inside another word");
  } finally {
    await prisma.title.deleteMany({ where: { id: { in: ["pubexact", "pubinside", "pubhyphen"].map((k) => `${PREFIX}${k}`) } } });
    await prisma.publisher.deleteMany({ where: { id: { startsWith: `${PREFIX}pub-` } } });
  }
});
