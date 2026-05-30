import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIngestPayload, ingestionSlug } from "./ingest";

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

test("parseIngestPayload rejects an empty or oversized batch", () => {
  assert.equal(parseIngestPayload({ products: [] }).ok, false);
  const big = { products: Array.from({ length: 201 }, () => validProduct) };
  assert.equal(parseIngestPayload(big).ok, false);
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
