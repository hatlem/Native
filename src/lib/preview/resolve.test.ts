import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePreview } from "./resolve";
import type { Article, PreviewInput } from "./schema";

const input: PreviewInput = { brand: "Acme", product: "x", market: "NO", tone: "warm" };
const aiArticle: Article = { headline: "AI", standfirst: "s", byline: "b", body: ["p"] };

test("no key → template (no_key), claude never called", async () => {
  let called = false;
  const r = await resolvePreview({ input, hasKey: false, rateOk: true, runClaude: async () => { called = true; return aiArticle; } });
  assert.equal(r.source, "template");
  assert.equal(r.reason, "no_key");
  assert.equal(called, false);
});

test("rate exceeded → template (rate_limited), claude never called", async () => {
  let called = false;
  const r = await resolvePreview({ input, hasKey: true, rateOk: false, runClaude: async () => { called = true; return aiArticle; } });
  assert.equal(r.source, "template");
  assert.equal(r.reason, "rate_limited");
  assert.equal(called, false);
});

test("key + ok + claude returns → ai", async () => {
  const r = await resolvePreview({ input, hasKey: true, rateOk: true, runClaude: async () => aiArticle });
  assert.equal(r.source, "ai");
  assert.equal(r.article.headline, "AI");
});

test("key + ok + claude null → template (ai_error)", async () => {
  const r = await resolvePreview({ input, hasKey: true, rateOk: true, runClaude: async () => null });
  assert.equal(r.source, "template");
  assert.equal(r.reason, "ai_error");
});
