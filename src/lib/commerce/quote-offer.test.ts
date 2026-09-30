import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkOffer,
  offerToken,
  parseOfferTokens,
  quoteFingerprint,
  type OfferQuote,
} from "./quote-offer";

function quote(overrides: Partial<OfferQuote> = {}): OfferQuote {
  return {
    id: "q1",
    revision: 1,
    currency: "NOK",
    subtotal: 74340,
    vatPct: 25,
    total: 92926,
    status: "SENT",
    previousQuoteId: null,
    order: null,
    lines: [
      { id: "l1", kind: "INVENTORY", productId: "p1", quantity: 1, lineTotal: 36600, priceOnRequest: false },
      { id: "l2", kind: "CONTENT_FEE", productId: null, quantity: 1, lineTotal: 12000, priceOnRequest: false },
    ],
    ...overrides,
  };
}

const tokens = (...qs: OfferQuote[]) => parseOfferTokens(qs.map(offerToken));

test("the fingerprint ignores line order and Decimal/number representation", () => {
  const a = quote();
  const b = quote({ lines: [...a.lines].reverse(), subtotal: "74340.00", total: "92926" });
  assert.equal(quoteFingerprint(a), quoteFingerprint(b));
});

test("the fingerprint changes with anything the buyer agrees to", () => {
  const base = quoteFingerprint(quote());
  assert.notEqual(quoteFingerprint(quote({ total: 89676 })), base);
  assert.notEqual(quoteFingerprint(quote({ revision: 2 })), base);
  assert.notEqual(quoteFingerprint(quote({ currency: "SEK" })), base);
  const [l1, l2] = quote().lines;
  assert.notEqual(quoteFingerprint(quote({ lines: [{ ...l1, quantity: 2 }, l2] })), base);
  assert.notEqual(quoteFingerprint(quote({ lines: [{ ...l1, lineTotal: 34000 }, l2] })), base);
  assert.notEqual(quoteFingerprint(quote({ lines: [{ ...l1, priceOnRequest: true }, l2] })), base);
  assert.notEqual(quoteFingerprint(quote({ lines: [l1] })), base);
});

test("parseOfferTokens drops malformed entries", () => {
  const good = offerToken(quote());
  assert.deepEqual(
    parseOfferTokens([good, "q1", "q1:nothex", `bad id!:${"a".repeat(32)}`, 42, null]).map((t) => t.quoteId),
    ["q1"],
  );
});

test("the offer the page showed, unchanged, is accepted", () => {
  const q = quote();
  assert.deepEqual(checkOffer(tokens(q), [q]), { ok: true, quoteIds: ["q1"] });
});

// BUG-final-local-1: a page still showing revision 1 (92 926 kr) accepted
// revision 2 (89 676 kr), which the desk sent while it was open.
test("a stale accept of a replaced quote is refused and names the revision to review", () => {
  const rev1 = quote();
  const rev2 = quote({ id: "q2", revision: 2, previousQuoteId: "q1", total: 89676, lines: [] });
  const now = [{ ...rev1, status: "SUPERSEDED" as const }, { ...rev2, lines: [{ ...rev1.lines[0], id: "l3", lineTotal: 34000 }] }];
  assert.deepEqual(checkOffer(tokens(rev1), now), { ok: false, reason: "replaced", revision: 2 });
});

test("the revision named is the latest one the buyer can see, never a draft", () => {
  const rev1 = quote({ status: "SUPERSEDED" });
  const rev2 = quote({ id: "q2", revision: 2, previousQuoteId: "q1", status: "SUPERSEDED" });
  const rev3 = quote({ id: "q3", revision: 3, previousQuoteId: "q2" });
  const rev4 = quote({ id: "q4", revision: 4, previousQuoteId: "q3", status: "DRAFT" });
  assert.deepEqual(checkOffer(tokens(quote()), [rev1, rev2, rev3, rev4]), {
    ok: false,
    reason: "replaced",
    revision: 3,
  });
});

test("a changed fingerprint, a missing token or an unseen new quote is refused", () => {
  const q = quote();
  const stale = parseOfferTokens([`q1:${"0".repeat(32)}`]);
  assert.deepEqual(checkOffer(stale, [q]), { ok: false, reason: "changed" });
  assert.deepEqual(checkOffer([], [q]), { ok: false, reason: "changed" });
  // A second market's quote arrived after the page loaded: accepting is
  // all-or-nothing, and the buyer never saw it.
  const se = quote({ id: "qse", currency: "SEK" });
  assert.deepEqual(checkOffer(tokens(q), [q, se]), { ok: false, reason: "changed" });
  // …but accepting that one quote by itself is fine.
  assert.deepEqual(checkOffer(tokens(q), [q, se], "one"), { ok: true, quoteIds: ["q1"] });
});

test("an already accepted offer is a double submit, not a refusal", () => {
  const q = quote({ status: "ACCEPTED", order: { id: "o1" } });
  assert.deepEqual(checkOffer(tokens(quote()), [q]), { ok: false, reason: "accepted" });
});

test("a quote with nothing priced is not on offer", () => {
  const [l1] = quote().lines;
  const q = quote({ lines: [{ ...l1, priceOnRequest: true }] });
  assert.deepEqual(checkOffer(tokens(q), [q]), { ok: false, reason: "changed" });
});
