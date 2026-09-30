import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasVerticalTranslation,
  localizeCategory,
  localizeTaxonomy,
  localizeVertical,
} from "./taxonomy-i18n";

describe("localizeCategory", () => {
  it("translates a canonical category per locale", () => {
    assert.equal(localizeCategory("Health", "no"), "Helse");
    assert.equal(localizeCategory("Health", "sv"), "Hälsa");
    assert.equal(localizeCategory("Health", "da"), "Sundhed");
    assert.equal(localizeCategory("Health", "de"), "Gesundheit");
    assert.equal(localizeCategory("Health", "fi"), "Terveys");
  });

  it("matches case-insensitively and trims whitespace", () => {
    assert.equal(localizeCategory("  trade union ", "no"), "Fagforening");
    assert.equal(localizeCategory("WOMEN'S LIFESTYLE", "de"), "Frauen & Lifestyle");
  });

  it("returns the input untouched for en", () => {
    assert.equal(localizeCategory("Health", "en"), "Health");
    assert.equal(localizeCategory("Local history", "en"), "Local history");
  });

  it("falls through to the raw value for unknown categories", () => {
    assert.equal(localizeCategory("Lokalavis/Oslo", "no"), "Lokalavis/Oslo");
    assert.equal(localizeCategory("Bygg/VVS", "fi"), "Bygg/VVS");
  });

  it("covers the multi-word canonical values the migration produces", () => {
    assert.equal(localizeCategory("Current affairs", "fi"), "Ajankohtaista");
    assert.equal(localizeCategory("Home & interior", "sv"), "Hem och inredning");
    assert.equal(localizeCategory("Student newspaper", "de"), "Studentenzeitung");
    assert.equal(localizeCategory("National tabloid", "no"), "Riksdekkende tabloid");
  });
});

describe("localizeVertical (extended map)", () => {
  it("translates vertical values", () => {
    assert.equal(localizeVertical("News (Regional)", "fi"), "Uutiset (alueellinen)");
    assert.equal(localizeVertical("B2B – Healthcare", "no"), "B2B – helse");
    assert.equal(
      localizeVertical("Politics & Current Affairs", "da"),
      "Politik og samfund",
    );
  });

  it("translates audience values", () => {
    assert.equal(localizeVertical("General consumer", "sv"), "Bred publik");
    assert.equal(localizeVertical("Farmers", "de"), "Landwirte");
    assert.equal(localizeVertical("Children (3-12)", "fi"), "Lapset (3-12)");
  });

  it("falls through unknown values and passes en through", () => {
    assert.equal(localizeVertical("Niche publisher term", "no"), "Niche publisher term");
    assert.equal(localizeVertical("General consumer", "en"), "General consumer");
  });
});

describe("localizeTaxonomy (regression)", () => {
  it("still translates chip values", () => {
    assert.equal(localizeTaxonomy("Weekly", "no"), "Ukentlig");
    assert.equal(localizeTaxonomy("Magazine", "fi"), "Aikakauslehti");
  });
});

// Every Title.vertical the catalog shows (research taxonomy, as of 2026-09-30).
// The "Who reads it?" filter, the plan's targeting picker and the title page
// label these; none may fall back to English in a Nordic/German UI.
const VERTICALS = [
  "Adult",
  "Affluent Lifestyle",
  "Antiques & Collecting",
  "Arts & Culture",
  "Auto & Motor",
  "B2B – Agriculture",
  "B2B – Beauty Trade",
  "B2B – Charity & Third Sector",
  "B2B – Construction & Property",
  "B2B – Defense & Police",
  "B2B – Education",
  "B2B – Energy & Utilities",
  "B2B – Engineering",
  "B2B – Finance & Insurance",
  "B2B – Healthcare",
  "B2B – Hospitality",
  "B2B – HR & Management",
  "B2B – IT & Tech",
  "B2B – Journalism",
  "B2B – Legal",
  "B2B – Maritime",
  "B2B – Marketing & Media",
  "B2B – Music Industry",
  "B2B – Other Trade Press",
  "B2B – Public Sector",
  "B2B – Publishing",
  "B2B – Retail",
  "B2B – SME",
  "B2B – Trade Union",
  "B2B – Transport & Logistics",
  "B2B – Travel Trade",
  "Boating & Sailing",
  "Business & Finance",
  "Camping & Caravan",
  "Celebrity & Gossip",
  "Children – Comics & TV",
  "Children & Kids",
  "Community Press",
  "Craft & DIY",
  "Education – Student Press",
  "Family & Parenting",
  "Fashion",
  "Film",
  "Food & Drink",
  "Gaming",
  "Garden",
  "General Consumer Magazine",
  "Health & Fitness",
  "History",
  "Hobby & Leisure",
  "Home & Interior",
  "Hunting & Fishing",
  "LGBTQ+",
  "Literature & Books",
  "Membership/Customer Magazine",
  "Men's Lifestyle",
  "Motorcycle",
  "Music",
  "News (General)",
  "News (Higher Education)",
  "News (Local)",
  "News (National Mid-market)",
  "News (National Quality)",
  "News (National Tabloid)",
  "News (National)",
  "News (Regional)",
  "Outdoor & Adventure",
  "Pets",
  "Photography",
  "Politics & Current Affairs",
  "Real-life Weeklies",
  "Religion",
  "Science",
  "Seniors 55+",
  "Sports",
  "Sports – Cycling",
  "Sports – Equestrian",
  "Sports – Football/Hockey",
  "Sports – Golf",
  "Sports – Running",
  "Tech & Gadgets",
  "Travel",
  "TV & Listings",
  "Women's Lifestyle",
  "Youth & Teens",
];

describe("localizeVertical covers the whole vertical taxonomy", () => {
  it("translates every vertical into every UI language", () => {
    const missing = VERTICALS.filter((v) => !hasVerticalTranslation(v));
    assert.deepEqual(missing, []);
  });

  it("uses natural labels for the trade verticals buyers filter on", () => {
    assert.equal(localizeVertical("B2B – Transport & Logistics", "no"), "B2B – transport og logistikk");
    assert.equal(localizeVertical("B2B – Legal", "sv"), "B2B – juridik");
    assert.equal(localizeVertical("News (National)", "no"), "Nyheter (riksdekkende)");
  });
});
