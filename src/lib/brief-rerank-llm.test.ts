import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeRerankOutput, rerankAvailable } from "./brief-rerank-llm";

const ids = new Set(["a", "b", "c"]);

test("sanitizeRerankOutput drops titleIds not in the valid set", () => {
  const out = sanitizeRerankOutput(
    { ranked: [{ titleId: "a", reason: "Covers B2B logistics buyers." }, { titleId: "unknown", reason: "nope" }] },
    ids,
  );
  assert.equal(out.size, 1);
  assert.equal(out.get("a"), "Covers B2B logistics buyers.");
  assert.equal(out.has("unknown"), false);
});

test("sanitizeRerankOutput caps reason length", () => {
  const long = "x".repeat(300);
  const out = sanitizeRerankOutput({ ranked: [{ titleId: "a", reason: long }] }, ids);
  assert.ok(out.get("a")!.length <= 140);
});

test("sanitizeRerankOutput preserves deterministic order for omitted ids (they're simply absent)", () => {
  const out = sanitizeRerankOutput({ ranked: [{ titleId: "b", reason: "Only b was addressed." }] }, ids);
  assert.equal(out.size, 1);
  assert.ok(out.has("b"));
  assert.equal(out.has("a"), false);
  assert.equal(out.has("c"), false);
});

test("sanitizeRerankOutput is defensive against malformed/missing shapes (fail-open)", () => {
  assert.equal(sanitizeRerankOutput(null, ids).size, 0);
  assert.equal(sanitizeRerankOutput(undefined, ids).size, 0);
  assert.equal(sanitizeRerankOutput("nope", ids).size, 0);
  assert.equal(sanitizeRerankOutput({}, ids).size, 0);
  assert.equal(sanitizeRerankOutput({ ranked: "not an array" }, ids).size, 0);
  assert.equal(sanitizeRerankOutput({ ranked: [{ titleId: 123, reason: "x" }] }, ids).size, 0);
  assert.equal(sanitizeRerankOutput({ ranked: [{ titleId: "a", reason: null }] }, ids).size, 0);
  assert.equal(sanitizeRerankOutput({ ranked: [{ titleId: "a", reason: "   " }] }, ids).size, 0);
});

test("sanitizeRerankOutput: first occurrence wins on duplicate titleIds", () => {
  const out = sanitizeRerankOutput(
    { ranked: [{ titleId: "a", reason: "first" }, { titleId: "a", reason: "second" }] },
    ids,
  );
  assert.equal(out.get("a"), "first");
});

test("rerankAvailable reflects the gateway key", () => {
  assert.equal(rerankAvailable({}), false);
  assert.equal(rerankAvailable({ ANTHROPIC_API_KEY: "sk-x" }), false);
  assert.equal(rerankAvailable({ GETPLATFORM_AI_KEY: "k" }), true);
  assert.equal(rerankAvailable({ GETPLATFORM_API_KEY: "k" }), true);
});
