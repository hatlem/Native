import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ProductType } from "@prisma/client";
import {
  DEFAULT_EXTRA_WORK_RATES,
  extraWorkHourlyRate,
  extraWorkLineTotal,
  hourlyRateSchema,
  parseExtraWorkInput,
} from "./extra-work";
import { ARTICLE_FEE_KRONE, ARTICLE_FEE_MAJOR, MARKET_CURRENCIES, defaultContentFeeRules } from "./default-fee-rules";
import { pickContentFeeRule, type ContentFeeRuleSpec } from "../money";
import { resolveProductionFee } from "./production-fee";

describe("extra-work hourly rate by currency", () => {
  test("the agreed default for each billing currency", () => {
    const expected: Record<string, number> = { NOK: 1650, EUR: 140, SEK: 1600, DKK: 1050, GBP: 120, CHF: 130 };
    for (const [currency, rate] of Object.entries(expected)) {
      assert.equal(extraWorkHourlyRate(DEFAULT_EXTRA_WORK_RATES, currency), rate, currency);
    }
    // Every market's currency has a rate.
    for (const currency of Object.values(MARKET_CURRENCIES)) {
      assert.notEqual(extraWorkHourlyRate(DEFAULT_EXTRA_WORK_RATES, currency), null, currency);
    }
  });

  test("matches the code case-insensitively; an unknown or zero rate is no rate", () => {
    assert.equal(extraWorkHourlyRate(DEFAULT_EXTRA_WORK_RATES, " nok "), 1650);
    assert.equal(extraWorkHourlyRate(DEFAULT_EXTRA_WORK_RATES, "USD"), null);
    assert.equal(extraWorkHourlyRate([{ currency: "NOK", hourlyRate: 0 }], "NOK"), null);
  });

  test("hours × rate, in whole currency units", () => {
    assert.equal(extraWorkLineTotal(2, 1650), 3300);
    assert.equal(extraWorkLineTotal(1.5, 1650), 2475);
    assert.equal(extraWorkLineTotal(0.25, 140), 35);
    assert.equal(extraWorkLineTotal(1.25, 1650), 2063); // 2062.5 rounds half up
  });
});

describe("extra-work form input", () => {
  const parse = (hours: string, description = "Tredje revisjonsrunde") =>
    parseExtraWorkInput({ hours, description });

  test("quarter-hours, with either decimal separator", () => {
    assert.deepEqual(parse("1,5"), { ok: true, value: { hours: 1.5, description: "Tredje revisjonsrunde" } });
    assert.deepEqual(parse(" 2.25 "), { ok: true, value: { hours: 2.25, description: "Tredje revisjonsrunde" } });
    assert.deepEqual(parse("200"), { ok: true, value: { hours: 200, description: "Tredje revisjonsrunde" } });
  });

  test("refuses zero, negative, off-grid, oversized and non-numeric hours", () => {
    for (const bad of ["", "0", "-1", "1.3", "0.1", "200.25", "abc", "1,5,0"]) {
      assert.deepEqual(parse(bad), { ok: false }, bad);
    }
  });

  test("needs a description, at most 200 characters", () => {
    assert.deepEqual(parse("1", "   "), { ok: false });
    assert.deepEqual(parse("1", "x".repeat(201)), { ok: false });
    assert.deepEqual(parseExtraWorkInput({ hours: null, description: null }), { ok: false });
  });

  test("a SUPERADMIN-typed rate: positive, capped, cents", () => {
    assert.equal(hourlyRateSchema.parse("1 650"), 1650);
    assert.equal(hourlyRateSchema.parse("140,5"), 140.5);
    assert.equal(hourlyRateSchema.parse("99.999"), 100);
    assert.equal(hourlyRateSchema.safeParse("0").success, false);
    assert.equal(hourlyRateSchema.safeParse("100001").success, false);
    assert.equal(hourlyRateSchema.safeParse("kr").success, false);
  });
});

describe("one article fee per market: print = digital", () => {
  const markets = Object.entries(MARKET_CURRENCIES).map(([code, currency]) => ({ code, currency }));
  const rules: ContentFeeRuleSpec[] = defaultContentFeeRules(markets).map((r) => ({ ...r, active: true }));

  test("no market prices a print advertorial differently from a digital native article", () => {
    for (const { code } of markets) {
      const fee = (type: ProductType) =>
        resolveProductionFee({ productFee: null, titleFee: null, productType: type, marketCode: code, rules });
      assert.equal(fee(ProductType.ADVERTORIAL), fee(ProductType.NATIVE_ARTICLE), code);
      // …nor any other format: the one rule prices them all.
      for (const type of Object.values(ProductType)) {
        assert.equal(fee(type), fee(ProductType.NATIVE_ARTICLE), `${code} ${type}`);
      }
    }
  });

  test("the fee is the real article fee: 2 000 in krone markets, 200 elsewhere", () => {
    for (const { code, currency } of markets) {
      const rule = pickContentFeeRule(rules, ProductType.NATIVE_ARTICLE, code);
      assert.ok(rule, code);
      assert.equal(rule.currency, currency);
      const expected = ["NOK", "SEK", "DKK"].includes(currency) ? ARTICLE_FEE_KRONE : ARTICLE_FEE_MAJOR;
      assert.equal(rule.greenfieldFee, expected.greenfieldFee, code);
      assert.equal(rule.adaptationFee, expected.adaptationFee, code);
    }
  });

  test("an offer's own production fee still beats the unified rule", () => {
    assert.equal(
      resolveProductionFee({ productFee: 1500, titleFee: null, productType: "ADVERTORIAL", marketCode: "NO", rules }),
      1500,
    );
  });
});
