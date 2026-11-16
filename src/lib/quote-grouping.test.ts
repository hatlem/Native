import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupItemsByMarket,
  type QuoteGroupingProduct,
} from "./quote-grouping";

function product(
  id: string,
  marketCode: string,
  currency: string,
): [string, QuoteGroupingProduct] {
  return [
    id,
    {
      id,
      title: {
        marketId: `m-${marketCode}`,
        market: {
          code: marketCode,
          currency,
        },
      },
    },
  ];
}

test("splits a basket across multiple markets", () => {
  const products = new Map([
    product("p-no", "NO", "NOK"),
    product("p-se", "SE", "SEK"),
    product("p-de", "DE", "EUR"),
  ]);
  const groups = groupItemsByMarket(
    [
      { productId: "p-no", quantity: 1 },
      { productId: "p-se", quantity: 2 },
      { productId: "p-de", quantity: 1 },
    ],
    products,
  );
  assert.equal(groups.length, 3);
  assert.deepEqual(
    groups.map((g) => g.marketCode),
    ["DE", "NO", "SE"], // alphabetical
  );
  const de = groups.find((g) => g.marketCode === "DE")!;
  assert.equal(de.currency, "EUR");
  assert.equal(de.items.length, 1);
});

test("keeps a single-market basket as one group", () => {
  const products = new Map([
    product("p1", "NO", "NOK"),
    product("p2", "NO", "NOK"),
  ]);
  const groups = groupItemsByMarket(
    [
      { productId: "p1", quantity: 1 },
      { productId: "p2", quantity: 3 },
    ],
    products,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].marketCode, "NO");
  assert.equal(groups[0].items.length, 2);
});

test("two EUR markets (DE, FI) stay separate", () => {
  // Eurozone trap: grouping by currency would merge two markets that are
  // priced and fulfilled separately. We group by market.
  const products = new Map([
    product("p-de", "DE", "EUR"),
    product("p-fi", "FI", "EUR"),
  ]);
  const groups = groupItemsByMarket(
    [
      { productId: "p-de", quantity: 1 },
      { productId: "p-fi", quantity: 1 },
    ],
    products,
  );
  assert.equal(groups.length, 2);
  const de = groups.find((g) => g.marketCode === "DE")!;
  const fi = groups.find((g) => g.marketCode === "FI")!;
  assert.equal(de.currency, "EUR");
  assert.equal(fi.currency, "EUR");
});

test("drops items whose product isn't in the map", () => {
  const products = new Map([product("p1", "NO", "NOK")]);
  const groups = groupItemsByMarket(
    [
      { productId: "p1", quantity: 1 },
      { productId: "p-missing", quantity: 1 },
    ],
    products,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 1);
});

test("a group carries no VAT rate — VAT follows the buyer, not the market", () => {
  // lib/vat.ts decides VAT from the buyer's country; the placement's market
  // must not leak a rate into the quote.
  const products = new Map([product("p-de", "DE", "EUR")]);
  const [g] = groupItemsByMarket([{ productId: "p-de", quantity: 1 }], products);
  assert.equal("vatPct" in g, false);
});

test("preserves arbitrary line metadata on items", () => {
  const products = new Map([product("p1", "NO", "NOK")]);
  const groups = groupItemsByMarket(
    [{ productId: "p1", quantity: 2, note: "rush" }],
    products,
  );
  assert.equal(groups[0].items[0].note, "rush");
});
