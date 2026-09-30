import { test } from "node:test";
import assert from "node:assert/strict";
import { computeContentFeeLines } from "@/lib/money";
import {
  contentFeeDescription,
  feePlacementDescription,
  feePlacementLine,
  isPlacementLine,
  orderFeePlacements,
  placementCount,
} from "./placements";

test("placementCount counts inventory lines, never the content fees billed with them", () => {
  // Two placements, each with our article fee: 2 placements, not 4.
  const lines = [
    { kind: "INVENTORY" as const },
    { kind: "INVENTORY" as const },
    { kind: "CONTENT_FEE" as const },
    { kind: "CONTENT_FEE" as const },
  ];
  assert.equal(placementCount(lines), 2);
  // One instant placement with its fee: 1.
  assert.equal(placementCount([{ kind: "INVENTORY" }, { kind: "CONTENT_FEE" }]), 1);
  assert.equal(placementCount([]), 0);
});

test("a line without a kind predates content fees and is a placement", () => {
  assert.equal(isPlacementLine({}), true);
  assert.equal(isPlacementLine({ kind: null }), true);
  assert.equal(isPlacementLine({ kind: "CONTENT_FEE" }), false);
});

test("a content fee names its placement, and the fee lines money.ts writes are read back", () => {
  assert.equal(feePlacementDescription(contentFeeDescription("Aftenposten — Native display")), "Aftenposten — Native display");
  assert.equal(feePlacementDescription("Aftenposten — Native display"), null);

  // The writer and the reader are the same convention: a generated fee line
  // points back at the placement it was priced for.
  const [fee] = computeContentFeeLines(
    [{ name: "E24 — Native-artikkel", productType: "NATIVE_ARTICLE", fee: 12000 }],
    [],
    "NO",
  );
  assert.equal(feePlacementDescription(fee.description), "E24 — Native-artikkel");
});

// The quote the buyer accepted: two formats of one title plus a second
// title, each with our article fee after the placements (quote-actions.ts
// generates inventory lines first, then fees).
const quoteLines = [
  { kind: "INVENTORY" as const, position: 0, productId: "ap-article", description: "Aftenposten — Native-artikkel" },
  { kind: "INVENTORY" as const, position: 1, productId: "ap-advertorial", description: "Aftenposten — Advertorial" },
  { kind: "INVENTORY" as const, position: 2, productId: "e24-article", description: "E24 — Native-artikkel" },
  { kind: "CONTENT_FEE" as const, position: 3, productId: null, description: contentFeeDescription("Aftenposten — Native-artikkel") },
  { kind: "CONTENT_FEE" as const, position: 4, productId: null, description: contentFeeDescription("Aftenposten — Advertorial") },
  { kind: "CONTENT_FEE" as const, position: 5, productId: null, description: contentFeeDescription("E24 — Native-artikkel") },
];

test("feePlacementLine finds the placement a fee bills the article for", () => {
  assert.equal(feePlacementLine(quoteLines[4], quoteLines)?.productId, "ap-advertorial");
  assert.equal(feePlacementLine(quoteLines[5], quoteLines)?.productId, "e24-article");
  // A placement has no fee placement; a fee naming no line on the quote has none.
  assert.equal(feePlacementLine(quoteLines[0], quoteLines), undefined);
  assert.equal(
    feePlacementLine({ kind: "CONTENT_FEE", description: contentFeeDescription("VG — Native-artikkel") }, quoteLines),
    undefined,
  );
});

test("orderFeePlacements pairs each order fee with its placement through the quote line's position", () => {
  // The order copies the priced quote lines with their positions; the
  // Advertorial was on request, so neither it nor its fee is on the order.
  const orderLines = [
    { id: "ol-0", kind: "INVENTORY" as const, position: 0 },
    { id: "ol-2", kind: "INVENTORY" as const, position: 2 },
    { id: "ol-3", kind: "CONTENT_FEE" as const, position: 3 },
    { id: "ol-5", kind: "CONTENT_FEE" as const, position: 5 },
  ];
  const pairs = orderFeePlacements(orderLines, quoteLines);
  assert.deepEqual(
    [...pairs].map(([id, q]) => [id, q.productId]),
    [
      ["ol-3", "ap-article"],
      ["ol-5", "e24-article"],
    ],
  );
});

test("orderFeePlacements never guesses on lines written before positions existed", () => {
  // Every line at position 0: which quote line an order fee came from can't
  // be told, so it stays unnamed rather than borrowing another placement's.
  const legacyQuote = quoteLines.map((l) => ({ ...l, position: 0 }));
  const orderLines = [
    { id: "ol-a", kind: "INVENTORY" as const, position: 0 },
    { id: "ol-b", kind: "CONTENT_FEE" as const, position: 0 },
  ];
  assert.equal(orderFeePlacements(orderLines, legacyQuote).size, 0);
  // A position whose quote line is a placement doesn't pair a fee either.
  assert.equal(orderFeePlacements([{ id: "ol-x", kind: "CONTENT_FEE", position: 1 }], quoteLines).size, 0);
});
