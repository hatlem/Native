import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePreviewArticle, generationAvailable } from "./generate";

test("generationAvailable reflects the gateway key", () => {
  assert.equal(generationAvailable({}), false);
  assert.equal(generationAvailable({ ANTHROPIC_API_KEY: "sk-x" }), false);
  assert.equal(generationAvailable({ GETPLATFORM_AI_KEY: "k" }), true);
  assert.equal(generationAvailable({ GETPLATFORM_API_KEY: "k" }), true);
});

test("parsePreviewArticle parses a well-formed article", () => {
  const text = JSON.stringify({
    headline: "H", standfirst: "S", byline: "B", body: ["p1", "p2", "p3", "p4"],
  });
  const a = parsePreviewArticle(text);
  assert.ok(a);
  assert.equal(a!.headline, "H");
  assert.equal(a!.body.length, 4);
});

test("parsePreviewArticle rejects malformed / missing fields", () => {
  assert.equal(parsePreviewArticle("not json"), null);
  assert.equal(parsePreviewArticle(JSON.stringify({ headline: "H" })), null); // missing fields
  assert.equal(parsePreviewArticle(JSON.stringify({ headline: "H", standfirst: "S", byline: "B", body: [] })), null); // empty body
});
