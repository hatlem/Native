import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DESK_OWNED_FIELDS,
  NEW_PRODUCT_DEFAULTS,
  deskOwnedFieldChanges,
  ingestionSlug,
  parseIngestPayload,
  type IngestProduct,
} from "./ingest";

const validProduct = {
  externalRef: "sku-1",
  type: "NATIVE_ARTICLE",
  name: "Sponsored feature",
  basePrice: 25000,
  currency: "NOK",
  title: {
    externalRef: "title-9",
    name: "Aftenposten",
    marketCode: "NO",
    category: "general-news",
  },
};

test("parseIngestPayload accepts a minimal valid payload", () => {
  const r = parseIngestPayload({ products: [validProduct] });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.products[0].externalRef, "sku-1");
    assert.equal(r.data.products[0].title.marketCode, "NO");
  }
});

test("parseIngestPayload accepts spec and availability", () => {
  const r = parseIngestPayload({
    products: [
      {
        ...validProduct,
        spec: { wordCountMin: 500, wordCountMax: 900, disclosureLabel: "Annonsørinnhold" },
        availability: [{ year: 2026, month: 7, blocked: true }],
      },
    ],
  });
  assert.equal(r.ok, true);
});

test("parseIngestPayload rejects an unknown market", () => {
  const r = parseIngestPayload({
    products: [{ ...validProduct, title: { ...validProduct.title, marketCode: "US" } }],
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.path.includes("marketCode")));
});

test("parseIngestPayload rejects negative price and bad currency", () => {
  const r = parseIngestPayload({
    products: [{ ...validProduct, basePrice: -1, currency: "KRONER" }],
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.path.includes("basePrice")));
    assert.ok(r.errors.some((e) => e.path.includes("currency")));
  }
});

test("parseIngestPayload rejects unknown fields (strict)", () => {
  const r = parseIngestPayload({
    products: [{ ...validProduct, sneaky: true }],
  });
  assert.equal(r.ok, false);
});

test("parseIngestPayload enforces the batch bounds (1..100)", () => {
  assert.equal(parseIngestPayload({ products: [] }).ok, false);
  assert.equal(
    parseIngestPayload({ products: Array.from({ length: 100 }, () => validProduct) }).ok,
    true,
  );
  assert.equal(
    parseIngestPayload({ products: Array.from({ length: 101 }, () => validProduct) }).ok,
    false,
  );
});

test("parseIngestPayload caps availability rows at 24", () => {
  const av = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ year: 2026, month: (i % 12) + 1, blocked: false }));
  assert.equal(parseIngestPayload({ products: [{ ...validProduct, availability: av(24) }] }).ok, true);
  assert.equal(parseIngestPayload({ products: [{ ...validProduct, availability: av(25) }] }).ok, false);
});

test("parseIngestPayload rejects a non-object body", () => {
  assert.equal(parseIngestPayload(null).ok, false);
  assert.equal(parseIngestPayload("nope").ok, false);
  assert.equal(parseIngestPayload({}).ok, false);
});

test("ingestionSlug is url-safe, stable, and publisher-scoped", () => {
  const s = ingestionSlug("pub_abc123", "Title #9 / Weekend!");
  assert.match(s, /^[a-z0-9-]+$/);
  assert.ok(s.startsWith("pub-abc123-"));
  // deterministic
  assert.equal(s, ingestionSlug("pub_abc123", "Title #9 / Weekend!"));
});

// ─── Desk-owned fields (the portal rule) ─────────────────────────────────────

const product = (over: Partial<IngestProduct> = {}): IngestProduct => {
  const r = parseIngestPayload({ products: [{ ...validProduct, ...over }] });
  assert.ok(r.ok);
  return r.data.products[0];
};
const stored = { basePrice: 25000, visibility: "INDICATIVE" as const, bookable: true };

test("deskOwnedFieldChanges: an existing product may repeat its stored values", () => {
  assert.deepEqual(deskOwnedFieldChanges(product(), stored, 0), []);
  assert.deepEqual(
    deskOwnedFieldChanges(product({ visibility: "INDICATIVE", bookable: true }), stored, 0),
    [],
    "a GET response sent back unchanged is a no-op, not an error",
  );
  // Fields a publisher owns change freely.
  assert.deepEqual(deskOwnedFieldChanges(product({ leadTimeDays: 21, name: "Renamed" }), stored, 0), []);
});

test("deskOwnedFieldChanges: changing price, visibility or bookable is refused, naming each field", () => {
  const refusals = deskOwnedFieldChanges(
    product({ basePrice: 30000, visibility: "FIRM", bookable: false }),
    stored,
    3,
  );
  assert.deepEqual(
    refusals.map((r) => [r.path, r.field]),
    [
      ["products.3.basePrice", "basePrice"],
      ["products.3.visibility", "visibility"],
      ["products.3.bookable", "bookable"],
    ],
  );
  for (const r of refusals) assert.match(r.message, new RegExp(`^${r.field} is managed by the NativeSpin desk`));
  assert.match(refusals[0].message, /Rates page of the publisher portal/);
});

test("deskOwnedFieldChanges: a new product sets its opening price but only default status", () => {
  assert.deepEqual(deskOwnedFieldChanges(product({ basePrice: 99000 }), null, 0), []);
  assert.deepEqual(
    deskOwnedFieldChanges(product({ visibility: NEW_PRODUCT_DEFAULTS.visibility, bookable: true }), null, 0),
    [],
  );
  assert.deepEqual(
    deskOwnedFieldChanges(product({ visibility: "FIRM" }), null, 0).map((r) => r.field),
    ["visibility"],
    "a publisher can't create its own inventory instantly orderable",
  );
  assert.deepEqual(deskOwnedFieldChanges(product({ bookable: false }), null, 0).map((r) => r.field), ["bookable"]);
});

test("DESK_OWNED_FIELDS lists exactly the fields the portal leaves to the desk", () => {
  assert.deepEqual([...DESK_OWNED_FIELDS].sort(), ["basePrice", "bookable", "visibility"]);
});
