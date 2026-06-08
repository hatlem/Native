import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LOCALES = ["en", "no", "sv", "da", "de", "fi"] as const;

function readPreview(locale: string): Record<string, unknown> {
  const p = join(process.cwd(), "src/messages/landing", locale, "preview.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

test("en preview.json has every required key", () => {
  const en = readPreview("en");
  const required = [
    "mastheadName", "heroTag", "heroNav1", "heroNav2", "heroNav3",
    "heroHeadline", "heroStandfirst", "heroByline",
    "vsNativeLabel", "vsDisplayLabel", "vsNativeHeadline", "vsDisplayName",
    "vsDisplayHeadline", "vsAdLeaderboard", "vsAdBox", "vsAdInContent",
    "vsAdTag", "vsPopupTitle", "vsPopupCta", "vsCaption",
    "ruleExcerptTag", "ruleExcerptCap", "ruleExcerptBody",
    "briefTitle", "briefObjLabel", "briefObjValue", "briefMarketsLabel",
    "briefMarketsValue", "briefBudgetLabel", "briefBudgetValue",
    "briefDatesLabel", "briefDatesValue",
    "quoteTitle", "quoteBadge", "quoteR1Title", "quoteR1Meta", "quoteR1Price",
    "quoteR2Title", "quoteR2Meta", "quoteR2Price", "quoteR3Title", "quoteR3Meta",
    "quoteR3Price", "quoteTotalLabel", "quoteTotalValue",
  ];
  for (const k of required) {
    assert.ok(k in en, `missing key: ${k}`);
    assert.equal(typeof en[k], "string", `key not string: ${k}`);
  }
});

test("all locales have the same key set as en (stubs present)", () => {
  const enKeys = Object.keys(readPreview("en")).sort();
  for (const loc of LOCALES) {
    const keys = Object.keys(readPreview(loc)).sort();
    assert.deepEqual(keys, enKeys, `locale ${loc} key mismatch`);
  }
});
