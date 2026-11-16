import { test } from "node:test";
import assert from "node:assert/strict";
import { TtlCache, aiScope, budgetVerdict } from "./ai-usage";
import { aiDailyBudgets, aiModel } from "./ai-config";

test("aiScope prefers the organisation, then the user, then anon", () => {
  assert.equal(aiScope({ organizationId: "o1", userId: "u1" }), "org:o1");
  assert.equal(aiScope({ userId: "u1" }), "user:u1");
  assert.equal(aiScope(null), "anon");
});

test("budgetVerdict: global cap first, then the caller's own", () => {
  const budgets = { perScope: 10, global: 100 };
  assert.equal(budgetVerdict({ scope: 0, global: 0 }, budgets), "ok");
  assert.equal(budgetVerdict({ scope: 9, global: 99 }, budgets), "ok");
  assert.equal(budgetVerdict({ scope: 10, global: 50 }, budgets), "budget_scope");
  assert.equal(budgetVerdict({ scope: 0, global: 100 }, budgets), "budget_global");
  // A budget of 0 switches the AI paths off.
  assert.equal(budgetVerdict({ scope: 0, global: 0 }, { perScope: 0, global: 100 }), "budget_scope");
});

test("models and budgets come from the environment, with the current defaults", () => {
  assert.equal(aiModel("brief-match", {}), "claude-sonnet-4-6");
  assert.equal(aiModel("brief-rerank", {}), "claude-haiku-4-5");
  assert.equal(aiModel("preview", { AI_MODEL_PREVIEW: " claude-sonnet-5 " }), "claude-sonnet-5");
  assert.deepEqual(aiDailyBudgets({}), { global: 3000, perScope: 300 });
  assert.deepEqual(aiDailyBudgets({ AI_DAILY_BUDGET_GLOBAL: "5", AI_DAILY_BUDGET_PER_ORG: "nope" }), {
    global: 5,
    perScope: 300,
  });
});

test("TtlCache expires entries and evicts the oldest when full", () => {
  const cache = new TtlCache<number>(1000, 2);
  cache.set("a", 1, 0);
  cache.set("b", 2, 0);
  assert.equal(cache.get("a", 500), 1);
  assert.equal(cache.get("a", 1000), undefined, "expired");
  cache.set("c", 3, 0);
  cache.set("d", 4, 0);
  assert.equal(cache.size, 2);
  assert.equal(cache.get("b", 1), undefined, "evicted");
  assert.equal(cache.get("d", 1), 4);
});
