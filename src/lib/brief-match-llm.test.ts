import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeLlmFacets,
  extractJson,
  llmEnrichmentAvailable,
} from "./brief-match-llm";

test("extractJson pulls JSON out of fenced / prose-wrapped output", () => {
  assert.deepEqual(extractJson('```json\n{"audienceType":"B2B"}\n```'), { audienceType: "B2B" });
  assert.deepEqual(extractJson('Here you go: {"keywords":["x"]} done'), { keywords: ["x"] });
  assert.equal(extractJson("no json here"), null);
  assert.equal(extractJson("{broken"), null);
});

test("sanitizeLlmFacets keeps only valid enum values", () => {
  const out = sanitizeLlmFacets({
    audienceType: "B2B",
    industries: ["finance", "TECH", "nonsense", "legal"],
    geoScopes: ["national", "galactic", "Local"],
    locations: ["Oslo", "Bergen"],
    keywords: ["startup", "scaleup", "a", "b", "c", "d", "e", "f", "g"],
  });
  assert.equal(out.audienceType, "B2B");
  assert.deepEqual(out.industries, ["finance", "tech", "legal"]); // nonsense dropped, cased-normalised
  assert.deepEqual(out.geoScopes, ["National", "Local"]); // galactic dropped
  assert.deepEqual(out.locations, ["oslo", "bergen"]);
  assert.equal(out.keywords?.length, 6); // capped
});

test("sanitizeLlmFacets is defensive against junk", () => {
  const out = sanitizeLlmFacets({ audienceType: "maybe", industries: "finance", geoScopes: null });
  assert.equal(out.audienceType, null);
  assert.deepEqual(out.industries, []);
  assert.deepEqual(out.geoScopes, []);
});

test("llmEnrichmentAvailable reflects the API key", () => {
  assert.equal(llmEnrichmentAvailable({}), false);
  assert.equal(llmEnrichmentAvailable({ ANTHROPIC_API_KEY: "sk-x" }), true);
});
