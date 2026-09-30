import { test } from "node:test";
import assert from "node:assert/strict";
import { articleFee, contentFeeLinesFor, resolveProductionFee } from "./production-fee";
import type { ContentFeeRuleSpec } from "../money";

const RULES: ContentFeeRuleSpec[] = [
  {
    marketCode: "NO",
    productType: "NATIVE_ARTICLE",
    currency: "NOK",
    greenfieldFee: 2000,
    adaptationFee: null,
    active: true,
  },
  {
    marketCode: "NO",
    productType: null,
    currency: "NOK",
    greenfieldFee: 1000,
    adaptationFee: null,
    active: true,
  },
];

test("product-level fee wins over everything", () => {
  const fee = resolveProductionFee({
    productFee: 3500,
    titleFee: 2500,
    productType: "NATIVE_ARTICLE",
    marketCode: "NO",
    rules: RULES,
  });
  assert.equal(fee, 3500);
});

test("explicit 0 at product level short-circuits (publisher includes production)", () => {
  const fee = resolveProductionFee({
    productFee: 0,
    titleFee: 2500,
    productType: "NATIVE_ARTICLE",
    marketCode: "NO",
    rules: RULES,
  });
  assert.equal(fee, 0);
});

test("title-level default used when product fee unset", () => {
  const fee = resolveProductionFee({
    productFee: null,
    titleFee: 2500,
    productType: "NATIVE_ARTICLE",
    marketCode: "NO",
    rules: RULES,
  });
  assert.equal(fee, 2500);
});

test("explicit 0 at title level short-circuits", () => {
  const fee = resolveProductionFee({
    productFee: null,
    titleFee: 0,
    productType: "NATIVE_ARTICLE",
    marketCode: "NO",
    rules: RULES,
  });
  assert.equal(fee, 0);
});

test("falls through to most-specific ContentFeeRule", () => {
  const fee = resolveProductionFee({
    productFee: null,
    titleFee: null,
    productType: "NATIVE_ARTICLE",
    marketCode: "NO",
    rules: RULES,
  });
  assert.equal(fee, 2000); // the NATIVE_ARTICLE+NO rule, not the NO wildcard
});

test("wildcard rule used for other product types", () => {
  const fee = resolveProductionFee({
    productFee: null,
    titleFee: null,
    productType: "NATIVE_DISPLAY",
    marketCode: "NO",
    rules: RULES,
  });
  assert.equal(fee, 1000);
});

test("no matching rule → 0 (band still renders)", () => {
  const fee = resolveProductionFee({
    productFee: null,
    titleFee: null,
    productType: "NATIVE_ARTICLE",
    marketCode: "DE",
    rules: RULES,
  });
  assert.equal(fee, 0);
});

// The fee follows the LINE's authorship, never the product: a line we write
// is billed on a placement the publisher's studio could have written too (the
// buyer chose us), and a line the publisher or the buyer writes never is.
test("contentFeeLinesFor bills exactly the lines NativeSpin writes", () => {
  const byId = new Map([
    ["studio", { name: "Studio article", type: "NATIVE_ARTICLE", inclusions: { production: "PUBLISHER" } }],
    ["ours", { name: "Our article", type: "NATIVE_ARTICLE", inclusions: null }],
  ]);
  const feeFor = (items: Parameters<typeof contentFeeLinesFor>[0]) =>
    contentFeeLinesFor(items, byId, "NO", RULES).map((l) => [l.description, l.lineTotal]);

  // We write both: both billed, the publisher-capable one included.
  assert.deepEqual(
    feeFor([
      { productId: "studio", withContent: true, authorshipMode: "NATIVESPIN_PRODUCED" },
      { productId: "ours", withContent: true, authorshipMode: "NATIVESPIN_PRODUCED" },
    ]),
    [
      ["Content production — Studio article", 2000],
      ["Content production — Our article", 2000],
    ],
  );
  // "Let the publisher write it" / the buyer's own copy: nothing of ours.
  assert.deepEqual(
    feeFor([
      { productId: "studio", withContent: false, authorshipMode: "PUBLISHER_PRODUCED" },
      { productId: "ours", withContent: false, authorshipMode: "BUYER_SUPPLIED" },
    ]),
    [],
  );
  assert.equal(articleFee(byId.get("studio")!, "NO", RULES), 2000);
  assert.equal(articleFee(byId.get("ours")!, "NO", RULES), 2000);
  // An explicit 0 on the offer is still a fee of 0 (Byggmesteren's advertorial).
  assert.equal(
    articleFee({ type: "NATIVE_ARTICLE", inclusions: { production: "PUBLISHER" }, productionFee: 0 }, "NO", RULES),
    0,
  );
});
