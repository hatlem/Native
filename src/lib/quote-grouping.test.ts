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
  vat: number,
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
          vatRatePct: vat,
        },
      },
    },
  ];
}

test("splits a basket across multiple markets", () => {
  const products = new Map([
    product("p-no", "NO", "NOK", 25),
    product("p-se", "SE", "SEK", 25),
    product("p-de", "DE", "EUR", 19),
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
  assert.equal(de.vatPct, 19);
  assert.equal(de.items.length, 1);
});

test("keeps a single-market basket as one group", () => {
  const products = new Map([
    product("p1", "NO", "NOK", 25),
    product("p2", "NO", "NOK", 25),
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

test("two EUR markets (DE 19%, FI 25%) stay separate", () => {
  // Eurozone trap: grouping by currency would merge these and apply
  // one VAT to both. We group by market so each retains its own rate.
  const products = new Map([
    product("p-de", "DE", "EUR", 19),
    product("p-fi", "FI", "EUR", 25),
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
  assert.equal(de.vatPct, 19);
  assert.equal(fi.vatPct, 25);
});

test("drops items whose product isn't in the map", () => {
  const products = new Map([product("p1", "NO", "NOK", 25)]);
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

test("coerces vatRatePct from Decimal-like values", () => {
  const products = new Map([
    [
      "p1",
      {
        id: "p1",
        title: {
          marketId: "m-no",
          market: { code: "NO", currency: "NOK", vatRatePct: "25.00" },
        },
      } as QuoteGroupingProduct,
    ],
  ]);
  const [g] = groupItemsByMarket(
    [{ productId: "p1", quantity: 1 }],
    products,
  );
  assert.equal(g.vatPct, 25);
});

test("preserves arbitrary line metadata on items", () => {
  const products = new Map([product("p1", "NO", "NOK", 25)]);
  const groups = groupItemsByMarket(
    [{ productId: "p1", quantity: 2, note: "rush" }],
    products,
  );
  assert.equal(groups[0].items[0].note, "rush");
});
