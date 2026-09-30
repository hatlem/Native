import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTranslator, type AbstractIntlMessages } from "next-intl";
import enMessages from "@/messages/en.json";
import noMessages from "@/messages/no.json";
import { articleFeeLabel, articleScope, articleScopeLines, extraWorkDetail, type Translate } from "./article-scope";
import { DEFAULT_EXTRA_WORK_RATES } from "./pricing/extra-work";

const tr = (locale: "en" | "no"): Translate =>
  createTranslator({
    locale,
    messages: (locale === "en" ? enMessages : noMessages) as unknown as AbstractIntlMessages,
    namespace: "articleScope",
  }) as Translate;
// Intl output uses (narrow) no-break spaces; compare on plain ones.
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("article fee label", () => {
  test("'from' the line's own fee, in the buyer's words", () => {
    assert.equal(plain(articleFeeLabel(2000, "NOK", "no", tr("no"))), "Artikkel skrevet av NativeSpin · fra 2 000 kr");
    assert.equal(plain(articleFeeLabel(1500, "NOK", "no", tr("no"))), "Artikkel skrevet av NativeSpin · fra 1 500 kr");
    assert.equal(plain(articleFeeLabel(200, "EUR", "en", tr("en"))), "Article written by NativeSpin · from €200");
  });
});

describe("what the article includes", () => {
  test("without a spec: the typical length, one round, generic marking, the currency's rate", () => {
    const scope = articleScope({ spec: null, inclusions: null, title: { market: { disclosureLabel: null } } }, "NOK", DEFAULT_EXTRA_WORK_RATES);
    assert.deepEqual(scope.words, { min: 600, max: 900, fromSpec: false });
    assert.equal(scope.revisionRounds, 1);
    assert.equal(scope.hourlyRate, 1650);
    assert.deepEqual(articleScopeLines(scope, tr("no"), "no").map(plain), [
      "En gjennomsnittlig native-artikkel (ca. 600–900 ord)",
      "Brief og én revisjonsrunde før godkjenning",
      "Merket etter publikasjonens regler for annonsørinnhold",
      "Intervju, bilder, ekstra revisjonsrunder og annet ekstra arbeid faktureres per time: 1 650 kr/time",
    ]);
  });

  test("with a spec: its word count, the stated rounds and the title's marking", () => {
    const scope = articleScope(
      {
        spec: { wordCountMin: 800, wordCountMax: 1200, disclosureLabel: null },
        inclusions: { production: "PLATFORM", revisionRounds: 2 },
        title: { market: { disclosureLabel: "Annonsørinnhold" } },
      },
      "NOK",
      DEFAULT_EXTRA_WORK_RATES,
    );
    assert.deepEqual(articleScopeLines(scope, tr("no"), "no").map(plain), [
      "En gjennomsnittlig native-artikkel (800–1 200 ord)",
      "Brief og 2 revisjonsrunder før godkjenning",
      "Merket «Annonsørinnhold» etter publikasjonens regler for annonsørinnhold",
      "Intervju, bilder, ekstra revisjonsrunder og annet ekstra arbeid faktureres per time: 1 650 kr/time",
    ]);
  });

  test("a spec with only a minimum; the format's own label beats the market's", () => {
    const scope = articleScope(
      {
        spec: { wordCountMin: 500, wordCountMax: null, disclosureLabel: "Annonse" },
        title: { market: { disclosureLabel: "Annonsørinnhold" } },
      },
      "EUR",
      DEFAULT_EXTRA_WORK_RATES,
    );
    const lines = articleScopeLines(scope, tr("en"), "en").map(plain);
    assert.equal(lines[0], "An average native article (at least 500 words)");
    assert.equal(lines[1], "Your brief plus one revision round before approval");
    assert.equal(lines[2], "Labelled “Annonse”, following the publication's rules for advertiser content");
    assert.equal(lines[3], "Interviews, images, extra revision rounds and other extra work are billed per hour: €140/hour");
  });

  test("an unusable stated round count falls back to one; no rate says 'per hour' without a figure", () => {
    const scope = articleScope({ inclusions: { revisionRounds: 0 } }, "USD", DEFAULT_EXTRA_WORK_RATES);
    assert.equal(scope.revisionRounds, 1);
    assert.equal(scope.hourlyRate, null);
    assert.equal(
      articleScopeLines(scope, tr("en"), "en")[3],
      "Interviews, images, extra revision rounds and other extra work are billed per hour",
    );
  });

  test("an extra-work line's detail: hours in the buyer's number format × rate", () => {
    assert.equal(plain(extraWorkDetail({ hours: 2.5, hourlyRate: 1650 }, "NOK", "no", tr("no"))), "2,5 t × 1 650 kr/t");
    assert.equal(plain(extraWorkDetail({ hours: 1, hourlyRate: 120 }, "GBP", "en", tr("en"))), "1 h × £120/h");
  });
});
