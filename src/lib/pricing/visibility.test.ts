import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogInstantBadge, isProductPriceShown } from "./visibility";

const visibleTitle = { pricesPublic: true, publisher: { pricesPublic: true } };
const hiddenTitle = { pricesPublic: false, publisher: { pricesPublic: true } };

test("isProductPriceShown requires active product", () => {
  assert.equal(
    isProductPriceShown({ active: false, confirmedAt: new Date() }, visibleTitle),
    false,
  );
});

test("isProductPriceShown requires confirmedAt non-null", () => {
  assert.equal(
    isProductPriceShown({ active: true, confirmedAt: null }, visibleTitle),
    false,
  );
});

test("isProductPriceShown requires title visibility", () => {
  assert.equal(
    isProductPriceShown({ active: true, confirmedAt: new Date() }, hiddenTitle),
    false,
  );
});

test("isProductPriceShown returns true when all three gates pass", () => {
  assert.equal(
    isProductPriceShown({ active: true, confirmedAt: new Date() }, visibleTitle),
    true,
  );
});

// BUG-final-local-14 / final-prod-4: the row badge follows the added product.
test("catalogInstantBadge: describes the product 'Add to plan' adds", () => {
  const shown = { active: true, confirmedAt: new Date() };
  const article = { ...shown, id: "article", visibility: "INDICATIVE" };
  const display = { ...shown, id: "display", visibility: "FIRM" };
  const unconfirmedFirm = { active: true, confirmedAt: null, id: "draft", visibility: "FIRM" };
  const title = {};

  assert.equal(catalogInstantBadge(display, [article, display], title), "addable");
  assert.equal(catalogInstantBadge(article, [article, display], title), "someFormats");
  assert.equal(catalogInstantBadge(article, [article], title), null);
  // FIRM alone isn't instant: the price must also be shown.
  assert.equal(catalogInstantBadge(unconfirmedFirm, [unconfirmedFirm], title), null);
  assert.equal(
    catalogInstantBadge(display, [display], { pricesPublic: false }),
    null,
    "a hidden-price title is never instant",
  );
});
