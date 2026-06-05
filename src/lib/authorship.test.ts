import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AUTHORSHIP_MODE,
  authorshipFromWithContent,
  withContentFromAuthorship,
  nativeSpinProduces,
  writerAssignableForMode,
  writerStaffableLine,
  authorshipForOrderLine,
  type AuthorshipMode,
} from "./authorship";

test("the default mode is buyer-supplied (the historical withContent=false meaning)", () => {
  assert.equal(DEFAULT_AUTHORSHIP_MODE, "BUYER_SUPPLIED");
});

test("withContent maps 1:1 onto the first two modes", () => {
  assert.equal(authorshipFromWithContent(true), "NATIVESPIN_PRODUCED");
  assert.equal(authorshipFromWithContent(false), "BUYER_SUPPLIED");
  // Absent toggle (cookie/legacy item) is bring-your-own, never NativeSpin.
  assert.equal(authorshipFromWithContent(undefined), "BUYER_SUPPLIED");
  assert.equal(authorshipFromWithContent(null), "BUYER_SUPPLIED");
});

test("withContent shim is the exact inverse for the two reachable modes", () => {
  assert.equal(withContentFromAuthorship("NATIVESPIN_PRODUCED"), true);
  assert.equal(withContentFromAuthorship("BUYER_SUPPLIED"), false);
  // Publisher-produced is not a NativeSpin content fee either.
  assert.equal(withContentFromAuthorship("PUBLISHER_PRODUCED"), false);
});

test("only NativeSpin-produced placements bill a content fee", () => {
  assert.equal(nativeSpinProduces("NATIVESPIN_PRODUCED"), true);
  assert.equal(nativeSpinProduces("BUYER_SUPPLIED"), false);
  assert.equal(nativeSpinProduces("PUBLISHER_PRODUCED"), false);
});

test("a writer may only be staffed on NativeSpin-produced lines", () => {
  assert.equal(writerAssignableForMode("NATIVESPIN_PRODUCED"), true);
  // Buyer- and publisher-produced articles are written elsewhere — staffing
  // one of our writers on them is a category error, not a workflow.
  assert.equal(writerAssignableForMode("BUYER_SUPPLIED"), false);
  assert.equal(writerAssignableForMode("PUBLISHER_PRODUCED"), false);
});

test("only an INVENTORY placement that NativeSpin produces is staffable", () => {
  // The real placement we write — staffable.
  assert.equal(
    writerStaffableLine({ kind: "INVENTORY", authorshipMode: "NATIVESPIN_PRODUCED" }),
    true,
  );
  // A CONTENT_FEE line is a billing line, not a placement — even though it
  // carries NATIVESPIN_PRODUCED, no writer is staffed against it.
  assert.equal(
    writerStaffableLine({ kind: "CONTENT_FEE", authorshipMode: "NATIVESPIN_PRODUCED" }),
    false,
  );
  // Buyer-/publisher-produced placements are written elsewhere.
  assert.equal(
    writerStaffableLine({ kind: "INVENTORY", authorshipMode: "BUYER_SUPPLIED" }),
    false,
  );
  assert.equal(
    writerStaffableLine({ kind: "INVENTORY", authorshipMode: "PUBLISHER_PRODUCED" }),
    false,
  );
});

test("an inventory order line inherits its product's authorship intent", () => {
  const byProduct = new Map<string, AuthorshipMode>([
    ["p1", "NATIVESPIN_PRODUCED"],
    ["p2", "BUYER_SUPPLIED"],
  ]);
  assert.equal(
    authorshipForOrderLine({ kind: "INVENTORY", productId: "p1" }, byProduct),
    "NATIVESPIN_PRODUCED",
  );
  assert.equal(
    authorshipForOrderLine({ kind: "INVENTORY", productId: "p2" }, byProduct),
    "BUYER_SUPPLIED",
  );
});

test("a content-fee line is always NativeSpin-produced — it exists only because we write", () => {
  // productId is null on CONTENT_FEE lines; the map must not be consulted.
  assert.equal(
    authorshipForOrderLine({ kind: "CONTENT_FEE", productId: null }, new Map()),
    "NATIVESPIN_PRODUCED",
  );
});

test("an inventory line with no known product falls back to the safe default", () => {
  assert.equal(
    authorshipForOrderLine({ kind: "INVENTORY", productId: "unknown" }, new Map()),
    "BUYER_SUPPLIED",
  );
  assert.equal(
    authorshipForOrderLine({ kind: "INVENTORY", productId: null }, new Map()),
    "BUYER_SUPPLIED",
  );
});
