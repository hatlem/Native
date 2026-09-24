import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { searchTitleIds } from "./catalog-search";

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
