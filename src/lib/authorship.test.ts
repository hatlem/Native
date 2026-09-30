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
  contentIntent,
  defaultContentIntent,
  mergeContentIntent,
  publisherProducesContent,
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

// The persisted pair must always satisfy the DB CHECK
// (withContent ⇔ NATIVESPIN_PRODUCED) whatever the row carried before.
test("contentIntent derives a consistent pair from the toggle", () => {
  assert.deepEqual(contentIntent(true), { withContent: true, authorshipMode: "NATIVESPIN_PRODUCED" });
  assert.deepEqual(contentIntent(false), { withContent: false, authorshipMode: "BUYER_SUPPLIED" });
  // Turning it on wins over whatever the row carried.
  assert.deepEqual(contentIntent(true, "PUBLISHER_PRODUCED"), {
    withContent: true,
    authorshipMode: "NATIVESPIN_PRODUCED",
  });
});

test("contentIntent off keeps a carried non-NativeSpin mode, never a stale NativeSpin one", () => {
  assert.equal(contentIntent(false, "PUBLISHER_PRODUCED").authorshipMode, "PUBLISHER_PRODUCED");
  assert.equal(contentIntent(false, "NATIVESPIN_PRODUCED").authorshipMode, "BUYER_SUPPLIED");
  assert.equal(contentIntent(false, null).authorshipMode, "BUYER_SUPPLIED");
});

test("every contentIntent result satisfies withContent ⇔ NATIVESPIN_PRODUCED", () => {
  const modes: (AuthorshipMode | undefined)[] = [undefined, "BUYER_SUPPLIED", "NATIVESPIN_PRODUCED", "PUBLISHER_PRODUCED"];
  for (const on of [true, false]) {
    for (const carried of modes) {
      const r = contentIntent(on, carried);
      assert.equal(r.withContent, r.authorshipMode === "NATIVESPIN_PRODUCED", `${on}/${carried}`);
    }
  }
});

test("mergeContentIntent keeps a content request from either side", () => {
  const off = contentIntent(false);
  const on = contentIntent(true);
  assert.deepEqual(mergeContentIntent(off, on), on);
  assert.deepEqual(mergeContentIntent(on, off), on);
  assert.deepEqual(mergeContentIntent(off, off), off);
  assert.equal(
    mergeContentIntent(contentIntent(false, "PUBLISHER_PRODUCED"), off).authorshipMode,
    "PUBLISHER_PRODUCED",
  );
});

// A catalog/title-page/compare/recommender add starts with "We write it" on:
// the band the buyer saw includes the article.
test("defaultContentIntent: a new line is NativeSpin-written by default", () => {
  assert.deepEqual(defaultContentIntent({ inclusions: null, productionFee: null, title: null }), {
    withContent: true,
    authorshipMode: "NATIVESPIN_PRODUCED",
  });
  // A title placeholder (no product yet) takes the same default.
  assert.deepEqual(defaultContentIntent(null), { withContent: true, authorshipMode: "NATIVESPIN_PRODUCED" });
});

test("defaultContentIntent: where the publisher writes it, content doesn't apply", () => {
  const publisher = { withContent: false, authorshipMode: "PUBLISHER_PRODUCED" };
  assert.deepEqual(defaultContentIntent({ inclusions: { production: "PUBLISHER" } }), publisher);
  // Schema: an explicit 0 production fee = "publisher includes production".
  assert.deepEqual(defaultContentIntent({ productionFee: 0 }), publisher);
  assert.deepEqual(defaultContentIntent({ productionFee: null, title: { productionFeeDefault: 0 } }), publisher);
});

test("publisherProducesContent: an offer-level fee overrides the publication default", () => {
  assert.equal(publisherProducesContent({ productionFee: 5000, title: { productionFeeDefault: 0 } }), false);
  assert.equal(publisherProducesContent({ productionFee: null, title: { productionFeeDefault: 3000 } }), false);
  assert.equal(publisherProducesContent({ inclusions: { production: "ADVERTISER" } }), false);
});

test("every default intent satisfies withContent ⇔ NATIVESPIN_PRODUCED", () => {
  for (const src of [null, {}, { productionFee: 0 }, { inclusions: { production: "PUBLISHER" } }]) {
    const r = defaultContentIntent(src);
    assert.equal(r.withContent, r.authorshipMode === "NATIVESPIN_PRODUCED");
  }
});
