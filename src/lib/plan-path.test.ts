import { test } from "node:test";
import assert from "node:assert/strict";
import { planPath, openPlanPath, toQueryString } from "./plan-path";

test("planPath gives each plan its own address", () => {
  assert.equal(planPath("no", "cmul35gz1000fpj0ep8o8ldmw"), "/no/plan/cmul35gz1000fpj0ep8o8ldmw");
  assert.equal(planPath("no", null), "/no/plan");
});

test("planPath carries the query along (errors, recommendations)", () => {
  assert.equal(planPath("en", "abc", { error: "unavailable" }), "/en/plan/abc?error=unavailable");
  assert.equal(planPath("en", "abc", { recBrief: "a b&c" }), "/en/plan/abc?recBrief=a+b%26c");
});

test("toQueryString keeps repeated keys, drops undefined and omitted ones", () => {
  assert.equal(toQueryString({ a: ["1", "2"], b: undefined, c: "x" }, ["c"]), "?a=1&a=2");
  assert.equal(toQueryString({}), "");
  assert.equal(toQueryString(undefined), "");
});

test("openPlanPath routes through /plan/open with the list id", () => {
  assert.equal(openPlanPath("sv", "abc"), "/sv/plan/open?list=abc");
  assert.equal(openPlanPath("sv", "abc", { error: "1" }), "/sv/plan/open?error=1&list=abc");
});
