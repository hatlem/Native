import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STYLES } from "../../app/landing-styles";

const LOCALES = ["en", "no", "sv", "da", "de", "fi"] as const;
const read = (loc: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "src/messages/landing", loc, "studio.json"), "utf8"));

const REQUIRED = [
  "eyebrow", "h1", "lead", "brandLabel", "brandPlaceholder", "marketLabel",
  "toneLabel", "toneWarm", "toneInvestigative", "toneAspirational", "tonePlain",
  "productLabel", "productPlaceholder", "imageLabel", "uploadLabel", "generate",
  "generating", "badgeAi", "badgeTemplate", "editHint", "mastheadName", "navNews",
  "navBusiness", "navCulture", "ctaHeading", "ctaDesk", "ctaAccess", "errorGenerate",
  "fallbackHeadline", "fallbackStandfirst", "fallbackByline", "fallbackBody1", "fallbackBody2",
];

test("en studio.json has every required key", () => {
  const en = read("en");
  for (const k of REQUIRED) {
    assert.ok(k in en, `missing key: ${k}`);
    assert.equal(typeof en[k], "string");
  }
});

test("all locales share en's key set", () => {
  const enKeys = Object.keys(read("en")).sort();
  for (const loc of LOCALES) {
    assert.deepEqual(Object.keys(read(loc)).sort(), enKeys, `locale ${loc} mismatch`);
  }
});

test("STYLES contains the studio selectors", () => {
  for (const sel of [".bn .preview-studio", ".bn .pv-controls", ".bn .pv-gen", ".bn .na-body", ".bn .pv-badge"]) {
    assert.ok(STYLES.includes(sel), `STYLES missing: ${sel}`);
  }
});
